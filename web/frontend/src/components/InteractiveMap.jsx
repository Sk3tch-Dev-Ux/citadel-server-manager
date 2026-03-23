/**
 * InteractiveMap — Reusable DayZ map component using react-leaflet.
 *
 * Renders a coordinate-based map with markers, circles, and polygons.
 * Uses Leaflet CRS.Simple so that DayZ world coordinates (meters) are
 * used directly: lat = Z (north), lng = X (east).
 *
 * Supports three interaction modes:
 *   - "view"      — pan / zoom / select only
 *   - "addMarker" — click to place a new marker
 *   - "addCircle" — click to place a new circle center
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  Polygon,
  Popup,
  Tooltip,
  useMapEvents,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './InteractiveMap.css';

// ---------------------------------------------------------------------------
// Map configurations
// ---------------------------------------------------------------------------

const MAP_CONFIGS = {
  chernarusplus: {
    name: 'Chernarus+',
    size: 15360,
    tileUrl: 'https://static.xam.nu/dayz/maps/chernarusplus/1.27/satellite/{z}/{x}/{y}.webp',
    maxZoom: 7,
    minZoom: 0,
  },
  enoch: {
    name: 'Livonia',
    size: 12800,
    tileUrl: 'https://static.xam.nu/dayz/maps/enoch/1.27/satellite/{z}/{x}/{y}.webp',
    maxZoom: 7,
    minZoom: 0,
  },
};

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/**
 * Build a CRS.Simple variant whose transformation maps DayZ metres into
 * the Leaflet pixel space used by the xam.nu tile set.
 *
 * xam.nu tiles cover [0 … 256] pixels at zoom 0.  One tile = 256 px,
 * so at zoom 0 the full map image is 256 × 256 px.
 * DayZ world coords run from 0 … mapSize (in metres).
 *
 * Transformation(a, b, c, d) maps:
 *   px_x = a * lng + b        →  a = 256/mapSize,  b = 0
 *   px_y = c * lat + d        →  c = -256/mapSize,  d = 256
 * (y is flipped because Leaflet pixel-y grows downward but lat grows upward)
 */
function buildCRS(mapSize) {
  const factor = 256 / mapSize;
  return L.Util.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(factor, 0, -factor, 256),
    // scale / zoom are inherited from CRS.Simple
  });
}

/** Convert DayZ (x, z) → Leaflet LatLng.  lat = Z (north), lng = X (east). */
function toLatLng(x, z) {
  return L.latLng(z, x);
}

/** Convert Leaflet LatLng → DayZ {x, z}. */
function fromLatLng(latlng) {
  return { x: latlng.lng, z: latlng.lat };
}

// ---------------------------------------------------------------------------
// Custom DivIcon factory
// ---------------------------------------------------------------------------

function createMarkerIcon(color = '#6cb4f0', size = 14, selected = false, label = '') {
  const border = selected ? 'var(--accent-yellow, #e5c07b)' : 'rgba(255,255,255,0.9)';
  const cls = `dayz-marker${selected ? ' selected' : ''}`;

  const html = `
    <div class="${cls}" style="
      width:${size}px;height:${size}px;
      background:${color};
      border-color:${border};
    "></div>
    ${label ? `<span class="dayz-marker-label">${label}</span>` : ''}
  `;

  return L.divIcon({
    className: '', // avoid leaflet default styling
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

/** Tracks mouse position and fires click/context-menu events. */
function MapEvents({ mode, mapSize, onMouseMove, onMapClick, onContextMenu }) {
  useMapEvents({
    mousemove(e) {
      const { x, z } = fromLatLng(e.latlng);
      onMouseMove(x, z);
    },
    click(e) {
      if (mode === 'addMarker' || mode === 'addCircle') {
        const { x, z } = fromLatLng(e.latlng);
        // Clamp to valid bounds
        const cx = Math.max(0, Math.min(mapSize, x));
        const cz = Math.max(0, Math.min(mapSize, z));
        onMapClick(cx, cz);
      }
    },
    contextmenu(e) {
      L.DomEvent.preventDefault(e.originalEvent);
      onContextMenu(null, e.originalEvent.clientX, e.originalEvent.clientY);
    },
  });
  return null;
}

/** Draws grid lines on the canvas overlay so users see the coordinate space. */
function GridOverlay({ mapSize, gridStep = 1000 }) {
  const map = useMap();

  useEffect(() => {
    const canvas = L.canvas({ pane: 'overlayPane' });

    const lines = [];

    // Vertical lines (constant X)
    for (let x = 0; x <= mapSize; x += gridStep) {
      const line = L.polyline(
        [toLatLng(x, 0), toLatLng(x, mapSize)],
        {
          color: 'rgba(255,255,255,0.06)',
          weight: 1,
          interactive: false,
          renderer: canvas,
        },
      );
      line.addTo(map);
      lines.push(line);
    }

    // Horizontal lines (constant Z)
    for (let z = 0; z <= mapSize; z += gridStep) {
      const line = L.polyline(
        [toLatLng(0, z), toLatLng(mapSize, z)],
        {
          color: 'rgba(255,255,255,0.06)',
          weight: 1,
          interactive: false,
          renderer: canvas,
        },
      );
      line.addTo(map);
      lines.push(line);
    }

    return () => {
      lines.forEach((l) => map.removeLayer(l));
    };
  }, [map, mapSize, gridStep]);

  return null;
}

/** Sets map view / bounds when the selected map changes. */
function MapController({ mapSize }) {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds(toLatLng(0, 0), toLatLng(mapSize, mapSize));
    map.setMaxBounds(bounds.pad(0.1));
    map.fitBounds(bounds);
  }, [map, mapSize]);

  return null;
}

// ---------------------------------------------------------------------------
// Marker wrapper
// ---------------------------------------------------------------------------

function DayzMarker({ data, selected, onSelect, onMove, onContextMenu }) {
  const { id, x, z, color, label, draggable } = data;
  const icon = useMemo(
    () => createMarkerIcon(color || '#6cb4f0', 14, selected, label || ''),
    [color, selected, label],
  );

  const eventHandlers = useMemo(
    () => ({
      click(e) {
        L.DomEvent.stopPropagation(e);
        onSelect?.(id);
      },
      dragend(e) {
        const pos = e.target.getLatLng();
        const coords = fromLatLng(pos);
        onMove?.(id, coords.x, coords.z);
      },
      contextmenu(e) {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        onContextMenu?.(id, e.originalEvent.clientX, e.originalEvent.clientY);
      },
    }),
    [id, onSelect, onMove, onContextMenu],
  );

  return (
    <Marker
      position={toLatLng(x, z)}
      icon={icon}
      draggable={draggable !== false}
      eventHandlers={eventHandlers}
    />
  );
}

// ---------------------------------------------------------------------------
// Circle wrapper
// ---------------------------------------------------------------------------

function DayzCircle({ data, selected, onSelect, onMove, onContextMenu }) {
  const { id, x, z, radius, color, label, draggable } = data;
  const circleRef = useRef(null);

  const pathOptions = useMemo(
    () => ({
      color: color || '#6cb4f0',
      fillColor: color || '#6cb4f0',
      fillOpacity: selected ? 0.2 : 0.1,
      weight: selected ? 2.5 : 1.5,
      dashArray: selected ? '' : '6 4',
    }),
    [color, selected],
  );

  const eventHandlers = useMemo(
    () => ({
      click(e) {
        L.DomEvent.stopPropagation(e);
        onSelect?.(id);
      },
      contextmenu(e) {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        onContextMenu?.(id, e.originalEvent.clientX, e.originalEvent.clientY);
      },
    }),
    [id, onSelect, onContextMenu],
  );

  // react-leaflet Circle doesn't natively support drag, so we pair it with
  // an invisible draggable marker at the center.
  return (
    <>
      <Circle
        ref={circleRef}
        center={toLatLng(x, z)}
        radius={radius}
        pathOptions={pathOptions}
        eventHandlers={eventHandlers}
      >
        {label && (
          <Tooltip permanent direction="center" className="dayz-circle-label">
            {label}
          </Tooltip>
        )}
      </Circle>

      {/* Draggable center handle */}
      {draggable !== false && (
        <Marker
          position={toLatLng(x, z)}
          icon={L.divIcon({
            className: '',
            html: `<div style="
              width:8px;height:8px;border-radius:50%;
              background:${color || '#6cb4f0'};
              border:2px solid #fff;
              opacity:0.7;
            "></div>`,
            iconSize: [8, 8],
            iconAnchor: [4, 4],
          })}
          draggable
          eventHandlers={{
            dragend(e) {
              const pos = e.target.getLatLng();
              const coords = fromLatLng(pos);
              onMove?.(id, coords.x, coords.z);
            },
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Polygon wrapper
// ---------------------------------------------------------------------------

function DayzPolygon({ data, selected, onSelect }) {
  const { id, positions, color, label } = data;

  const latLngs = useMemo(
    () => positions.map(([x, z]) => toLatLng(x, z)),
    [positions],
  );

  const pathOptions = useMemo(
    () => ({
      color: color || '#c49bff',
      fillColor: color || '#c49bff',
      fillOpacity: selected ? 0.2 : 0.1,
      weight: selected ? 2.5 : 1.5,
    }),
    [color, selected],
  );

  return (
    <Polygon
      positions={latLngs}
      pathOptions={pathOptions}
      eventHandlers={{
        click(e) {
          L.DomEvent.stopPropagation(e);
          onSelect?.(id);
        },
      }}
    >
      {label && (
        <Tooltip permanent direction="center" className="dayz-circle-label">
          {label}
        </Tooltip>
      )}
    </Polygon>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function ContextMenu({ x, y, targetId, onDelete, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="map-context-menu"
      style={{ left: x, top: y }}
    >
      {targetId && onDelete && (
        <button className="danger" onClick={() => { onDelete(targetId); onClose(); }}>
          Delete
        </button>
      )}
      <button onClick={onClose}>Cancel</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InteractiveMap({
  mapName = 'chernarusplus',
  markers = [],
  circles = [],
  polygons = [],
  onMarkerMove,
  onMarkerAdd,
  onMarkerDelete,
  onCircleMove,
  onCircleResize,
  onSelect,
  selectedId = null,
  mode = 'view',
  height = 500,
  onMapChange,
  children,
}) {
  const config = MAP_CONFIGS[mapName] || MAP_CONFIGS.chernarusplus;
  const mapSize = config.size;

  // CRS must be stable across renders for the same mapSize
  const crs = useMemo(() => buildCRS(mapSize), [mapSize]);
  const bounds = useMemo(
    () => L.latLngBounds(toLatLng(0, 0), toLatLng(mapSize, mapSize)),
    [mapSize],
  );

  // Cursor position state
  const [cursorPos, setCursorPos] = useState(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState(null);

  // Tile error state — if tiles fail, we still have the grid
  const [tilesLoaded, setTilesLoaded] = useState(true);

  const handleMouseMove = useCallback((x, z) => {
    setCursorPos({ x: Math.round(x), z: Math.round(z) });
  }, []);

  const handleMapClick = useCallback(
    (x, z) => {
      setCtxMenu(null);
      if (mode === 'addMarker' && onMarkerAdd) {
        onMarkerAdd(Math.round(x), Math.round(z));
      }
      if (mode === 'addCircle' && onMarkerAdd) {
        onMarkerAdd(Math.round(x), Math.round(z));
      }
    },
    [mode, onMarkerAdd],
  );

  const handleContextMenu = useCallback(
    (targetId, clientX, clientY) => {
      setCtxMenu({ targetId, x: clientX, y: clientY });
    },
    [],
  );

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // Choose a sensible grid step based on map size
  const gridStep = mapSize > 13000 ? 2000 : 1000;

  // The MapContainer key forces a full remount when mapName changes,
  // because CRS cannot be changed after mount in Leaflet.
  const mapKey = `map-${mapName}`;

  return (
    <div
      className={`interactive-map${mode !== 'view' ? ` mode-${mode}` : ''}`}
      style={{ height, position: 'relative' }}
    >
      <MapContainer
        key={mapKey}
        crs={crs}
        bounds={bounds}
        maxBounds={bounds.pad(0.1)}
        maxBoundsViscosity={0.8}
        zoom={1}
        minZoom={config.minZoom}
        maxZoom={config.maxZoom}
        zoomSnap={0.5}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={120}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
      >
        {/* Tile layer from xam.nu */}
        <TileLayer
          url={config.tileUrl}
          tms={false}
          noWrap={true}
          bounds={bounds}
          maxNativeZoom={config.maxZoom}
          errorTileUrl=""
          eventHandlers={{
            tileerror: () => setTilesLoaded(false),
            tileload: () => setTilesLoaded(true),
          }}
        />

        {/* Coordinate grid */}
        <GridOverlay mapSize={mapSize} gridStep={gridStep} />

        {/* View / bounds controller */}
        <MapController mapSize={mapSize} />

        {/* Event handler layer */}
        <MapEvents
          mode={mode}
          mapSize={mapSize}
          onMouseMove={handleMouseMove}
          onMapClick={handleMapClick}
          onContextMenu={handleContextMenu}
        />

        {/* Polygons (render first, below markers) */}
        {polygons.map((p) => (
          <DayzPolygon
            key={p.id}
            data={p}
            selected={p.id === selectedId}
            onSelect={onSelect}
          />
        ))}

        {/* Circles */}
        {circles.map((c) => (
          <DayzCircle
            key={c.id}
            data={c}
            selected={c.id === selectedId}
            onSelect={onSelect}
            onMove={onCircleMove}
            onContextMenu={handleContextMenu}
          />
        ))}

        {/* Markers */}
        {markers.map((m) => (
          <DayzMarker
            key={m.id}
            data={m}
            selected={m.id === selectedId}
            onSelect={onSelect}
            onMove={onMarkerMove}
            onContextMenu={handleContextMenu}
          />
        ))}

        {/* Custom child overlays */}
        {children}
      </MapContainer>

      {/* Coordinate readout */}
      {cursorPos && (
        <div className="coord-display">
          X: {cursorPos.x} &nbsp; Z: {cursorPos.z}
        </div>
      )}

      {/* Mode indicator */}
      {mode === 'addMarker' && (
        <div className={`map-mode-indicator mode-addMarker`}>
          Click to place marker
        </div>
      )}
      {mode === 'addCircle' && (
        <div className={`map-mode-indicator mode-addCircle`}>
          Click to place circle center
        </div>
      )}

      {/* Map selector */}
      {onMapChange && (
        <div className="map-selector">
          <select
            value={mapName}
            onChange={(e) => onMapChange(e.target.value)}
          >
            {Object.entries(MAP_CONFIGS).map(([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          targetId={ctxMenu.targetId}
          onDelete={onMarkerDelete}
          onClose={closeCtxMenu}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports for consumers that need coordinate conversion or configs
// ---------------------------------------------------------------------------

export { MAP_CONFIGS, toLatLng, fromLatLng, buildCRS };
