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
import { useSocket } from '../contexts/SocketContext';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  Users, Car, MapPin, Layers, Filter, Crosshair, Heart, Skull,
  Bomb, Wrench, Trash2, Navigation, Locate, RefreshCw, Eye, EyeOff,
  Sun, CloudRain, Wind, X, Zap, AlertTriangle, Info,
  Power, LogOut, Send, Clock, ArrowUp, ChevronDown, ChevronUp, Globe,
  Flame, Package, TreePine, Target, MousePointerClick, Truck, Haze, CircleX,
} from '../components/Icon';

// ─── HTML Escaping (prevents XSS in Leaflet divIcon HTML) ─
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
     <div class="map-marker__label">${escapeHtml(name)}</div>`
  );
}

// Vehicle icons by type (Font Awesome)
function vehicleIcon(type) {
  const typeClass = type === 'truck' ? 'truck' : type === 'boat' ? 'boat' : 'car';
  const faIcons = { car: 'fa-car-side', truck: 'fa-truck', boat: 'fa-sailboat' };
  return createDivIcon(`map-marker--vehicle map-marker--${typeClass}`,
    `<div class="map-marker__dot map-marker__dot--vehicle"><i class="fa-solid ${faIcons[typeClass] || 'fa-car-side'}"></i></div>`,
    [32, 32]
  );
}

// Icon name → Font Awesome class mapping (covers built-in event types + mod marker icons)
const FA_ICON_MAP = {
  // RPT-detected event types
  helicrash: 'fa-helicopter',
  airdrop: 'fa-parachute-box',
  contamination: 'fa-biohazard',
  horde: 'fa-skull-crossbones',
  custom: 'fa-location-dot',
  // Dynamic event icons (from mod hooks)
  helicopter: 'fa-helicopter',
  biohazard: 'fa-biohazard',
  skull: 'fa-skull',
  'container-storage': 'fa-lock',
  briefcase: 'fa-briefcase',
  bolt: 'fa-bolt',
  flag: 'fa-flag',
  // MapMarkers.json config icons
  chest: 'fa-box-open',
  'box-open': 'fa-box-open',
  barrel: 'fa-oil-drum',
  house: 'fa-house',
  home: 'fa-house',
  tent: 'fa-campground',
  hammer: 'fa-hammer',
  wrench: 'fa-wrench',
  car: 'fa-car-side',
  truck: 'fa-truck',
  boat: 'fa-sailboat',
  ship: 'fa-ship',
  // Generic icons
  marker: 'fa-location-dot',
  star: 'fa-star',
  warning: 'fa-triangle-exclamation',
  medical: 'fa-kit-medical',
  food: 'fa-utensils',
  water: 'fa-droplet',
  fire: 'fa-fire',
  lock: 'fa-lock',
  key: 'fa-key',
  military: 'fa-shield-halved',
  camp: 'fa-campground',
};

// Categorized icon reference for the legend panel (deduped, no aliases)
const ICON_CATEGORIES = (() => {
  const aliases = new Set(['home', 'box-open', 'custom']);
  const catMap = {
    helicrash: 'Events', airdrop: 'Events', contamination: 'Events', horde: 'Events',
    car: 'Vehicles', truck: 'Vehicles', boat: 'Vehicles', ship: 'Vehicles', helicopter: 'Vehicles',
    house: 'Structures', tent: 'Structures', camp: 'Structures', flag: 'Structures',
    chest: 'Loot', barrel: 'Loot', briefcase: 'Loot', military: 'Loot',
  };
  const cats = {};
  for (const [name, faClass] of Object.entries(FA_ICON_MAP)) {
    if (aliases.has(name)) continue;
    const cat = catMap[name] || 'General';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push({ name, faClass });
  }
  return Object.entries(cats);
})();

// Event icons (Font Awesome) — checks event.icon (from mod config), then event.type, then fallback
function eventIcon(type, icon) {
  const faClass = FA_ICON_MAP[icon] || FA_ICON_MAP[type] || 'fa-location-dot';
  const cssType = FA_ICON_MAP[type] ? type : 'custom-marker';
  return createDivIcon(`map-marker--event map-marker--${cssType}`,
    `<div class="map-marker__dot map-marker__dot--event map-marker__dot--${cssType}"><i class="fa-solid ${faClass}"></i></div>`,
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
  const { servers } = useServers();
  const socket = useSocket();
  const { confirm, prompt, DialogComponent } = useConfirmDialog();
  const server = useMemo(() => servers.find(s => s.id === serverId), [servers, serverId]);
  const serverStatus = server?.status || 'stopped';
  const isRunning = serverStatus === 'running';

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

  // World controls panel
  const [showWorldPanel, setShowWorldPanel] = useState(false);
  const [showIconRef, setShowIconRef] = useState(false);
  const [worldHour, setWorldHour] = useState(12);
  const [worldMinute, setWorldMinute] = useState(0);

  // Spawn mode
  const [spawnMode, setSpawnMode] = useState(null); // null or { action, label, params }
  const [spawnType, setSpawnType] = useState('zombie');
  const [spawnCount, setSpawnCount] = useState(5);
  const [spawnClass, setSpawnClass] = useState('');
  const [spawnAnimal, setSpawnAnimal] = useState('Animal_CervusElaphus');
  const [areaRadius, setAreaRadius] = useState(50);
  const [fogDensity, setFogDensity] = useState(0.5);
  const [windSpeed, setWindSpeed] = useState(10);

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
  const doPlayerAction = useCallback(async (steamId, action, label, extra = {}) => {
    setActionLoading(true);
    try {
      await API.post(`/api/servers/${serverId}/map/player-action`, { steamId, action, ...extra });
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

  const doWorldAction = useCallback(async (action, params, label) => {
    setActionLoading(true);
    try {
      await API.post(`/api/servers/${serverId}/map/world-action`, { action, params });
      window.addToast?.(`${label} successful`, 'success');
    } catch (err) {
      window.addToast?.(`${label} failed: ${err.message}`, 'error');
    }
    setActionLoading(false);
  }, [serverId]);

  const doSpawnAction = useCallback(async (action, params, label) => {
    setActionLoading(true);
    try {
      await API.post(`/api/servers/${serverId}/map/spawn-action`, { action, params });
      window.addToast?.(`${label} successful`, 'success');
    } catch (err) {
      window.addToast?.(`${label} failed: ${err.message}`, 'error');
    }
    setActionLoading(false);
  }, [serverId]);

  // Activate spawn mode for a given entity type
  const activateSpawnMode = useCallback((action, label, extraParams = {}) => {
    setSpawnMode({ action, label, params: extraParams });
    window.addToast?.(`Spawn mode: click map to place ${label}`, 'info');
  }, []);

  // Handle map click in spawn mode
  const handleSpawnClick = useCallback((e) => {
    if (!spawnMode) return;
    const x = Math.round(e.latlng.lng);
    const z = Math.round(e.latlng.lat);
    const coords = { x, y: 0, z };
    doSpawnAction(spawnMode.action, { ...spawnMode.params, coords }, `Spawn ${spawnMode.label} at [${x}, ${z}]`);
    // Keep spawn mode active for repeated placement
  }, [spawnMode, doSpawnAction]);

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

      {/* ─── Spawn Mode Indicator ────────────────────── */}
      {spawnMode && (
        <div className="map-spawn-bar">
          <MousePointerClick size={14} />
          <span>Click map to place: <strong>{spawnMode.label}</strong></span>
          <button className="map-spawn-bar__cancel" onClick={() => setSpawnMode(null)}>
            <CircleX size={14} /> Cancel
          </button>
        </div>
      )}

      {/* ─── Map Container ───────────────────────────── */}
      <div className={`map-container${spawnMode ? ' map-container--spawn-mode' : ''}`} onContextMenu={e => e.preventDefault()}>
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
          <MapEvents onContextMenu={handleMapContext} onClick={handleSpawnClick} />

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
                  <button className="map-popup__btn map-popup__btn--danger" onClick={async () => { if (await confirm({ title: 'Kill Player', message: `Kill ${player.name}?`, confirmLabel: 'Kill', variant: 'danger' })) doPlayerAction(player.steamId, 'kill', `Kill ${player.name}`); }}>
                    <Skull size={12} /> Kill
                  </button>
                  <button className="map-popup__btn" onClick={() => { setSelectedPlayer(player); window.addToast?.(`Selected ${player.name} — right-click map to teleport`, 'info'); }}>
                    <Navigation size={12} /> Teleport
                  </button>
                </div>
                <div className="map-popup__actions">
                  <button className="map-popup__btn" onClick={async () => { if (await confirm({ title: 'Strip Gear', message: `Strip all gear from ${player.name}?`, confirmLabel: 'Strip', variant: 'danger' })) doPlayerAction(player.steamId, 'strip', `Strip ${player.name}`); }}>
                    <Trash2 size={12} /> Strip
                  </button>
                  <button className="map-popup__btn map-popup__btn--danger" onClick={async () => { if (await confirm({ title: 'Explode Player', message: `Explode ${player.name}?`, confirmLabel: 'Explode', variant: 'danger' })) doPlayerAction(player.steamId, 'explode', `Explode ${player.name}`); }}>
                    <Bomb size={12} /> Explode
                  </button>
                  <button className="map-popup__btn" onClick={async () => { const msg = await prompt({ title: 'Send Message', message: `Send message to ${player.name}:`, placeholder: 'Type your message...' }); if (msg) doPlayerAction(player.steamId, 'message', `Message ${player.name}`, { message: msg }); }}>
                    <Send size={12} /> Message
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
                  <button className="map-popup__btn map-popup__btn--danger" onClick={async () => { if (await confirm({ title: 'Delete Vehicle', message: 'Delete this vehicle?', confirmLabel: 'Delete', variant: 'danger' })) doVehicleAction(vehicle.id, 'delete', 'Delete'); }}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
                <div className="map-popup__actions">
                  <button className="map-popup__btn" onClick={() => doVehicleAction(vehicle.id, 'unstuck', 'Unstuck')}>
                    <ArrowUp size={12} /> Unstuck
                  </button>
                  <button className="map-popup__btn map-popup__btn--danger" onClick={async () => { if (await confirm({ title: 'Explode Vehicle', message: 'Explode this vehicle?', confirmLabel: 'Explode', variant: 'danger' })) doVehicleAction(vehicle.id, 'explode', 'Explode'); }}>
                    <Bomb size={12} /> Explode
                  </button>
                  <button className="map-popup__btn map-popup__btn--danger" onClick={() => doVehicleAction(vehicle.id, 'kill-engine', 'Kill Engine')}>
                    <Power size={12} /> Kill Engine
                  </button>
                  <button className="map-popup__btn" onClick={() => doVehicleAction(vehicle.id, 'eject-driver', 'Eject Driver')}>
                    <LogOut size={12} /> Eject
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
              icon={eventIcon(event.type, event.icon)}
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

          <div className="map-legend__divider" />
          <button className="map-icon-ref__toggle" onClick={() => setShowIconRef(p => !p)}>
            <Info size={12} /> Available Icons
            {showIconRef ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showIconRef && (
            <div className="map-icon-ref">
              {ICON_CATEGORIES.map(([cat, items]) => (
                <div key={cat} className="map-icon-ref__cat">
                  <div className="map-icon-ref__cat-title">{cat}</div>
                  <div className="map-icon-ref__grid">
                    {items.map(({ name, faClass }) => (
                      <div key={name} className="map-icon-ref__item" title={name}>
                        <i className={`fa-solid ${faClass}`} />
                        <span>{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="map-icon-ref__hint">Use these names in MapMarkers.json or dynamic marker configs</div>
            </div>
          )}

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

        {/* ─── World Controls Panel ────────────────── */}
        <div className="map-world-panel">
          <button className="map-world-panel__toggle" onClick={() => setShowWorldPanel(p => !p)}>
            <Globe size={14} /> World Controls
            {showWorldPanel ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {showWorldPanel && (
            <div className="map-world-panel__body">
              {/* ── Time ── */}
              <div className="map-world-panel__section">
                <div className="map-world-panel__label"><Clock size={12} /> Time</div>
                <div className="map-world-panel__row">
                  <input type="number" className="map-world-panel__input" min={0} max={23} value={worldHour} onChange={e => setWorldHour(parseInt(e.target.value) || 0)} placeholder="Hr" />
                  <span className="map-world-panel__colon">:</span>
                  <input type="number" className="map-world-panel__input" min={0} max={59} value={worldMinute} onChange={e => setWorldMinute(parseInt(e.target.value) || 0)} placeholder="Min" />
                  <button className="map-popup__btn map-popup__btn--success" onClick={() => doWorldAction('set-time', { hour: worldHour, minute: worldMinute }, `Set time to ${worldHour}:${String(worldMinute).padStart(2, '0')}`)}>
                    Set
                  </button>
                </div>
              </div>

              {/* ── Weather ── */}
              <div className="map-world-panel__section">
                <div className="map-world-panel__label"><Sun size={12} /> Weather</div>
                <div className="map-world-panel__row">
                  <button className="map-popup__btn map-popup__btn--success" onClick={() => doWorldAction('sunny', null, 'Clear Weather')}>
                    <Sun size={12} /> Clear
                  </button>
                  <button className="map-popup__btn" onClick={() => doWorldAction('set-weather', { overcast: 1 }, 'Overcast')}>
                    <CloudRain size={12} /> Overcast
                  </button>
                  <button className="map-popup__btn" onClick={() => doWorldAction('set-weather', { rain: 1 }, 'Rain')}>
                    <Wind size={12} /> Rain
                  </button>
                </div>
              </div>

              {/* ── Atmosphere ── */}
              <div className="map-world-panel__section">
                <div className="map-world-panel__label"><Haze size={12} /> Atmosphere</div>
                <div className="map-world-panel__row">
                  <span className="map-world-panel__field-label">Fog</span>
                  <input type="number" className="map-world-panel__input" min={0} max={1} step={0.1} value={fogDensity} onChange={e => setFogDensity(parseFloat(e.target.value) || 0)} />
                  <button className="map-popup__btn" onClick={() => doWorldAction('set-fog', { density: fogDensity }, `Set fog ${fogDensity}`)}>
                    Set
                  </button>
                </div>
                <div className="map-world-panel__row">
                  <span className="map-world-panel__field-label">Wind</span>
                  <input type="number" className="map-world-panel__input" min={0} max={20} value={windSpeed} onChange={e => setWindSpeed(parseInt(e.target.value) || 0)} />
                  <button className="map-popup__btn" onClick={() => doWorldAction('set-wind', { speed: windSpeed }, `Set wind ${windSpeed}`)}>
                    Set
                  </button>
                </div>
              </div>

              {/* ── Spawn Entities ── */}
              <div className="map-world-panel__section">
                <div className="map-world-panel__label"><Target size={12} /> Spawn Entities</div>
                <div className="map-world-panel__row">
                  <select className="map-world-panel__select" value={spawnType} onChange={e => setSpawnType(e.target.value)}>
                    <option value="zombie">Zombie</option>
                    <option value="animal">Animal</option>
                    <option value="vehicle">Vehicle</option>
                    <option value="building">Building</option>
                    <option value="item">Item</option>
                  </select>
                </div>
                {/* Type-specific inputs */}
                {spawnType === 'zombie' && (
                  <div className="map-world-panel__row">
                    <span className="map-world-panel__field-label">Count</span>
                    <input type="number" className="map-world-panel__input" min={1} max={50} value={spawnCount} onChange={e => setSpawnCount(parseInt(e.target.value) || 1)} />
                  </div>
                )}
                {spawnType === 'animal' && (
                  <>
                    <div className="map-world-panel__row">
                      <select className="map-world-panel__select" value={spawnAnimal} onChange={e => setSpawnAnimal(e.target.value)}>
                        <option value="Animal_CervusElaphus">Deer</option>
                        <option value="Animal_CanisLupus">Wolf</option>
                        <option value="Animal_UrsusArctos">Bear</option>
                        <option value="Animal_SusDomesticus">Boar</option>
                        <option value="Animal_GallusGallus">Chicken</option>
                        <option value="Animal_CapraHircus">Goat</option>
                        <option value="Animal_CapreolusCapreolus">Roe Deer</option>
                      </select>
                    </div>
                    <div className="map-world-panel__row">
                      <span className="map-world-panel__field-label">Count</span>
                      <input type="number" className="map-world-panel__input" min={1} max={20} value={spawnCount} onChange={e => setSpawnCount(parseInt(e.target.value) || 1)} />
                    </div>
                  </>
                )}
                {(spawnType === 'vehicle' || spawnType === 'building' || spawnType === 'item') && (
                  <div className="map-world-panel__row">
                    <input type="text" className="map-world-panel__input map-world-panel__input--wide" value={spawnClass} onChange={e => setSpawnClass(e.target.value)}
                      placeholder={spawnType === 'vehicle' ? 'OffroadHatchback' : spawnType === 'building' ? 'Land_House_1W01' : 'M4A1'} />
                  </div>
                )}
                <div className="map-world-panel__row">
                  {!spawnMode ? (
                    <button className="map-popup__btn map-popup__btn--success" onClick={() => {
                      if (spawnType === 'zombie') {
                        activateSpawnMode('zombie-at', `Zombie x${spawnCount}`, { count: spawnCount });
                      } else if (spawnType === 'animal') {
                        activateSpawnMode('animal-at', spawnAnimal.split('_').pop(), { animalType: spawnAnimal, count: spawnCount });
                      } else if (spawnType === 'vehicle') {
                        if (!spawnClass) { window.addToast?.('Enter a vehicle class name', 'error'); return; }
                        activateSpawnMode('vehicle', spawnClass, { vehicleClass: spawnClass });
                      } else if (spawnType === 'building') {
                        if (!spawnClass) { window.addToast?.('Enter a building class name', 'error'); return; }
                        activateSpawnMode('building', spawnClass, { buildingClass: spawnClass });
                      } else if (spawnType === 'item') {
                        if (!spawnClass) { window.addToast?.('Enter an item class name', 'error'); return; }
                        activateSpawnMode('item-at', spawnClass, { itemClass: spawnClass });
                      }
                    }}>
                      <MousePointerClick size={12} /> Click to Place
                    </button>
                  ) : (
                    <button className="map-popup__btn map-popup__btn--danger" onClick={() => setSpawnMode(null)}>
                      <CircleX size={12} /> Cancel Placement
                    </button>
                  )}
                </div>
              </div>

              {/* ── World Events ── */}
              <div className="map-world-panel__section">
                <div className="map-world-panel__label"><Flame size={12} /> World Events</div>
                <div className="map-world-panel__row">
                  <button className="map-popup__btn" onClick={() => activateSpawnMode('heli-crash', 'Heli Crash', {})}>
                    <Zap size={12} /> Heli Crash
                  </button>
                  <button className="map-popup__btn" onClick={() => activateSpawnMode('gas-zone', 'Gas Zone', {})}>
                    <Skull size={12} /> Gas Zone
                  </button>
                </div>
                <div className="map-world-panel__row">
                  <button className="map-popup__btn" onClick={() => activateSpawnMode('supply-crate', 'Supply Crate', { crateType: 'military' })}>
                    <Package size={12} /> Supply Crate
                  </button>
                </div>
              </div>

              {/* ── Area Effects ── */}
              <div className="map-world-panel__section">
                <div className="map-world-panel__label"><TreePine size={12} /> Area Effects</div>
                <div className="map-world-panel__row">
                  <span className="map-world-panel__field-label">Radius</span>
                  <input type="number" className="map-world-panel__input" min={10} max={500} value={areaRadius} onChange={e => setAreaRadius(parseInt(e.target.value) || 50)} />
                  <span className="map-world-panel__unit">m</span>
                </div>
                <div className="map-world-panel__row">
                  <button className="map-popup__btn map-popup__btn--danger" onClick={async () => {
                    const c = coordsRef.current;
                    if (await confirm({ title: 'Flatten Trees', message: `Flatten trees within ${areaRadius}m of [${c.x}, ${c.z}]?`, confirmLabel: 'Flatten', variant: 'danger' }))
                      doWorldAction('flatten-trees', { coords: { x: c.x, y: 0, z: c.z }, radius: areaRadius }, 'Flatten Trees');
                  }}>
                    <TreePine size={12} /> Flatten Trees
                  </button>
                  <button className="map-popup__btn map-popup__btn--danger" onClick={async () => {
                    const c = coordsRef.current;
                    if (await confirm({ title: 'Clear Zombies', message: `Clear zombies within ${areaRadius}m of [${c.x}, ${c.z}]?`, confirmLabel: 'Clear', variant: 'danger' }))
                      doWorldAction('clear-zombies', { coords: { x: c.x, y: 0, z: c.z }, radius: areaRadius }, 'Clear Zombies');
                  }}>
                    <Skull size={12} /> Clear Zombies
                  </button>
                </div>
                <div className="map-world-panel__row">
                  <button className="map-popup__btn map-popup__btn--danger" onClick={async () => {
                    const c = coordsRef.current;
                    if (await confirm({ title: 'Delete Objects', message: `Delete ALL objects within ${areaRadius}m of [${c.x}, ${c.z}]? This cannot be undone.`, confirmLabel: 'Delete', variant: 'danger' }))
                      doWorldAction('delete-objects-radius', { coords: { x: c.x, y: 0, z: c.z }, radius: areaRadius }, 'Delete Objects');
                  }}>
                    <Trash2 size={12} /> Delete Objects
                  </button>
                </div>
                <div className="map-world-panel__hint">Uses cursor position on map</div>
              </div>

              {/* ── Danger Zone ── */}
              <div className="map-world-panel__section">
                <div className="map-world-panel__label"><AlertTriangle size={12} /> Danger Zone</div>
                <div className="map-world-panel__row">
                  <button className="map-popup__btn map-popup__btn--danger" onClick={async () => { if (await confirm({ title: 'Wipe AI', message: 'Wipe ALL AI from the map? This cannot be undone.', confirmLabel: 'Wipe AI', variant: 'danger' })) doWorldAction('wipe-ai', null, 'Wipe AI'); }}>
                    <Skull size={12} /> Wipe AI
                  </button>
                  <button className="map-popup__btn map-popup__btn--danger" onClick={async () => { if (await confirm({ title: 'Wipe Vehicles', message: 'Wipe ALL vehicles from the map? This cannot be undone.', confirmLabel: 'Wipe Vehicles', variant: 'danger' })) doWorldAction('wipe-vehicles', null, 'Wipe Vehicles'); }}>
                    <Trash2 size={12} /> Wipe Vehicles
                  </button>
                </div>
              </div>
            </div>
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

        {/* ─── Empty State Notice ────────────────── */}
        {!loading && mapData.players.length === 0 && mapData.vehicles.length === 0 && mapData.events.length === 0 && (
          <div className="map-notice map-notice--info">
            <Info size={16} />
            {!isRunning ? (
              <span>Server is <strong>{serverStatus}</strong> — start the server to see live map data.</span>
            ) : (
              <span>No active players or events detected. Data updates automatically every 15 seconds.</span>
            )}
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

      {DialogComponent}
    </div>
  );
}

// ─── Map Events Hook Component ───────────────────────────
function MapEvents({ onContextMenu, onClick }) {
  useMapEvents({
    contextmenu: onContextMenu,
    click: onClick,
  });
  return null;
}
