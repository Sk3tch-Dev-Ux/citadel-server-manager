import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import API from '../api';
import Modal from '../components/ui/Modal';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import useServerMap from '../hooks/useServerMap';
import {
  Search, Save, Plus, Trash2, RefreshCw, Edit, ChevronUp, ChevronDown, X,
  Map, MapPin, Layers, Filter, Crosshair, MousePointerClick, Target,
} from '../components/Icon';

// Lazy-load InteractiveMap to avoid loading leaflet on initial render
const InteractiveMap = lazy(() => import('../components/InteractiveMap'));

// ─── Constants ──────────────────────────────────────────────

const NUMERIC_FIELDS = ['nominal', 'min', 'max', 'lifetime', 'restock', 'saferadius', 'distanceradius', 'cleanupradius'];
const NUMERIC_LABELS = {
  nominal: 'Nominal', min: 'Min', max: 'Max', lifetime: 'Lifetime', restock: 'Restock',
  saferadius: 'Safe Radius', distanceradius: 'Distance Radius', cleanupradius: 'Cleanup Radius',
};
const FLAG_FIELDS = ['deletable', 'init_random', 'remove_damaged'];
const TABLE_COLUMNS = ['name', 'nominal', 'min', 'max', 'lifetime', 'restock', 'position', 'children'];
const COLUMN_LABELS = {
  name: 'Name', nominal: 'Nominal', min: 'Min', max: 'Max', lifetime: 'Lifetime',
  restock: 'Restock', position: 'Position', children: 'Children',
};

const DEFAULT_EVENT = {
  name: '', nominal: 0, min: 0, max: 0, lifetime: 0, restock: 0,
  saferadius: 0, distanceradius: 0, cleanupradius: 0,
  flags: { deletable: 0, init_random: 0, remove_damaged: 0 },
  position: 'fixed', secondary: null, children: [],
};

const DEFAULT_CHILD = { type: '', lootmin: 0, lootmax: 0, min: 0, max: 0 };

const PAGE_SIZE = 100;

// ─── Category Detection ─────────────────────────────────────

function getEventCategory(name) {
  if (name.startsWith('Vehicle')) return 'vehicle';
  if (name.startsWith('Static')) return 'static';
  if (name.startsWith('Animal') || name.startsWith('Ambient')) return 'animal';
  if (name.startsWith('Infected')) return 'infected';
  if (name.startsWith('Trajectory')) return 'trajectory';
  return 'other';
}

const CATEGORY_COLORS = {
  vehicle: '#3b82f6',
  static: '#f59e0b',
  animal: '#22c55e',
  infected: '#ef4444',
  trajectory: '#eab308',
  other: '#8b5cf6',
};

const CATEGORY_LABELS = {
  vehicle: 'Vehicles',
  static: 'Static Events',
  animal: 'Animals',
  infected: 'Infected',
  trajectory: 'Trajectory',
  other: 'Other',
};

// ─── Main Component ─────────────────────────────────────────

export default function EventsEditorPage({ serverId }) {
  // Data state
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filter / sort state
  const [searchText, setSearchText] = useState('');
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  // Modal state
  const [editEvent, setEditEvent] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  // Pagination
  const [page, setPage] = useState(0);

  // Track which event names have been modified
  const [modifiedNames, setModifiedNames] = useState(new Set());

  // View mode: 'table' or 'map'
  const [viewMode, setViewMode] = useState('table');

  // Spawn positions data (for map view)
  const [spawns, setSpawns] = useState({});
  const [spawnsLoading, setSpawnsLoading] = useState(false);
  const [spawnsModified, setSpawnsModified] = useState(false);
  const [savingSpawns, setSavingSpawns] = useState(false);

  // Map view state
  const [categoryFilters, setCategoryFilters] = useState({
    vehicle: true, static: true, animal: true, infected: true, trajectory: true, other: true,
  });
  const [mapSearchText, setMapSearchText] = useState('');
  const [selectedEventName, setSelectedEventName] = useState(null);
  const [selectedPositionIdx, setSelectedPositionIdx] = useState(null);
  const [mapMode, setMapMode] = useState('view'); // 'view' | 'addMarker'
  const defaultMap = useServerMap(serverId);
  const [mapName, setMapName] = useState(defaultMap);

  // ─── Data Loading ───────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/events`);
      if (data.events) {
        setEvents(data.events);
        setModifiedNames(new Set());
      } else if (data.error) {
        window.addToast?.(data.error, 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to load events data', 'error');
    }
    setLoading(false);
  }, [serverId]);

  const loadSpawns = useCallback(async () => {
    setSpawnsLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/events/spawns`);
      // Convert array of { name, positions } to object keyed by name
      const eventsArray = data.events || (Array.isArray(data) ? data : null);
      if (eventsArray) {
        const spawnMap = {};
        for (const ev of eventsArray) {
          if (ev.name) spawnMap[ev.name] = { positions: ev.positions || [] };
        }
        setSpawns(spawnMap);
        setSpawnsModified(false);
      } else if (data.error) {
        window.addToast?.(data.error, 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to load spawn positions', 'error');
    }
    setSpawnsLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load spawns when switching to map view
  useEffect(() => {
    if (viewMode === 'map' && Object.keys(spawns).length === 0 && !spawnsLoading) {
      loadSpawns();
    }
  }, [viewMode, spawns, spawnsLoading, loadSpawns]);

  // ─── Filtering & Sorting ───────────────────────────────

  const filtered = useMemo(() => {
    if (!searchText) return events;
    const s = searchText.toLowerCase();
    return events.filter(e => e.name.toLowerCase().includes(s));
  }, [events, searchText]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let va, vb;
      if (sortCol === 'children') {
        va = (a.children || []).length;
        vb = (b.children || []).length;
      } else {
        va = a[sortCol];
        vb = b[sortCol];
      }
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      va = String(va || ''); vb = String(vb || '');
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  const paged = useMemo(() => sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sorted, page]);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  useEffect(() => setPage(0), [searchText]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  // ─── Modification Tracking ─────────────────────────────

  const modifiedCount = modifiedNames.size;

  const updateEvent = (name, updated) => {
    setEvents(prev => prev.map(e => e.name === name ? { ...updated } : e));
    setModifiedNames(prev => new Set(prev).add(name));
  };

  // ─── Save ───────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (modifiedNames.size === 0) { window.addToast?.('No changes to save', 'info'); return; }
    setSaving(true);
    try {
      const result = await API.put(`/api/servers/${serverId}/events`, { events });
      if (result.error) { window.addToast?.(result.error, 'error'); }
      else {
        window.addToast?.(`Saved ${result.eventCount} events`, 'success');
        setModifiedNames(new Set());
      }
    } catch { window.addToast?.('Failed to save', 'error'); }
    setSaving(false);
  }, [serverId, events, modifiedNames]);

  const handleSaveSpawns = useCallback(async () => {
    if (!spawnsModified) { window.addToast?.('No spawn changes to save', 'info'); return; }
    setSavingSpawns(true);
    try {
      // Convert object keyed by name back to array format for the API
      const eventsArray = Object.entries(spawns).map(([name, data]) => ({ name, positions: data.positions || [] }));
      const result = await API.put(`/api/servers/${serverId}/events/spawns`, { events: eventsArray });
      if (result.error) { window.addToast?.(result.error, 'error'); }
      else {
        window.addToast?.('Saved spawn positions', 'success');
        setSpawnsModified(false);
      }
    } catch { window.addToast?.('Failed to save spawn positions', 'error'); }
    setSavingSpawns(false);
  }, [serverId, spawns, spawnsModified]);

  useKeyboardShortcuts({ 'ctrl+s': viewMode === 'map' ? handleSaveSpawns : handleSave });

  // ─── Add Event ─────────────────────────────────────────

  const handleAddEvent = async (newEvent) => {
    const result = await API.post(`/api/servers/${serverId}/events/add`, { event: newEvent });
    if (result.error) { window.addToast?.(result.error, 'error'); return false; }
    window.addToast?.(`Added "${newEvent.name}"`, 'success');
    await loadData();
    setShowAddModal(false);
    return true;
  };

  // ─── Delete Event ──────────────────────────────────────

  const handleDeleteEvent = async (event) => {
    const result = await API.del(`/api/servers/${serverId}/events/item?name=${encodeURIComponent(event.name)}`);
    if (result?.error) { window.addToast?.(result.error, 'error'); return; }
    window.addToast?.(`Deleted "${event.name}"`, 'success');
    setEvents(prev => prev.filter(e => e.name !== event.name));
    setModifiedNames(prev => {
      const next = new Set(prev);
      next.delete(event.name);
      return next;
    });
    setShowDeleteConfirm(null);
  };

  // ─── Map Spawn Helpers ─────────────────────────────────

  const updateSpawnPositions = useCallback((eventName, positions) => {
    setSpawns(prev => ({
      ...prev,
      [eventName]: { ...prev[eventName], positions },
    }));
    setSpawnsModified(true);
  }, []);

  const addSpawnPosition = useCallback((eventName, x, z) => {
    setSpawns(prev => {
      const eventData = prev[eventName] || { positions: [] };
      const newPos = { x: Math.round(x), z: Math.round(z), a: 0 };
      return {
        ...prev,
        [eventName]: {
          ...eventData,
          positions: [...(eventData.positions || []), newPos],
        },
      };
    });
    setSpawnsModified(true);
  }, []);

  const removeSpawnPosition = useCallback((eventName, idx) => {
    setSpawns(prev => {
      const eventData = prev[eventName];
      if (!eventData) return prev;
      const positions = [...eventData.positions];
      positions.splice(idx, 1);
      return {
        ...prev,
        [eventName]: { ...eventData, positions },
      };
    });
    setSpawnsModified(true);
    setSelectedPositionIdx(null);
  }, []);

  const moveSpawnPosition = useCallback((eventName, idx, newX, newZ) => {
    setSpawns(prev => {
      const eventData = prev[eventName];
      if (!eventData) return prev;
      const positions = [...eventData.positions];
      positions[idx] = { ...positions[idx], x: Math.round(newX), z: Math.round(newZ) };
      return {
        ...prev,
        [eventName]: { ...eventData, positions },
      };
    });
    setSpawnsModified(true);
  }, []);

  const updateSpawnPositionField = useCallback((eventName, idx, field, value) => {
    setSpawns(prev => {
      const eventData = prev[eventName];
      if (!eventData) return prev;
      const positions = [...eventData.positions];
      positions[idx] = { ...positions[idx], [field]: value };
      return {
        ...prev,
        [eventName]: { ...eventData, positions },
      };
    });
    setSpawnsModified(true);
  }, []);

  // ─── Map Data Computation ──────────────────────────────

  // Build a list of events with spawn data for the sidebar
  const eventsWithSpawns = useMemo(() => {
    const list = [];
    const spawnNames = new Set(Object.keys(spawns));

    // Merge events.xml names with cfgeventspawns.xml names
    const allNames = new Set([...events.map(e => e.name), ...spawnNames]);

    for (const name of allNames) {
      const cat = getEventCategory(name);
      const spawnData = spawns[name];
      const eventData = events.find(e => e.name === name);
      const posCount = spawnData?.positions?.length || 0;

      list.push({
        name,
        category: cat,
        color: CATEGORY_COLORS[cat],
        positionCount: posCount,
        hasSpawns: !!spawnData,
        hasEventDef: !!eventData,
        eventData,
        spawnData,
      });
    }

    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [events, spawns]);

  // Filter sidebar events
  const filteredMapEvents = useMemo(() => {
    let list = eventsWithSpawns;
    // Category filter
    list = list.filter(e => categoryFilters[e.category]);
    // Text filter
    if (mapSearchText) {
      const s = mapSearchText.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(s));
    }
    return list;
  }, [eventsWithSpawns, categoryFilters, mapSearchText]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const e of eventsWithSpawns) {
      counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return counts;
  }, [eventsWithSpawns]);

  // Build map markers and circles
  const { mapMarkers, mapCircles } = useMemo(() => {
    const markers = [];
    const circles = [];

    for (const ev of filteredMapEvents) {
      if (!ev.spawnData?.positions) continue;

      ev.spawnData.positions.forEach((pos, idx) => {
        const markerId = `${ev.name}::${idx}`;
        const isSelected = selectedEventName === ev.name;

        // If the position has zone data with radius, render as circle
        if (pos.r && pos.r > 0) {
          circles.push({
            id: markerId,
            x: pos.x,
            z: pos.z,
            radius: pos.r,
            color: ev.color,
            label: isSelected ? `${ev.name} #${idx + 1}` : '',
            draggable: true,
          });
        } else {
          markers.push({
            id: markerId,
            x: pos.x,
            z: pos.z,
            color: ev.color,
            label: isSelected ? `${ev.name} #${idx + 1}` : '',
            draggable: true,
          });
        }
      });
    }

    return { mapMarkers: markers, mapCircles: circles };
  }, [filteredMapEvents, selectedEventName]);

  // Determine the selectedId for the map
  const mapSelectedId = useMemo(() => {
    if (selectedEventName && selectedPositionIdx !== null) {
      return `${selectedEventName}::${selectedPositionIdx}`;
    }
    return null;
  }, [selectedEventName, selectedPositionIdx]);

  // ─── Map Event Handlers ────────────────────────────────

  const handleMarkerMove = useCallback((markerId, newX, newZ) => {
    const [eventName, idxStr] = markerId.split('::');
    const idx = parseInt(idxStr, 10);
    moveSpawnPosition(eventName, idx, newX, newZ);
  }, [moveSpawnPosition]);

  const handleMarkerAdd = useCallback((x, z) => {
    if (!selectedEventName) {
      window.addToast?.('Select an event first to add positions', 'info');
      return;
    }
    addSpawnPosition(selectedEventName, x, z);
    setMapMode('view');
  }, [selectedEventName, addSpawnPosition]);

  const handleMarkerDelete = useCallback((markerId) => {
    const [eventName, idxStr] = markerId.split('::');
    const idx = parseInt(idxStr, 10);
    removeSpawnPosition(eventName, idx);
  }, [removeSpawnPosition]);

  const handleMarkerSelect = useCallback((markerId) => {
    if (!markerId) return;
    const [eventName, idxStr] = markerId.split('::');
    const idx = parseInt(idxStr, 10);
    setSelectedEventName(eventName);
    setSelectedPositionIdx(idx);
  }, []);

  const handleCircleMove = useCallback((circleId, newX, newZ) => {
    const [eventName, idxStr] = circleId.split('::');
    const idx = parseInt(idxStr, 10);
    moveSpawnPosition(eventName, idx, newX, newZ);
  }, [moveSpawnPosition]);

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="types-editor">
        <div className="types-loading">
          <RefreshCw size={24} className="spin" />
          <span>Loading events data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="types-editor">
      {/* Toolbar */}
      <div className="types-toolbar">
        <div className="types-toolbar-left">
          {/* View Mode Toggle */}
          <div className="events-view-toggle">
            <button
              className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('table')}
              title="Table View"
            >
              <Layers size={14} /> Table
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'map' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('map')}
              title="Map View"
            >
              <Map size={14} /> Map
            </button>
          </div>

          {viewMode === 'table' && (
            <>
              <div className="types-search">
                <Search size={14} />
                <input
                  className="input"
                  placeholder="Search events..."
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                />
              </div>
              {searchText && (
                <button className="btn btn-sm btn-secondary" onClick={() => setSearchText('')}>
                  <X size={14} /> Clear
                </button>
              )}
            </>
          )}
        </div>
        <div className="types-toolbar-right">
          {viewMode === 'table' ? (
            <>
              <span className="types-stats">
                {sorted.length.toLocaleString()} events
                {modifiedCount > 0 && <span className="types-modified-badge">{modifiedCount} modified</span>}
              </span>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowAddModal(true)}>
                <Plus size={14} /> Add Event
              </button>
              <button className="btn btn-sm btn-secondary" onClick={loadData}>
                <RefreshCw size={14} /> Reload
              </button>
              <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving || modifiedCount === 0}>
                <Save size={14} /> {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <span className="types-stats">
                {Object.keys(spawns).length} event groups
                {spawnsModified && <span className="types-modified-badge">modified</span>}
              </span>
              <button className="btn btn-sm btn-secondary" onClick={loadSpawns}>
                <RefreshCw size={14} /> Reload Spawns
              </button>
              <button className="btn btn-sm btn-primary" onClick={handleSaveSpawns} disabled={savingSpawns || !spawnsModified}>
                <Save size={14} /> {savingSpawns ? 'Saving...' : 'Save Spawns'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table View */}
      {viewMode === 'table' && (
        <>
          <div className="types-table-wrap">
            <table className="types-table">
              <thead>
                <tr>
                  {TABLE_COLUMNS.map(col => (
                    <th key={col} className={`types-th sortable ${sortCol === col ? 'sorted' : ''}`} onClick={() => handleSort(col)}>
                      {COLUMN_LABELS[col]}
                      {sortCol === col && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </th>
                  ))}
                  <th className="types-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((event) => (
                  <tr
                    key={event.name}
                    className={modifiedNames.has(event.name) ? 'modified' : ''}
                    onDoubleClick={() => setEditEvent({ ...event, flags: { ...event.flags }, children: event.children.map(c => ({ ...c })) })}
                  >
                    <td className="types-td-name" title={event.name}>{event.name}</td>
                    <td className="types-td-num">{event.nominal}</td>
                    <td className="types-td-num">{event.min}</td>
                    <td className="types-td-num">{event.max}</td>
                    <td className="types-td-num">{event.lifetime}</td>
                    <td className="types-td-num">{event.restock}</td>
                    <td className="types-td-cat">{event.position}</td>
                    <td className="types-td-num">{(event.children || []).length}</td>
                    <td className="types-td-actions" onClick={e => e.stopPropagation()}>
                      <button className="btn-icon btn-icon-sm" title="Edit" onClick={() => setEditEvent({ ...event, flags: { ...event.flags }, children: event.children.map(c => ({ ...c })) })}>
                        <Edit size={13} />
                      </button>
                      <button className="btn-icon btn-icon-sm" title="Delete" onClick={() => setShowDeleteConfirm(event)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="types-pagination">
              <button className="btn btn-sm btn-secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span className="types-page-info">Page {page + 1} of {totalPages}</span>
              <button className="btn btn-sm btn-secondary" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* Map View */}
      {viewMode === 'map' && (
        <div className="events-map-layout">
          {/* Left Sidebar - Filters & Event List */}
          <div className="events-map-sidebar">
            {/* Category Filters */}
            <div className="events-map-section">
              <div className="events-map-section-header">
                <Filter size={14} />
                <span>Categories</span>
              </div>
              <div className="events-map-categories">
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                  const isDynamic = key === 'animal' || key === 'infected' || key === 'trajectory';
                  const posTotal = eventsWithSpawns.filter(e => e.category === key).reduce((sum, e) => sum + e.positionCount, 0);
                  return (
                  <label key={key} className="events-map-category-item" style={isDynamic && posTotal === 0 ? { opacity: 0.5 } : undefined}>
                    <input
                      type="checkbox"
                      checked={categoryFilters[key]}
                      onChange={e => setCategoryFilters(prev => ({ ...prev, [key]: e.target.checked }))}
                    />
                    <span
                      className="events-map-category-dot"
                      style={{ background: CATEGORY_COLORS[key] }}
                    />
                    <span className="events-map-category-label">{label}{isDynamic && posTotal === 0 ? ' (dynamic)' : ''}</span>
                    <span className="events-map-category-count">{posTotal > 0 ? posTotal : categoryCounts[key] || 0}</span>
                  </label>
                  );
                })}
              </div>
            </div>

            {/* Search */}
            <div className="events-map-section">
              <div className="events-map-search">
                <Search size={13} />
                <input
                  className="input"
                  placeholder="Filter events..."
                  value={mapSearchText}
                  onChange={e => setMapSearchText(e.target.value)}
                />
                {mapSearchText && (
                  <button className="events-map-search-clear" onClick={() => setMapSearchText('')}>
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Event List */}
            <div className="events-map-section events-map-section-list">
              <div className="events-map-section-header">
                <MapPin size={14} />
                <span>Events ({filteredMapEvents.length})</span>
              </div>
              <div className="events-map-event-list">
                {spawnsLoading ? (
                  <div className="events-map-loading">
                    <RefreshCw size={16} className="spin" />
                    <span>Loading spawns...</span>
                  </div>
                ) : (
                  filteredMapEvents.map(ev => (
                    <button
                      key={ev.name}
                      className={`events-map-event-item ${selectedEventName === ev.name ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedEventName(prev => prev === ev.name ? null : ev.name);
                        setSelectedPositionIdx(null);
                      }}
                    >
                      <span
                        className="events-map-category-dot"
                        style={{ background: ev.color }}
                      />
                      <span className="events-map-event-name" title={ev.name}>{ev.name}</span>
                      <span className="events-map-event-count">{ev.positionCount}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Center - Map */}
          <div className="events-map-center">
            {/* Map Tools Bar */}
            <div className="events-map-tools">
              <button
                className={`btn btn-sm ${mapMode === 'view' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMapMode('view')}
                title="Select / Pan"
              >
                <MousePointerClick size={14} /> Select
              </button>
              <button
                className={`btn btn-sm ${mapMode === 'addMarker' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  if (!selectedEventName) {
                    window.addToast?.('Select an event from the sidebar first', 'info');
                    return;
                  }
                  setMapMode(prev => prev === 'addMarker' ? 'view' : 'addMarker');
                }}
                title="Place Mode - Click map to add position"
              >
                <Crosshair size={14} /> Place
              </button>

              {selectedEventName && (
                <span className="events-map-active-event">
                  <Target size={13} />
                  {selectedEventName}
                  <button className="events-map-deselect" onClick={() => { setSelectedEventName(null); setSelectedPositionIdx(null); setMapMode('view'); }}>
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>

            {/* Map */}
            <div className="events-map-container">
              <Suspense fallback={
                <div className="events-map-loading-full">
                  <RefreshCw size={24} className="spin" />
                  <span>Loading map...</span>
                </div>
              }>
                <InteractiveMap
                  mapName={mapName}
                  markers={mapMarkers}
                  circles={mapCircles}
                  onMarkerMove={handleMarkerMove}
                  onMarkerAdd={handleMarkerAdd}
                  onMarkerDelete={handleMarkerDelete}
                  onCircleMove={handleCircleMove}
                  onSelect={handleMarkerSelect}
                  selectedId={mapSelectedId}
                  mode={mapMode}
                  height="100%"
                  onMapChange={setMapName}
                />
              </Suspense>
            </div>
          </div>

          {/* Right Panel - Event Details / Position Editor */}
          {selectedEventName && (
            <EventDetailPanel
              eventName={selectedEventName}
              eventData={events.find(e => e.name === selectedEventName)}
              spawnData={spawns[selectedEventName]}
              selectedPositionIdx={selectedPositionIdx}
              onSelectPosition={setSelectedPositionIdx}
              onRemovePosition={(idx) => removeSpawnPosition(selectedEventName, idx)}
              onUpdatePositionField={(idx, field, value) => updateSpawnPositionField(selectedEventName, idx, field, value)}
              onAddPosition={() => {
                setMapMode('addMarker');
                window.addToast?.('Click on the map to place a new position', 'info');
              }}
            />
          )}
        </div>
      )}

      {/* Edit Event Modal */}
      {editEvent && (
        <EditEventModal
          event={editEvent}
          onSave={(updated) => { updateEvent(updated.name, updated); setEditEvent(null); }}
          onClose={() => setEditEvent(null)}
        />
      )}

      {/* Add Event Modal */}
      {showAddModal && (
        <AddEventModal
          onAdd={handleAddEvent}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Delete Confirm */}
      {showDeleteConfirm && (
        <Modal open onClose={() => setShowDeleteConfirm(null)} title="Delete Event">
          <p style={{ marginBottom: 16 }}>Delete event <strong>{showDeleteConfirm.name}</strong>?</p>
          <p style={{ marginBottom: 20, fontSize: 13, color: 'var(--text-muted)' }}>A backup will be created before deletion.</p>
          <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowDeleteConfirm(null)}>Cancel</button>
            <button className="btn btn-sm btn-danger" onClick={() => handleDeleteEvent(showDeleteConfirm)}>Delete</button>
          </div>
        </Modal>
      )}

      {/* Inline styles for map view layout */}
      <style>{`
        .events-view-toggle {
          display: flex;
          gap: 2px;
          background: var(--bg-deep, #0d0f12);
          border-radius: 6px;
          padding: 2px;
          margin-right: 12px;
        }
        .events-view-toggle .btn {
          border-radius: 4px;
          gap: 5px;
        }

        /* ─── Map Layout ─── */
        .events-map-layout {
          display: flex;
          flex: 1;
          min-height: 0;
          gap: 0;
          border-top: 1px solid var(--border);
          height: calc(100vh - 180px);
        }

        /* ─── Left Sidebar ─── */
        .events-map-sidebar {
          width: 280px;
          min-width: 280px;
          background: var(--bg-card, #161a22);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .events-map-section {
          border-bottom: 1px solid var(--border);
          padding: 0;
        }
        .events-map-section-list {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          border-bottom: none;
        }
        .events-map-section-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
        }

        /* Categories */
        .events-map-categories {
          padding: 4px 10px 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .events-map-category-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 6px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          color: var(--text);
          transition: background 0.12s;
        }
        .events-map-category-item:hover {
          background: var(--bg-elevated, #1e2230);
        }
        .events-map-category-item input[type="checkbox"] {
          accent-color: var(--accent-blue);
          margin: 0;
        }
        .events-map-category-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .events-map-category-label {
          flex: 1;
        }
        .events-map-category-count {
          font-size: 11px;
          color: var(--text-muted);
          background: var(--bg-deep, #0d0f12);
          padding: 1px 6px;
          border-radius: 8px;
          font-weight: 500;
        }

        /* Search */
        .events-map-search {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          color: var(--text-muted);
          position: relative;
        }
        .events-map-search .input {
          flex: 1;
          font-size: 13px;
          padding: 5px 8px;
          background: var(--bg-deep, #0d0f12);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--text);
        }
        .events-map-search-clear {
          position: absolute;
          right: 16px;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
        }

        /* Event List */
        .events-map-event-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 6px;
        }
        .events-map-event-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 6px 10px;
          border: none;
          background: none;
          color: var(--text);
          font-size: 12px;
          cursor: pointer;
          border-radius: 4px;
          text-align: left;
          transition: background 0.12s;
        }
        .events-map-event-item:hover {
          background: var(--bg-elevated, #1e2230);
        }
        .events-map-event-item.selected {
          background: var(--accent-blue-dim, rgba(59,130,246,0.15));
          outline: 1px solid var(--accent-blue);
        }
        .events-map-event-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .events-map-event-count {
          font-size: 11px;
          color: var(--text-muted);
          background: var(--bg-deep, #0d0f12);
          padding: 1px 6px;
          border-radius: 8px;
          font-weight: 500;
          min-width: 22px;
          text-align: center;
        }
        .events-map-loading {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 20px;
          color: var(--text-muted);
          font-size: 13px;
          justify-content: center;
        }

        /* ─── Map Center ─── */
        .events-map-center {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .events-map-tools {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: var(--bg-card, #161a22);
          border-bottom: 1px solid var(--border);
          z-index: 10;
        }
        .events-map-tools .btn {
          gap: 5px;
        }
        .events-map-active-event {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-left: 12px;
          padding: 4px 10px;
          background: var(--accent-blue-dim, rgba(59,130,246,0.15));
          border: 1px solid var(--accent-blue);
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text);
        }
        .events-map-deselect {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 1px;
          display: flex;
          border-radius: 3px;
          margin-left: 2px;
        }
        .events-map-deselect:hover {
          color: var(--text);
          background: rgba(255,255,255,0.1);
        }
        .events-map-container {
          flex: 1;
          min-height: 0;
          position: relative;
        }
        .events-map-container .interactive-map {
          height: 100% !important;
        }
        .events-map-loading-full {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          height: 100%;
          color: var(--text-muted);
          font-size: 14px;
        }

        /* ─── Right Panel ─── */
        .events-detail-panel {
          width: 320px;
          min-width: 320px;
          background: var(--bg-card, #161a22);
          border-left: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .events-detail-header {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .events-detail-header h3 {
          font-size: 14px;
          font-weight: 600;
          margin: 0;
          word-break: break-all;
        }
        .events-detail-header .events-detail-category {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        /* Event Settings Summary */
        .events-detail-settings {
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
        }
        .events-detail-settings-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        .events-detail-settings-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px 12px;
        }
        .events-detail-stat {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          padding: 3px 0;
        }
        .events-detail-stat-label {
          color: var(--text-muted);
        }
        .events-detail-stat-value {
          font-weight: 500;
          font-family: var(--font-mono, monospace);
        }

        /* Positions List */
        .events-detail-positions {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .events-detail-positions-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
        }
        .events-detail-positions-header span {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
        }
        .events-detail-pos-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 6px;
        }
        .events-detail-pos-item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.12s;
        }
        .events-detail-pos-item:hover {
          background: var(--bg-elevated, #1e2230);
        }
        .events-detail-pos-item.selected {
          background: var(--accent-blue-dim, rgba(59,130,246,0.15));
          outline: 1px solid var(--accent-blue);
        }
        .events-detail-pos-idx {
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          background: var(--bg-deep, #0d0f12);
          font-size: 10px;
          font-weight: 600;
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .events-detail-pos-coords {
          flex: 1;
          font-family: var(--font-mono, monospace);
          font-size: 11px;
          color: var(--text);
        }
        .events-detail-pos-delete {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
          border-radius: 3px;
          opacity: 0;
          transition: opacity 0.12s;
        }
        .events-detail-pos-item:hover .events-detail-pos-delete {
          opacity: 1;
        }
        .events-detail-pos-delete:hover {
          color: var(--accent-red, #ef4444);
        }

        /* Position Edit Form */
        .events-detail-pos-edit {
          padding: 10px 14px;
          border-top: 1px solid var(--border);
          background: var(--bg-deep, #0d0f12);
        }
        .events-detail-pos-edit-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        .events-detail-pos-edit-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .events-detail-pos-edit-field {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .events-detail-pos-edit-field label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .events-detail-pos-edit-field .input {
          font-size: 12px;
          padding: 4px 8px;
          background: var(--bg-card, #161a22);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--text);
          font-family: var(--font-mono, monospace);
        }

        /* No spawns state */
        .events-detail-no-spawns {
          padding: 20px 14px;
          text-align: center;
          color: var(--text-muted);
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}

// ─── Event Detail Panel (Map Sidebar Right) ─────────────────

function EventDetailPanel({
  eventName,
  eventData,
  spawnData,
  selectedPositionIdx,
  onSelectPosition,
  onRemovePosition,
  onUpdatePositionField,
  onAddPosition,
}) {
  const category = getEventCategory(eventName);
  const positions = spawnData?.positions || [];
  const selectedPos = selectedPositionIdx !== null ? positions[selectedPositionIdx] : null;

  return (
    <div className="events-detail-panel">
      {/* Header */}
      <div className="events-detail-header">
        <h3>{eventName}</h3>
        <div className="events-detail-category">
          <span className="events-map-category-dot" style={{ background: CATEGORY_COLORS[category] }} />
          {CATEGORY_LABELS[category]}
        </div>
      </div>

      {/* Event Settings (from events.xml) */}
      {eventData && (
        <div className="events-detail-settings">
          <div className="events-detail-settings-title">Event Settings</div>
          <div className="events-detail-settings-grid">
            <div className="events-detail-stat">
              <span className="events-detail-stat-label">Nominal</span>
              <span className="events-detail-stat-value">{eventData.nominal}</span>
            </div>
            <div className="events-detail-stat">
              <span className="events-detail-stat-label">Min</span>
              <span className="events-detail-stat-value">{eventData.min}</span>
            </div>
            <div className="events-detail-stat">
              <span className="events-detail-stat-label">Max</span>
              <span className="events-detail-stat-value">{eventData.max}</span>
            </div>
            <div className="events-detail-stat">
              <span className="events-detail-stat-label">Lifetime</span>
              <span className="events-detail-stat-value">{eventData.lifetime}</span>
            </div>
            <div className="events-detail-stat">
              <span className="events-detail-stat-label">Restock</span>
              <span className="events-detail-stat-value">{eventData.restock}</span>
            </div>
            <div className="events-detail-stat">
              <span className="events-detail-stat-label">Position</span>
              <span className="events-detail-stat-value">{eventData.position}</span>
            </div>
            <div className="events-detail-stat">
              <span className="events-detail-stat-label">Children</span>
              <span className="events-detail-stat-value">{(eventData.children || []).length}</span>
            </div>
            <div className="events-detail-stat">
              <span className="events-detail-stat-label">Safe R</span>
              <span className="events-detail-stat-value">{eventData.saferadius}</span>
            </div>
          </div>
        </div>
      )}

      {/* Spawn Positions */}
      <div className="events-detail-positions">
        <div className="events-detail-positions-header">
          <span>Positions ({positions.length})</span>
          <button className="btn btn-sm btn-secondary" onClick={onAddPosition} style={{ padding: '3px 8px', fontSize: 11 }}>
            <Plus size={12} /> Add
          </button>
        </div>

        {positions.length === 0 ? (
          <div className="events-detail-no-spawns">
            {(category === 'animal' || category === 'infected' || category === 'trajectory') ? (
              <>
                <span style={{ color: 'var(--accent-orange, #f59e0b)', fontWeight: 600, fontSize: 12 }}>Dynamic Spawning</span>
                <br />
                <span style={{ fontSize: 11 }}>This event spawns dynamically near players based on terrain. Fixed map positions are not used.</span>
                <br />
                <span style={{ fontSize: 10, opacity: 0.6 }}>You can still add fixed positions if needed:</span>
              </>
            ) : (
              'No spawn positions defined.'
            )}
            <br />
            <button className="btn btn-sm btn-secondary" onClick={onAddPosition} style={{ marginTop: 8 }}>
              <Plus size={12} /> Add Position
            </button>
          </div>
        ) : (
          <div className="events-detail-pos-list">
            {positions.map((pos, idx) => (
              <div
                key={idx}
                className={`events-detail-pos-item ${selectedPositionIdx === idx ? 'selected' : ''}`}
                onClick={() => onSelectPosition(idx)}
              >
                <span className="events-detail-pos-idx">{idx + 1}</span>
                <span className="events-detail-pos-coords">
                  {pos.x}, {pos.z}
                  {pos.a ? ` @ ${pos.a}\u00B0` : ''}
                  {pos.r ? ` r=${pos.r}` : ''}
                </span>
                <button
                  className="events-detail-pos-delete"
                  onClick={e => { e.stopPropagation(); onRemovePosition(idx); }}
                  title="Delete position"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Position Editor */}
        {selectedPos && (
          <div className="events-detail-pos-edit">
            <div className="events-detail-pos-edit-title">Position #{selectedPositionIdx + 1}</div>
            <div className="events-detail-pos-edit-grid">
              <div className="events-detail-pos-edit-field">
                <label>X</label>
                <input
                  type="number"
                  className="input"
                  value={selectedPos.x}
                  onChange={e => onUpdatePositionField(selectedPositionIdx, 'x', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="events-detail-pos-edit-field">
                <label>Z</label>
                <input
                  type="number"
                  className="input"
                  value={selectedPos.z}
                  onChange={e => onUpdatePositionField(selectedPositionIdx, 'z', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="events-detail-pos-edit-field">
                <label>Angle</label>
                <input
                  type="number"
                  className="input"
                  value={selectedPos.a || 0}
                  onChange={e => onUpdatePositionField(selectedPositionIdx, 'a', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="events-detail-pos-edit-field">
                <label>Radius</label>
                <input
                  type="number"
                  className="input"
                  value={selectedPos.r || 0}
                  onChange={e => onUpdatePositionField(selectedPositionIdx, 'r', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Children Sub-Table ─────────────────────────────────────

function ChildrenEditor({ children, onChange }) {
  const addChild = () => onChange([...children, { ...DEFAULT_CHILD }]);
  const removeChild = (idx) => onChange(children.filter((_, i) => i !== idx));
  const updateChild = (idx, field, value) => {
    const updated = children.map((c, i) => i === idx ? { ...c, [field]: value } : c);
    onChange(updated);
  };

  return (
    <div>
      <table className="types-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Type</th>
            <th>Loot Min</th>
            <th>Loot Max</th>
            <th>Min</th>
            <th>Max</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {children.map((child, idx) => (
            <tr key={idx}>
              <td>
                <input className="input" value={child.type} onChange={e => updateChild(idx, 'type', e.target.value)} placeholder="Type classname" />
              </td>
              <td>
                <input type="number" className="input" value={child.lootmin} onChange={e => updateChild(idx, 'lootmin', parseInt(e.target.value) || 0)} />
              </td>
              <td>
                <input type="number" className="input" value={child.lootmax} onChange={e => updateChild(idx, 'lootmax', parseInt(e.target.value) || 0)} />
              </td>
              <td>
                <input type="number" className="input" value={child.min} onChange={e => updateChild(idx, 'min', parseInt(e.target.value) || 0)} />
              </td>
              <td>
                <input type="number" className="input" value={child.max} onChange={e => updateChild(idx, 'max', parseInt(e.target.value) || 0)} />
              </td>
              <td>
                <button className="btn-icon btn-icon-sm" title="Remove" onClick={() => removeChild(idx)}>
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
          {children.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 12 }}>No children defined</td></tr>
          )}
        </tbody>
      </table>
      <button className="btn btn-sm btn-secondary" onClick={addChild}>
        <Plus size={14} /> Add Child
      </button>
    </div>
  );
}

// ─── Edit Event Modal ───────────────────────────────────────

function EditEventModal({ event, onSave, onClose }) {
  const [form, setForm] = useState({ ...event });
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setFlag = (flag, val) => setForm(f => ({ ...f, flags: { ...f.flags, [flag]: val } }));

  return (
    <Modal open onClose={onClose} title={`Edit: ${event.name}`} className="modal-lg types-edit-modal">
      <div className="types-edit-grid">
        {/* Numeric Fields */}
        <div className="types-edit-section">
          <h4>Spawn Values</h4>
          <div className="types-edit-fields">
            {NUMERIC_FIELDS.map(field => (
              <div key={field} className="types-edit-field">
                <label>{NUMERIC_LABELS[field]}</label>
                <input type="number" className="input" value={form[field]} onChange={e => set(field, parseInt(e.target.value) || 0)} />
              </div>
            ))}
          </div>
        </div>

        {/* Flags */}
        <div className="types-edit-section">
          <h4>Flags</h4>
          <div className="types-edit-flags">
            {FLAG_FIELDS.map(flag => (
              <label key={flag} className="types-flag-label">
                <input type="checkbox" checked={form.flags[flag] === 1} onChange={e => setFlag(flag, e.target.checked ? 1 : 0)} />
                {flag.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>

        {/* Position */}
        <div className="types-edit-section">
          <h4>Position</h4>
          <input className="input" value={form.position || ''} onChange={e => set('position', e.target.value)} placeholder="e.g. fixed, player" />
        </div>

        {/* Secondary */}
        <div className="types-edit-section">
          <h4>Secondary</h4>
          <input className="input" value={form.secondary || ''} onChange={e => set('secondary', e.target.value || null)} placeholder="Optional secondary type" />
        </div>

        {/* Children */}
        <div className="types-edit-section">
          <h4>Children</h4>
          <ChildrenEditor children={form.children || []} onChange={c => set('children', c)} />
        </div>
      </div>

      <div className="btn-group" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={() => onSave(form)}>Save Changes</button>
      </div>
    </Modal>
  );
}

// ─── Add Event Modal ────────────────────────────────────────

function AddEventModal({ onAdd, onClose }) {
  const [form, setForm] = useState({ ...DEFAULT_EVENT, flags: { ...DEFAULT_EVENT.flags }, children: [] });
  const [adding, setAdding] = useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setFlag = (flag, val) => setForm(f => ({ ...f, flags: { ...f.flags, [flag]: val } }));

  const handleSubmit = async () => {
    if (!form.name.trim()) { window.addToast?.('Event name is required', 'error'); return; }
    setAdding(true);
    await onAdd({ ...form, name: form.name.trim() });
    setAdding(false);
  };

  return (
    <Modal open onClose={onClose} title="Add New Event" className="modal-lg types-edit-modal">
      <div className="types-edit-grid">
        <div className="types-edit-section">
          <h4>Event Name</h4>
          <input className="input" placeholder="e.g. StaticHeliCrash" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
        </div>

        <div className="types-edit-section">
          <h4>Spawn Values</h4>
          <div className="types-edit-fields">
            {NUMERIC_FIELDS.map(field => (
              <div key={field} className="types-edit-field">
                <label>{NUMERIC_LABELS[field]}</label>
                <input type="number" className="input" value={form[field]} onChange={e => set(field, parseInt(e.target.value) || 0)} />
              </div>
            ))}
          </div>
        </div>

        <div className="types-edit-section">
          <h4>Flags</h4>
          <div className="types-edit-flags">
            {FLAG_FIELDS.map(flag => (
              <label key={flag} className="types-flag-label">
                <input type="checkbox" checked={form.flags[flag] === 1} onChange={e => setFlag(flag, e.target.checked ? 1 : 0)} />
                {flag.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>

        <div className="types-edit-section">
          <h4>Position</h4>
          <input className="input" value={form.position || ''} onChange={e => set('position', e.target.value)} placeholder="e.g. fixed, player" />
        </div>

        <div className="types-edit-section">
          <h4>Secondary</h4>
          <input className="input" value={form.secondary || ''} onChange={e => set('secondary', e.target.value || null)} placeholder="Optional secondary type" />
        </div>

        <div className="types-edit-section">
          <h4>Children</h4>
          <ChildrenEditor children={form.children || []} onChange={c => set('children', c)} />
        </div>
      </div>

      <div className="btn-group" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={handleSubmit} disabled={adding}>
          {adding ? 'Adding...' : 'Add Event'}
        </button>
      </div>
    </Modal>
  );
}
