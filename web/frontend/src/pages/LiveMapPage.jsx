/**
 * LiveMapPage — Interactive Leaflet map showing players, vehicles, and events in real time.
 * Uses CRS.Simple for non-geographic game coordinates with a single map image overlay.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, ImageOverlay, Marker, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import API from '../api';
import { useServers } from '../contexts/ServersContext';
import {
  Users, Car, MapPin, Layers, Filter, Crosshair, Heart, Skull,
  Bomb, Wrench, Trash2, Navigation, Locate, RefreshCw, Eye, EyeOff,
  Sun, CloudRain, Wind, X, Zap, AlertTriangle,
} from '../components/Icon';

// ─── Leaflet Icon Factory ──────────────────────────────
function createDivIcon(className, html, size = [28, 28]) {
  return L.divIcon({
    className: `map-marker ${className}`,
    html,
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1] / 2],
    popupAnchor: [0, -size[1] / 2],
  });
}

// Player icon — blue dot with glow
function playerIcon(name) {
  return createDivIcon('map-marker--player',
    `<div class="map-marker__dot map-marker__dot--player"></div>
     <div class="map-marker__label">${name || ''}</div>`
  );
}

// Vehicle icons by type
function vehicleIcon(type) {
  const typeClass = type === 'truck' ? 'truck' : type === 'boat' ? 'boat' : 'car';
  const symbols = { car: '\u{1F697}', truck: '\u{1F69A}', boat: '\u26F5' };
  return createDivIcon(`map-marker--vehicle map-marker--${typeClass}`,
    `<div class="map-marker__dot map-marker__dot--vehicle">${symbols[typeClass] || '\u{1F697}'}</div>`,
    [32, 32]
  );
}

// Event icons by type
function eventIcon(type) {
  const icons = {
    helicrash: '\u{1F681}',
    airdrop: '\u{1F4E6}',
    contamination: '\u2622\uFE0F',
    horde: '\u{1F480}',
    custom: '\u{1F4CD}',
  };
  return createDivIcon(`map-marker--event map-marker--${type}`,
    `<div class="map-marker__dot map-marker__dot--event map-marker__dot--${type}">${icons[type] || '\u{1F4CD}'}</div>`,
    [34, 34]
  );
}

// ─── Coordinate Display Component ──────────────────────
function CoordinateTracker({ onMove }) {
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  useMapEvents({
    mousemove(e) {
      onMoveRef.current({ x: Math.round(e.latlng.lng), z: Math.round(e.latlng.lat) });
    },
  });
  return null;
}

// ─── Map Bounds Fitter (runs once on mount) ────────────
function FitBounds({ bounds }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (bounds && !fitted.current) {
      fitted.current = true;
      map.fitBounds(bounds, { padding: [20, 20], animate: false });
    }
  }, [map, bounds]);
  return null;
}

// ─── Context Menu Component ────────────────────────────
function ContextMenu({ position, items, onClose }) {
  if (!position) return null;
  return (
    <div className="map-context-menu" style={{ left: position.x, top: position.y }} onClick={e => e.stopPropagation()}>
      {items.map((item, i) =>
        item.divider ? <div key={i} className="map-context-menu__divider" /> :
        <button key={i} className={`map-context-menu__item ${item.danger ? 'map-context-menu__item--danger' : ''}`}
          onClick={() => { item.onClick(); onClose(); }}>
          {item.icon && <span className="map-context-menu__icon">{item.icon}</span>}
          {item.label}
        </button>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────
export default function LiveMapPage({ serverId }) {
  const { servers, socket } = useServers();
  const server = useMemo(() => servers.find(s => s.id === serverId), [servers, serverId]);

  const [mapConfig, setMapConfig] = useState(null);
  const [mapData, setMapData] = useState({ players: [], vehicles: [], events: [] });
  const coordsRef = useRef({ x: 0, z: 0 });
  const coordsElRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [imageError, setImageError] = useState(false);

  // Layer visibility toggles
  const [showPlayers, setShowPlayers] = useState(true);
  const [showVehicles, setShowVehicles] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  // Context menu
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  // Action feedback
  const [actionLoading, setActionLoading] = useState(false);

  const mapRef = useRef(null);

  // ─── Fetch map config ──────────────────────────────────
  useEffect(() => {
    if (!serverId) return;
    setLoading(true);
    setError(null);

    Promise.all([
      API.get(`/api/servers/${serverId}/map/config`),
      API.get(`/api/servers/${serverId}/map/data`),
    ])
      .then(([config, data]) => {
        setMapConfig(config);
        setMapData(data || { players: [], vehicles: [], events: [] });
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Failed to load map');
        setLoading(false);
      });
  }, [serverId]);

  // ─── Socket.IO real-time updates ───────────────────────
  useEffect(() => {
    if (!socket) return;

    const handleMapData = (data) => {
      if (data.serverId === serverId) {
        setMapData({
          players: data.players || [],
          vehicles: data.vehicles || [],
          events: data.events || [],
        });
      }
    };

    socket.on('mapData', handleMapData);
    return () => socket.off('mapData', handleMapData);
  }, [socket, serverId]);

  // ─── Refresh map data manually ─────────────────────────
  const refreshData = useCallback(async () => {
    try {
      const data = await API.get(`/api/servers/${serverId}/map/data`);
      setMapData(data || { players: [], vehicles: [], events: [] });
    } catch { /* ignore */ }
  }, [serverId]);

  // ─── Player Actions ────────────────────────────────────
  const doPlayerAction = useCallback(async (steamId, action, label) => {
    setActionLoading(true);
    try {
      await API.post(`/api/servers/${serverId}/map/player-action`, { steamId, action });
      window.addToast?.(`${label} successful`, 'success');
    } catch (err) {
      window.addToast?.(`${label} failed: ${err.message}`, 'error');
    }
    setActionLoading(false);
  }, [serverId]);

  const doTeleport = useCallback(async (steamId, playerName, x, z) => {
    setActionLoading(true);
    try {
      await API.post(`/api/servers/${serverId}/map/teleport`, { steamId, x, y: 0, z });
      window.addToast?.(`Teleported ${playerName}`, 'success');
    } catch (err) {
      window.addToast?.(`Teleport failed: ${err.message}`, 'error');
    }
    setActionLoading(false);
  }, [serverId]);

  const doVehicleAction = useCallback(async (vehicleId, action, label) => {
    setActionLoading(true);
    try {
      await API.post(`/api/servers/${serverId}/map/vehicle-action`, { vehicleId, action });
      window.addToast?.(`${label} successful`, 'success');
    } catch (err) {
      window.addToast?.(`${label} failed: ${err.message}`, 'error');
    }
    setActionLoading(false);
  }, [serverId]);

  // ─── Map right-click handler ───────────────────────────
  const handleMapContext = useCallback((e) => {
    if (!selectedPlayer) return;
    e.originalEvent.preventDefault();
    const container = e.originalEvent.target.closest('.map-container');
    const rect = container?.getBoundingClientRect() || { left: 0, top: 0 };
    setContextMenu({
      position: {
        x: e.originalEvent.clientX - rect.left,
        y: e.originalEvent.clientY - rect.top,
      },
      items: [
        {
          label: `Teleport ${selectedPlayer.name} here`,
          icon: <Navigation size={14} />,
          onClick: () => doTeleport(selectedPlayer.steamId, selectedPlayer.name, Math.round(e.latlng.lng), Math.round(e.latlng.lat)),
        },
      ],
    });
  }, [selectedPlayer, doTeleport]);

  // Close context menu on click
  useEffect(() => {
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // ─── DayZ → Leaflet coordinate conversion ─────────────
  // DayZ: X=east-west, Z=north-south | Leaflet CRS.Simple: [lat, lng] = [Z, X]
  const toLatLng = (pos) => [pos.z || 0, pos.x || 0];

  // ─── Render ────────────────────────────────────────────
  // Memoize bounds and center so Leaflet components don't re-trigger on every render
  const bounds = useMemo(() => [[0, 0], [mapConfig?.height || 0, mapConfig?.width || 0]], [mapConfig?.height, mapConfig?.width]);
  const center = useMemo(() => [mapConfig?.height / 2 || 0, mapConfig?.width / 2 || 0], [mapConfig?.height, mapConfig?.width]);

  if (loading) {
    return (
      <div className="map-loading">
        <div className="map-loading__spinner" />
        <div>Loading map...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="map-error">
        <AlertTriangle size={48} />
        <h3>Map Error</h3>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  if (!mapConfig) return null;

  return (
    <div className="map-page">
      {/* ─── Top Bar ─────────────────────────────────── */}
      <div className="map-topbar">
        <div className="map-topbar__left">
          <span className="map-topbar__title">
            <MapPin size={16} /> {mapConfig.name || 'Live Map'}
          </span>
          <span className="map-topbar__stat">
            <Users size={13} /> {mapData.players.length} players
          </span>
          <span className="map-topbar__stat">
            <Car size={13} /> {mapData.vehicles.length} vehicles
          </span>
          <span className="map-topbar__stat">
            <Zap size={13} /> {mapData.events.length} events
          </span>
        </div>
        <div className="map-topbar__right">
          <span className="map-topbar__coords" ref={coordsElRef}>
            <Crosshair size={13} /><span> 0, 0</span>
          </span>
          <button className="btn btn-sm btn-secondary" onClick={refreshData} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ─── Map Container ───────────────────────────── */}
      <div className="map-container" onContextMenu={e => e.preventDefault()}>
        <MapContainer
          ref={mapRef}
          center={center}
          zoom={-2}
          minZoom={-3}
          maxZoom={4}
          crs={L.CRS.Simple}
          maxBounds={[[-500, -500], [mapConfig.height + 500, mapConfig.width + 500]]}
          maxBoundsViscosity={0.8}
          style={{ width: '100%', height: '100%', background: '#0a0f0a' }}
          attributionControl={false}
          zoomControl={true}
          scrollWheelZoom={true}
          dragging={true}
          doubleClickZoom={true}
          touchZoom={true}
        >
          <FitBounds bounds={bounds} />
          <CoordinateTracker onMove={(c) => {
            coordsRef.current = c;
            if (coordsElRef.current) coordsElRef.current.lastChild.textContent = ` ${c.x}, ${c.z}`;
          }} />
          <MapEvents onContextMenu={handleMapContext} />

          {/* Map Image Overlay */}
          {!imageError ? (
            <ImageOverlay
              url={mapConfig.imagePath}
              bounds={bounds}
              eventHandlers={{
                error: () => setImageError(true),
              }}
            />
          ) : (
            <ImageOverlay
              url="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzBhMGYwYSIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiM0NDQiIGZvbnQtc2l6ZT0iOCI+Tm8gTWFwPC90ZXh0Pjwvc3ZnPg=="
              bounds={bounds}
            />
          )}

          {/* ─── Player Markers ────────────────────── */}
          {showPlayers && mapData.players.map(player => (
            <Marker
              key={`p-${player.id}`}
              position={toLatLng(player.position)}
              icon={playerIcon(showLabels ? player.name : '')}
              eventHandlers={{
                click: () => setSelectedPlayer(player),
              }}
            >
              <Popup className="map-popup">
                <div className="map-popup__header">
                  <Users size={14} /> {player.name}
                </div>
                <div className="map-popup__body">
                  <div className="map-popup__stat">Position: {Math.round(player.position.x)}, {Math.round(player.position.z)}</div>
                  {player.ping > 0 && <div className="map-popup__stat">Ping: {player.ping}ms</div>}
                </div>
                <div className="map-popup__actions">
                  <button className="map-popup__btn map-popup__btn--success" onClick={() => doPlayerAction(player.steamId, 'heal', `Heal ${player.name}`)}>
                    <Heart size={12} /> Heal
                  </button>
                  <button className="map-popup__btn map-popup__btn--danger" onClick={() => doPlayerAction(player.steamId, 'kill', `Kill ${player.name}`)}>
                    <Skull size={12} /> Kill
                  </button>
                  <button className="map-popup__btn" onClick={() => { setSelectedPlayer(player); window.addToast?.(`Selected ${player.name} — right-click map to teleport`, 'info'); }}>
                    <Navigation size={12} /> Teleport
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* ─── Vehicle Markers ───────────────────── */}
          {showVehicles && mapData.vehicles.map(vehicle => (
            <Marker
              key={`v-${vehicle.id}`}
              position={toLatLng(vehicle.position)}
              icon={vehicleIcon(vehicle.vehicleType)}
            >
              <Popup className="map-popup">
                <div className="map-popup__header">
                  <Car size={14} /> {vehicle.displayName}
                </div>
                <div className="map-popup__body">
                  <div className="map-popup__stat">Type: {vehicle.vehicleType}</div>
                  <div className="map-popup__stat">Health: {Math.round(vehicle.health * 100)}%</div>
                  {vehicle.speed > 0 && <div className="map-popup__stat">Speed: {Math.round(vehicle.speed)} km/h</div>}
                  <div className="map-popup__stat">Position: {Math.round(vehicle.position.x)}, {Math.round(vehicle.position.z)}</div>
                </div>
                <div className="map-popup__actions">
                  <button className="map-popup__btn map-popup__btn--success" onClick={() => doVehicleAction(vehicle.id, 'repair', 'Repair')}>
                    <Wrench size={12} /> Repair
                  </button>
                  <button className="map-popup__btn" onClick={() => doVehicleAction(vehicle.id, 'refuel', 'Refuel')}>
                    <Zap size={12} /> Refuel
                  </button>
                  <button className="map-popup__btn map-popup__btn--danger" onClick={() => doVehicleAction(vehicle.id, 'delete', 'Delete')}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* ─── Event Markers ─────────────────────── */}
          {showEvents && mapData.events.map(event => (
            <Marker
              key={`e-${event.id}`}
              position={toLatLng(event.position)}
              icon={eventIcon(event.type)}
            >
              <Popup className="map-popup">
                <div className="map-popup__header map-popup__header--event">
                  <Zap size={14} /> {event.displayName}
                </div>
                <div className="map-popup__body">
                  <div className="map-popup__stat">Type: {event.type}</div>
                  <div className="map-popup__stat">Position: {Math.round(event.position.x)}, {Math.round(event.position.z)}</div>
                  {event.age != null && <div className="map-popup__stat">Detected: {event.age}m ago</div>}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* ─── Legend / Filter Panel ──────────────── */}
        <div className="map-legend">
          <div className="map-legend__title"><Layers size={14} /> Layers</div>

          <label className="map-legend__item">
            <input type="checkbox" checked={showPlayers} onChange={e => setShowPlayers(e.target.checked)} />
            <span className="map-legend__dot map-legend__dot--player" />
            Players ({mapData.players.length})
          </label>

          <label className="map-legend__item">
            <input type="checkbox" checked={showVehicles} onChange={e => setShowVehicles(e.target.checked)} />
            <span className="map-legend__dot map-legend__dot--vehicle" />
            Vehicles ({mapData.vehicles.length})
          </label>

          <label className="map-legend__item">
            <input type="checkbox" checked={showEvents} onChange={e => setShowEvents(e.target.checked)} />
            <span className="map-legend__dot map-legend__dot--event" />
            Events ({mapData.events.length})
          </label>

          <div className="map-legend__divider" />

          <label className="map-legend__item">
            <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
            <Eye size={13} /> Labels
          </label>

          {selectedPlayer && (
            <>
              <div className="map-legend__divider" />
              <div className="map-legend__selected">
                <div className="map-legend__selected-title">
                  <Navigation size={12} /> Selected
                  <button className="map-legend__clear" onClick={() => setSelectedPlayer(null)}><X size={12} /></button>
                </div>
                <div className="map-legend__selected-name">{selectedPlayer.name}</div>
                <div className="map-legend__hint">Right-click map to teleport</div>
              </div>
            </>
          )}
        </div>

        {/* ─── Image Missing Notice ──────────────── */}
        {imageError && (
          <div className="map-notice">
            <AlertTriangle size={16} />
            <span>Map image not found at <code>{mapConfig.imagePath}</code></span>
            <span className="map-notice__hint">Place your map image in <code>web/frontend/public/maps/</code></span>
          </div>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <ContextMenu
            position={contextMenu.position}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Map Events Hook Component ───────────────────────────
function MapEvents({ onContextMenu }) {
  useMapEvents({
    contextmenu: onContextMenu,
  });
  return null;
}
