/**
 * LiveDashboardPage — Real-time server monitoring dashboard
 * powered by the @CitadelAdmin mod's file-based bridge.
 *
 * Tabs: Live Map | Player List | Event Feed | Admin Tools
 */
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import './LiveDashboardPage.css';
import { useSocket } from '../contexts/SocketContext';
import useServerMap from '../hooks/useServerMap';
import API from '../api';
import PageLoader from '../components/PageLoader';
import { formatUptime, throttle } from '../utils';
import {
  Activity, Users, Cpu, Heart, Skull, Shield, Eye, MapPin, Truck,
  Search, Send, Sun, CloudRain, Wind, Zap, Globe, Clock, Target,
  Crosshair, Filter, MessageSquare, Haze, TreePine, Navigation, Bomb,
  Wrench, Droplets, Power, LogOut, ArrowUpFromLine, Trash2, X,
} from '../components/Icon';

const InteractiveMap = lazy(() => import('../components/InteractiveMap'));

// ─── Helpers ──────────────────────────────────────────────

function StatusDot({ active, stale }) {
  const color = active ? (stale ? 'var(--accent-yellow)' : 'var(--accent-green)') : 'var(--accent-red)';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 6 }} />;
}

function MetricChip({ icon, label, value, warn }) {
  return (
    <div className={`live-metric-chip ${warn ? 'live-metric-warn' : ''}`}>
      <span className="live-metric-icon">{icon}</span>
      <span className="live-metric-label">{label}</span>
      <span className="live-metric-value">{value}</span>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button className={`live-tab-btn ${active ? 'live-tab-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

// ─── Event type colors ────────────────────────────────────

const EVENT_COLORS = {
  kill: '#ef4444',
  death: '#f97316',
  connect: '#22c55e',
  disconnect: '#6b7280',
  chat: '#3b82f6',
  admin: '#a855f7',
  hit: '#eab308',
  damage: '#f59e0b',
  build: '#06b6d4',
  vehicle: '#8b5cf6',
};

function eventColor(type) {
  return EVENT_COLORS[type] || '#9ca3af';
}

const VEHICLE_ACTIONS = [
  { label: 'Repair',       action: 'vehicle.repair',      icon: <Wrench size={13} /> },
  { label: 'Refuel',       action: 'vehicle.refuel',      icon: <Droplets size={13} /> },
  { label: 'Unstuck',      action: 'vehicle.unstuck',     icon: <ArrowUpFromLine size={13} /> },
  { label: 'Kill Engine',  action: 'vehicle.kill-engine',  icon: <Power size={13} /> },
  { label: 'Eject Driver', action: 'vehicle.eject-driver', icon: <LogOut size={13} /> },
  { label: 'Teleport',     action: 'vehicle.teleport',    icon: <Navigation size={13} /> },
  { label: 'Explode',      action: 'vehicle.explode',     icon: <Bomb size={13} />,  danger: true },
  { label: 'Delete',       action: 'vehicle.delete',      icon: <Trash2 size={13} />, danger: true },
];

// ─── Main Component ───────────────────────────────────────

export default function LiveDashboardPage({ serverId }) {
  const socket = useSocket();
  const serverMap = useServerMap(serverId);
  const [tab, setTab] = useState('map');
  const [status, setStatus] = useState(null);
  const [players, setPlayers] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [vehicles, setVehicles] = useState([]);
  const [events, setEvents] = useState([]);
  const [worldEvents, setWorldEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const [commandResult, setCommandResult] = useState(null);
  const eventFeedRef = useRef(null);

  // ─── Initial load via REST ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statusData, playersData, metricsData, vehiclesData, eventsData, worldData] = await Promise.all([
          API.get(`/api/servers/${serverId}/citadel/status`),
          API.get(`/api/servers/${serverId}/citadel/players`),
          API.get(`/api/servers/${serverId}/citadel/metrics`),
          API.get(`/api/servers/${serverId}/citadel/vehicles`),
          API.get(`/api/servers/${serverId}/citadel/events?limit=200`),
          API.get(`/api/servers/${serverId}/citadel/world`),
        ]);
        if (cancelled) return;
        setStatus(statusData);
        if (playersData?.players) setPlayers(playersData.players);
        if (metricsData?.metrics) setMetrics(metricsData.metrics);
        if (vehiclesData?.vehicles) setVehicles(vehiclesData.vehicles);
        if (eventsData?.events) setEvents(eventsData.events);
        if (worldData?.events) setWorldEvents(worldData.events);
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [serverId]);

  // ─── WebSocket subscription ─────────────────────────────
  //
  // The in-game mod can emit status/players/metrics at up to ~15 updates/sec,
  // which would trigger the whole tree to re-render 15× per second. We throttle
  // each stream to ~3/sec (333 ms) — fast enough that the live map still feels
  // alive, slow enough that CPU usage drops ~5× on the admin's box.
  // Critical events (deaths, chat, connects) aren't throttled — they stream
  // through `onEvents` in full so nothing is lost from the feed.
  useEffect(() => {
    socket.emit('citadel:subscribe', { serverId });

    const onStatus = throttle((data) => { if (data.serverId === serverId) setStatus(data); }, 333);
    const onPlayers = throttle((data) => { if (data.serverId === serverId) setPlayers(data.players || []); }, 333);
    const onMetrics = throttle((data) => { if (data.serverId === serverId) setMetrics(data.metrics || {}); }, 333);
    const onVehicles = throttle((data) => { if (data.serverId === serverId) setVehicles(data.vehicles || []); }, 500);
    const onWorld = throttle((data) => { if (data.serverId === serverId) setWorldEvents(data.events || []); }, 500);
    const onEvents = (data) => {
      if (data.serverId !== serverId) return;
      if (data.initial) {
        setEvents(data.events || []);
      } else {
        setEvents(prev => [...prev, ...(data.events || [])].slice(-500));
      }
    };

    socket.on('citadel:status', onStatus);
    socket.on('citadel:players', onPlayers);
    socket.on('citadel:metrics', onMetrics);
    socket.on('citadel:vehicles', onVehicles);
    socket.on('citadel:world', onWorld);
    socket.on('citadel:events', onEvents);

    return () => {
      socket.emit('citadel:unsubscribe');
      socket.off('citadel:status', onStatus);
      socket.off('citadel:players', onPlayers);
      socket.off('citadel:metrics', onMetrics);
      socket.off('citadel:vehicles', onVehicles);
      socket.off('citadel:world', onWorld);
      socket.off('citadel:events', onEvents);
      onStatus.cancel();
      onPlayers.cancel();
      onMetrics.cancel();
      onVehicles.cancel();
      onWorld.cancel();
    };
  }, [serverId, socket]);

  // Auto-scroll event feed
  useEffect(() => {
    if (eventFeedRef.current) {
      eventFeedRef.current.scrollTop = eventFeedRef.current.scrollHeight;
    }
  }, [events]);

  // ─── Command sender ─────────────────────────────────────
  const sendCommand = useCallback(async (action, params = {}) => {
    setCommandResult(null);
    try {
      const res = await API.post(`/api/servers/${serverId}/citadel/command`, { action, params });
      setCommandResult(res);
      if (res.success) {
        window.addToast?.(`Command ${action} executed`, 'success');
      } else {
        window.addToast?.(`Command failed: ${res.response?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      window.addToast?.(`Command error: ${err.message}`, 'error');
    }
  }, [serverId]);

  // ─── Derived data ───────────────────────────────────────
  const isActive = status?.active ?? false;
  const isStale = !isActive && status?.files?.players?.exists;
  const playerCount = players.length;
  const serverFps = metrics.fps ?? metrics.serverFPS ?? '--';
  const entityCount = metrics.entities ?? metrics.entityCount ?? '--';

  const filteredPlayers = useMemo(() => {
    if (!searchQuery) return players;
    const q = searchQuery.toLowerCase();
    return players.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.steamId || p.steam_id || '').includes(q)
    );
  }, [players, searchQuery]);

  const filteredEvents = useMemo(() => {
    if (eventFilter === 'all') return events;
    return events.filter(e => e.type === eventFilter);
  }, [events, eventFilter]);

  // ─── Map markers ────────────────────────────────────────
  const mapMarkers = useMemo(() => {
    const markers = [];

    // Player markers
    for (const p of players) {
      const pos = p.position || p.pos;
      if (!pos) continue;
      const x = pos.x ?? pos[0];
      const z = pos.z ?? pos[2];
      if (x == null || z == null) continue;

      const isDead = p.dead || p.health <= 0;
      const inVehicle = !!p.vehicleId || !!p.vehicle;
      const color = isDead ? '#ef4444' : inVehicle ? '#eab308' : '#22c55e';

      markers.push({
        id: `player-${p.steamId || p.steam_id || p.name}`,
        x, z,
        color,
        label: p.name || 'Unknown',
        size: selectedPlayer === (p.steamId || p.steam_id) ? 18 : 12,
        popup: `<strong>${p.name || 'Unknown'}</strong><br/>` +
          `Health: ${p.health != null ? Math.round(p.health) : '?'}<br/>` +
          `Blood: ${p.blood != null ? Math.round(p.blood) : '?'}<br/>` +
          `Pos: ${Math.round(x)}, ${Math.round(z)}`,
      });
    }

    // Vehicle markers
    for (const v of vehicles) {
      const pos = v.position || v.pos;
      if (!pos) continue;
      const x = pos.x ?? pos[0];
      const z = pos.z ?? pos[2];
      if (x == null || z == null) continue;

      const vid = v.id || v.vehicleId;
      markers.push({
        id: `vehicle-${vid}`,
        x, z,
        color: '#8b5cf6',
        label: v.className || v.type || 'Vehicle',
        size: selectedVehicle === vid ? 16 : 10,
      });
    }

    return markers;
  }, [players, vehicles, selectedPlayer, selectedVehicle]);

  if (loading) return <PageLoader />;

  return (
    <div className="live-dashboard">
      {/* ─── Top Metrics Bar ─────────────────────────────── */}
      <div className="live-metrics-bar">
        <div className="live-status-indicator">
          <StatusDot active={isActive} stale={isStale} />
          <span>{isActive ? 'Mod Active' : isStale ? 'Stale Data' : 'Mod Inactive'}</span>
        </div>
        <div className="live-metrics-row">
          <MetricChip icon={<Activity size={14} />} label="FPS" value={serverFps} warn={typeof serverFps === 'number' && serverFps < 20} />
          <MetricChip icon={<Users size={14} />} label="Players" value={playerCount} />
          <MetricChip icon={<Globe size={14} />} label="Entities" value={entityCount} />
          {metrics.uptime != null && (
            <MetricChip icon={<Clock size={14} />} label="Uptime" value={formatUptime(metrics.uptime)} />
          )}
        </div>
      </div>

      {/* ─── Tabs ────────────────────────────────────────── */}
      <div className="live-tabs">
        <TabButton active={tab === 'map'} onClick={() => setTab('map')}>
          <MapPin size={14} /> Live Map
        </TabButton>
        <TabButton active={tab === 'players'} onClick={() => setTab('players')}>
          <Users size={14} /> Player List
        </TabButton>
        <TabButton active={tab === 'events'} onClick={() => setTab('events')}>
          <Zap size={14} /> Event Feed
        </TabButton>
        <TabButton active={tab === 'admin'} onClick={() => setTab('admin')}>
          <Shield size={14} /> Admin Tools
        </TabButton>
      </div>

      {/* ─── Tab Content ─────────────────────────────────── */}
      <div className="live-tab-content">
        {tab === 'map' && (
          <LiveMapTab
            markers={mapMarkers}
            players={players}
            vehicles={vehicles}
            onSelectPlayer={setSelectedPlayer}
            selectedVehicle={selectedVehicle}
            setSelectedVehicle={setSelectedVehicle}
            sendCommand={sendCommand}
          />
        )}
        {tab === 'players' && (
          <PlayersTab
            players={filteredPlayers}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedPlayer={selectedPlayer}
            setSelectedPlayer={setSelectedPlayer}
            sendCommand={sendCommand}
          />
        )}
        {tab === 'events' && (
          <EventsTab
            events={filteredEvents}
            eventFilter={eventFilter}
            setEventFilter={setEventFilter}
            eventFeedRef={eventFeedRef}
          />
        )}
        {tab === 'admin' && (
          <AdminToolsTab sendCommand={sendCommand} commandResult={commandResult} />
        )}
      </div>
    </div>
  );
}

// ─── Tab: Live Map ────────────────────────────────────────

function LiveMapTab({ markers, players, vehicles, onSelectPlayer, selectedVehicle, setSelectedVehicle, sendCommand }) {
  const [vehicleCtx, setVehicleCtx] = useState(null);
  const [teleportMode, setTeleportMode] = useState(null);

  const selectedVehicleData = useMemo(() => {
    if (!selectedVehicle) return null;
    return vehicles.find(v => (v.id || v.vehicleId) === selectedVehicle) || null;
  }, [vehicles, selectedVehicle]);

  const handleSelect = useCallback((id) => {
    setVehicleCtx(null);
    if (id?.startsWith('player-')) {
      setSelectedVehicle(null);
      onSelectPlayer(id.replace('player-', ''));
    } else if (id?.startsWith('vehicle-')) {
      onSelectPlayer(null);
      const vid = id.replace('vehicle-', '');
      setSelectedVehicle(prev => prev === vid ? null : vid);
    }
  }, [onSelectPlayer, setSelectedVehicle]);

  const handleContextMenu = useCallback((id, clientX, clientY) => {
    if (!id?.startsWith('vehicle-')) return;
    const vid = id.replace('vehicle-', '');
    const veh = vehicles.find(v => (v.id || v.vehicleId) === vid);
    if (veh) setVehicleCtx({ x: clientX, y: clientY, vehicle: veh, vehicleId: vid });
  }, [vehicles]);

  const handleVehicleAction = useCallback((action, vehicleId) => {
    setVehicleCtx(null);
    if (action === 'vehicle.teleport') {
      setTeleportMode(vehicleId);
      window.addToast?.('Click on the map to set teleport destination', 'info');
      return;
    }
    sendCommand(action, { vehicleId });
  }, [sendCommand]);

  const handleTeleportPlace = useCallback((x, z) => {
    if (!teleportMode) return;
    sendCommand('vehicle.teleport', { vehicleId: teleportMode, x, y: 0, z });
    setTeleportMode(null);
  }, [teleportMode, sendCommand]);

  return (
    <div className="live-map-container">
      <Suspense fallback={<PageLoader />}>
        <InteractiveMap
          mapName={serverMap}
          markers={markers}
          height={600}
          mode={teleportMode ? 'addMarker' : 'view'}
          selectedId={selectedVehicle ? `vehicle-${selectedVehicle}` : null}
          onSelect={handleSelect}
          onContextMenu={handleContextMenu}
          onMarkerAdd={handleTeleportPlace}
        />
      </Suspense>

      {/* Teleport mode banner */}
      {teleportMode && (
        <div className="live-map-teleport-banner">
          <Navigation size={14} />
          <span>Click on the map to teleport vehicle</span>
          <button onClick={() => setTeleportMode(null)}>Cancel</button>
        </div>
      )}

      {/* Vehicle info panel */}
      {selectedVehicleData && !teleportMode && (
        <VehicleInfoPanel
          vehicle={selectedVehicleData}
          vehicleId={selectedVehicle}
          onClose={() => setSelectedVehicle(null)}
          onAction={(action) => handleVehicleAction(action, selectedVehicle)}
        />
      )}

      {/* Vehicle context menu */}
      {vehicleCtx && (
        <>
          <div className="live-context-overlay" onClick={() => setVehicleCtx(null)} />
          <div className="live-context-menu" style={{ top: vehicleCtx.y, left: vehicleCtx.x }}>
            <div className="live-context-header">
              <Truck size={13} /> {vehicleCtx.vehicle.className || 'Vehicle'}
            </div>
            {VEHICLE_ACTIONS.map(item => (
              <button
                key={item.action}
                className={`live-context-item ${item.danger ? 'live-context-danger' : ''}`}
                onClick={() => handleVehicleAction(item.action, vehicleCtx.vehicleId)}
              >
                {item.icon} {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {players.length === 0 && !vehicles.length && (
        <div className="live-map-empty">No players online — markers will appear when players connect</div>
      )}
    </div>
  );
}

function VehicleInfoPanel({ vehicle, vehicleId, onClose, onAction }) {
  const pos = vehicle.position || vehicle.pos || {};
  const x = Math.round(pos.x ?? pos[0] ?? 0);
  const z = Math.round(pos.z ?? pos[2] ?? 0);
  const health = vehicle.health != null ? Math.round(vehicle.health) : '--';
  const maxHealth = vehicle.maxHealth != null ? Math.round(vehicle.maxHealth) : '--';
  const healthPct = (vehicle.maxHealth > 0) ? Math.round((vehicle.health / vehicle.maxHealth) * 100) : null;

  return (
    <div className="live-vehicle-info">
      <div className="live-vehicle-info-header">
        <Truck size={14} />
        <span className="live-vehicle-info-name">{vehicle.className || vehicle.type || 'Vehicle'}</span>
        <button className="live-vehicle-info-close" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="live-vehicle-info-body">
        <div className="live-vehicle-info-row">
          <span>Health</span>
          <span className={healthPct != null && healthPct < 50 ? 'live-health-low' : ''}>
            {health} / {maxHealth} {healthPct != null && `(${healthPct}%)`}
          </span>
        </div>
        <div className="live-vehicle-info-row">
          <span>Position</span>
          <span>{x}, {z}</span>
        </div>
        <div className="live-vehicle-info-row">
          <span>Network ID</span>
          <span>{vehicleId}</span>
        </div>
        {vehicle.type && (
          <div className="live-vehicle-info-row">
            <span>Type</span>
            <span>{vehicle.type}</span>
          </div>
        )}
      </div>
      <div className="live-vehicle-info-actions">
        <button className="btn btn-xs btn-blue" onClick={() => onAction('vehicle.repair')} title="Repair"><Wrench size={12} /> Repair</button>
        <button className="btn btn-xs btn-blue" onClick={() => onAction('vehicle.refuel')} title="Refuel"><Droplets size={12} /> Refuel</button>
        <button className="btn btn-xs btn-blue" onClick={() => onAction('vehicle.unstuck')} title="Unstuck"><ArrowUpFromLine size={12} /> Unstuck</button>
        <button className="btn btn-xs btn-red" onClick={() => onAction('vehicle.delete')} title="Delete"><Trash2 size={12} /> Delete</button>
      </div>
    </div>
  );
}

// ─── Tab: Player List ─────────────────────────────────────

function PlayersTab({ players, searchQuery, setSearchQuery, selectedPlayer, setSelectedPlayer, sendCommand }) {
  const [contextMenu, setContextMenu] = useState(null);

  const handleAction = useCallback((action, player) => {
    const steamId = player.steamId || player.steam_id;
    sendCommand(action, { steamId });
    setContextMenu(null);
  }, [sendCommand]);

  return (
    <div className="live-players-tab">
      <div className="live-search-bar">
        <Search size={14} />
        <input
          type="text"
          placeholder="Search by name or Steam ID..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="live-search-input"
        />
        <span className="live-player-count">{players.length} online</span>
      </div>

      <div className="live-players-table-wrap">
        <table className="live-players-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Steam ID</th>
              <th>Position</th>
              <th>Health</th>
              <th>Blood</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {players.length === 0 ? (
              <tr><td colSpan={7} className="live-empty-row">No players online</td></tr>
            ) : players.map((p, i) => {
              const steamId = p.steamId || p.steam_id || '';
              const pos = p.position || p.pos;
              const posStr = pos ? `${Math.round(pos.x ?? pos[0] ?? 0)}, ${Math.round(pos.z ?? pos[2] ?? 0)}` : '--';
              const isDead = p.dead || (p.health != null && p.health <= 0);
              const health = p.health != null ? Math.round(p.health) : '--';
              const blood = p.blood != null ? Math.round(p.blood) : '--';
              const isSelected = selectedPlayer === steamId;

              return (
                <tr
                  key={steamId || i}
                  className={`live-player-row ${isSelected ? 'live-player-selected' : ''} ${isDead ? 'live-player-dead' : ''}`}
                  onClick={() => setSelectedPlayer(isSelected ? null : steamId)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, player: p });
                  }}
                >
                  <td className="live-player-name">
                    <span className={`live-player-dot ${isDead ? 'dead' : 'alive'}`} />
                    {p.name || 'Unknown'}
                  </td>
                  <td className="live-player-steam">{steamId}</td>
                  <td>{posStr}</td>
                  <td className={health < 50 ? 'live-health-low' : ''}>{health}</td>
                  <td className={blood < 3000 ? 'live-blood-low' : ''}>{blood}</td>
                  <td>{isDead ? 'Dead' : p.unconscious ? 'Unconscious' : 'Alive'}</td>
                  <td>
                    <div className="live-action-btns">
                      <button className="btn btn-xs btn-green" onClick={(e) => { e.stopPropagation(); handleAction('player.heal', p); }} title="Heal">
                        <Heart size={12} />
                      </button>
                      <button className="btn btn-xs btn-red" onClick={(e) => { e.stopPropagation(); handleAction('player.kill', p); }} title="Kill">
                        <Skull size={12} />
                      </button>
                      <button className="btn btn-xs btn-blue" onClick={(e) => { e.stopPropagation(); handleAction('player.kick', p); }} title="Kick">
                        <Zap size={12} />
                      </button>
                      <button className="btn btn-xs btn-purple" onClick={(e) => { e.stopPropagation(); handleAction('player.freeze', p); }} title="Freeze">
                        <Shield size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="live-context-overlay" onClick={() => setContextMenu(null)} />
          <div className="live-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <div className="live-context-header">{contextMenu.player.name || 'Player'}</div>
            {[
              { label: 'Heal', action: 'player.heal', icon: <Heart size={13} /> },
              { label: 'Kill', action: 'player.kill', icon: <Skull size={13} /> },
              { label: 'Kick', action: 'player.kick', icon: <Zap size={13} /> },
              { label: 'Freeze', action: 'player.freeze', icon: <Shield size={13} /> },
              { label: 'God Mode', action: 'player.setGodmode', icon: <Shield size={13} /> },
              { label: 'Teleport', action: 'player.teleport', icon: <Navigation size={13} /> },
              { label: 'Message', action: 'player.message', icon: <MessageSquare size={13} /> },
              { label: 'Get Info', action: 'player.getFull', icon: <Eye size={13} /> },
            ].map(item => (
              <button key={item.action} className="live-context-item" onClick={() => handleAction(item.action, contextMenu.player)}>
                {item.icon} {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Event Feed ──────────────────────────────────────

function EventsTab({ events, eventFilter, setEventFilter, eventFeedRef }) {
  const eventTypes = ['all', 'kill', 'death', 'connect', 'disconnect', 'chat', 'admin', 'hit', 'vehicle', 'build'];

  return (
    <div className="live-events-tab">
      <div className="live-events-filter">
        <Filter size={14} />
        {eventTypes.map(type => (
          <button
            key={type}
            className={`live-filter-btn ${eventFilter === type ? 'live-filter-active' : ''}`}
            onClick={() => setEventFilter(type)}
            style={type !== 'all' ? { borderLeftColor: eventColor(type) } : {}}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      <div className="live-events-feed" ref={eventFeedRef}>
        {events.length === 0 ? (
          <div className="live-events-empty">No events yet — events will stream in real-time</div>
        ) : events.map((evt, i) => (
          <div key={i} className="live-event-row" style={{ borderLeftColor: eventColor(evt.type) }}>
            <span className="live-event-time">{formatEventTime(evt.timestamp || evt.time)}</span>
            <span className="live-event-type" style={{ color: eventColor(evt.type) }}>[{evt.type || 'event'}]</span>
            <span className="live-event-text">{formatEventText(evt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatEventTime(ts) {
  if (!ts) return '--:--';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '--:--';
  }
}

function formatEventText(evt) {
  if (evt.message) return evt.message;
  if (evt.text) return evt.text;

  const parts = [];
  if (evt.player || evt.playerName) parts.push(evt.player || evt.playerName);
  if (evt.type === 'kill' || evt.type === 'death') {
    if (evt.killer || evt.killerName) parts.push(`killed by ${evt.killer || evt.killerName}`);
    if (evt.weapon) parts.push(`with ${evt.weapon}`);
    if (evt.distance != null) parts.push(`(${Math.round(evt.distance)}m)`);
  }
  if (evt.type === 'connect' || evt.type === 'disconnect') {
    parts.push(evt.type === 'connect' ? 'connected' : 'disconnected');
  }
  if (evt.type === 'chat' && evt.content) {
    parts.push(`: ${evt.content}`);
  }

  return parts.join(' ') || JSON.stringify(evt);
}

// ─── Tab: Admin Tools ─────────────────────────────────────

function AdminToolsTab({ sendCommand, commandResult }) {
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [timeHour, setTimeHour] = useState(12);
  const [timeMinute, setTimeMinute] = useState(0);

  const quickActions = [
    {
      category: 'Weather',
      actions: [
        { label: 'Sunny', icon: <Sun size={16} />, action: 'world.sunny', params: {} },
        { label: 'Rain', icon: <CloudRain size={16} />, action: 'world.weather', params: { overcast: 1.0, rain: 0.8 } },
        { label: 'Fog', icon: <Haze size={16} />, action: 'world.setFog', params: { density: 0.8 } },
        { label: 'Storm', icon: <Wind size={16} />, action: 'world.weather', params: { overcast: 1.0, rain: 1.0, wind: 1.0 } },
      ],
    },
    {
      category: 'World',
      actions: [
        { label: 'Wipe AI', icon: <Target size={16} />, action: 'world.wipeAI', params: {} },
        { label: 'Wipe Vehicles', icon: <Truck size={16} />, action: 'world.wipeVehicles', params: {} },
        { label: 'Clear Trees (500m)', icon: <TreePine size={16} />, action: 'world.flattenTrees', params: { x: 7500, z: 7500, radius: 500 } },
      ],
    },
    {
      category: 'Spawn',
      actions: [
        { label: 'Heli Crash', icon: <Bomb size={16} />, action: 'spawn.heliCrash', params: { coords: { x: 7500, y: 0, z: 7500 } } },
        { label: 'Gas Zone', icon: <Haze size={16} />, action: 'spawn.gasZone', params: { coords: { x: 7500, y: 0, z: 7500 } } },
      ],
    },
  ];

  return (
    <div className="live-admin-tab">
      {/* Broadcast */}
      <div className="live-admin-section">
        <h3>Broadcast Message</h3>
        <div className="live-broadcast-row">
          <input
            type="text"
            placeholder="Type a message to all players..."
            value={broadcastMsg}
            onChange={e => setBroadcastMsg(e.target.value)}
            className="live-broadcast-input"
            onKeyDown={e => {
              if (e.key === 'Enter' && broadcastMsg.trim()) {
                sendCommand('world.broadcast', { text: broadcastMsg.trim() });
                setBroadcastMsg('');
              }
            }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { sendCommand('world.broadcast', { text: broadcastMsg.trim() }); setBroadcastMsg(''); }}
            disabled={!broadcastMsg.trim()}
          >
            <Send size={14} /> Send
          </button>
        </div>
      </div>

      {/* Set Time */}
      <div className="live-admin-section">
        <h3>Set Time</h3>
        <div className="live-time-row">
          <label>
            Hour:
            <input type="number" min={0} max={23} value={timeHour} onChange={e => setTimeHour(Number(e.target.value))} className="live-time-input" />
          </label>
          <label>
            Minute:
            <input type="number" min={0} max={59} value={timeMinute} onChange={e => setTimeMinute(Number(e.target.value))} className="live-time-input" />
          </label>
          <button className="btn btn-primary btn-sm" onClick={() => sendCommand('world.time', { hour: timeHour, minute: timeMinute })}>
            <Clock size={14} /> Set Time
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      {quickActions.map(group => (
        <div key={group.category} className="live-admin-section">
          <h3>{group.category}</h3>
          <div className="live-action-grid">
            {group.actions.map(act => (
              <button
                key={act.action + act.label}
                className="live-quick-action"
                onClick={() => sendCommand(act.action, act.params)}
              >
                {act.icon}
                <span>{act.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Command Result */}
      {commandResult && (
        <div className={`live-command-result ${commandResult.success ? 'success' : 'error'}`}>
          <strong>{commandResult.success ? 'Success' : 'Failed'}:</strong>{' '}
          {commandResult.response?.error || JSON.stringify(commandResult.response?.data || commandResult)}
        </div>
      )}
    </div>
  );
}
