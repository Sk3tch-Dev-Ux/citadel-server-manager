/**
 * Notifications history — the full story behind the bell in the header.
 *
 * Filters by severity, server, type, and free text. High-severity arrivals
 * (warning, error) also pop a toast from NotificationCenter; this page is
 * the place to review everything including the quieter info events.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api';
import { useSocket } from '../contexts/SocketContext';
import { useServers } from '../contexts/ServersContext';
import EmptyState from '../components/ui/EmptyState';
import PageLoader from '../components/PageLoader';
import { useDebouncedValue, timeAgo } from '../utils';
import {
  Bell, Search, X, RefreshCw, AlertTriangle, CheckCircle, Info, Trash2, Activity,
} from '../components/Icon';

const PAGE_SIZE = 50;

const SEVERITY_META = {
  info: { color: '#3b82f6', icon: Info, label: 'Info' },
  success: { color: '#22c55e', icon: CheckCircle, label: 'Success' },
  warning: { color: '#f59e0b', icon: AlertTriangle, label: 'Warning' },
  error: { color: '#ef4444', icon: AlertTriangle, label: 'Error' },
};

export default function NotificationsPage() {
  const socket = useSocket();
  const servers = useServers?.()?.servers || [];

  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [facets, setFacets] = useState({ severities: [], types: [], servers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [severity, setSeverity] = useState('');
  const [server, setServer] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const debouncedQ = useDebouncedValue(q, 200);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (severity) p.set('severity', severity);
    if (server) p.set('server', server);
    if (type) p.set('type', type);
    if (debouncedQ) p.set('q', debouncedQ);
    return p;
  }, [severity, server, type, debouncedQ, page]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [listRes, facetsRes] = await Promise.all([
        API.get(`/api/notifications?${params.toString()}`),
        API.get('/api/notifications/facets'),
      ]);
      if (Array.isArray(listRes)) {
        // Backward-compat: if the backend returned a raw array (no filters), use it directly
        setEntries(listRes);
        setTotal(listRes.length);
        setUnfilteredTotal(listRes.length);
      } else {
        setEntries(Array.isArray(listRes?.entries) ? listRes.entries : []);
        setTotal(listRes?.total || 0);
        setUnfilteredTotal(listRes?.unfilteredTotal || 0);
      }
      setFacets({
        severities: facetsRes?.severities || [],
        types: facetsRes?.types || [],
        servers: facetsRes?.servers || [],
      });
    } catch (err) {
      setError(err.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  // Reset pagination when filters change
  useEffect(() => { setPage(0); }, [severity, server, type, debouncedQ]);

  // Live updates — merge incoming socket events at the top
  useEffect(() => {
    if (!socket) return;
    const handler = (n) => {
      // Only prepend if it passes current filters; otherwise the refresh
      // button has to be hit manually. Kept simple to avoid filter-aware logic.
      if (severity && n.severity !== severity) return;
      if (server && n.serverId !== server) return;
      if (type && n.type !== type) return;
      if (debouncedQ && !(`${n.title} ${n.message}`.toLowerCase().includes(debouncedQ.toLowerCase()))) return;
      setEntries((prev) => [n, ...prev].slice(0, PAGE_SIZE));
      setTotal((t) => t + 1);
      setUnfilteredTotal((t) => t + 1);
    };
    socket.on('notification', handler);
    return () => socket.off('notification', handler);
  }, [socket, severity, server, type, debouncedQ]);

  const hasFilters = !!(severity || server || type || debouncedQ);

  const handleClear = () => { setSeverity(''); setServer(''); setType(''); setQ(''); };

  const handleMarkAllRead = async () => {
    try {
      await API.patch('/api/notifications/read', {});
      setEntries((prev) => prev.map((n) => ({ ...n, read: true })));
      window.addToast?.('All notifications marked read', 'success');
    } catch (err) {
      window.addToast?.(`Failed: ${err.message}`, 'error');
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm(`Clear all ${unfilteredTotal} notifications? This can't be undone.`)) return;
    try {
      await API.del('/api/notifications');
      setEntries([]); setTotal(0); setUnfilteredTotal(0);
      window.addToast?.('Notifications cleared', 'success');
    } catch (err) {
      window.addToast?.(`Failed: ${err.message}`, 'error');
    }
  };

  const handleDeleteOne = async (id) => {
    try {
      await API.del(`/api/notifications/${id}`);
      setEntries((prev) => prev.filter((n) => n.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setUnfilteredTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      window.addToast?.(`Failed: ${err.message}`, 'error');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (loading && entries.length === 0 && !hasFilters) return <PageLoader />;

  const serverNameLookup = Object.fromEntries((servers || []).map((s) => [s.id, s.name]));

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <Bell size={22} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Notifications</h1>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {hasFilters ? `${total} of ${unfilteredTotal}` : unfilteredTotal} total
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-secondary" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="btn btn-sm btn-secondary" onClick={handleMarkAllRead} disabled={entries.length === 0}>
          Mark all read
        </button>
        <button className="btn btn-sm btn-ghost" onClick={handleClearAll} disabled={unfilteredTotal === 0} style={{ color: 'var(--danger)' }}>
          <Trash2 size={13} /> Clear all
        </button>
      </div>

      <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: 13 }}>
        Full history of server events and alerts. High-severity notifications also pop a toast on arrival.
      </p>

      {/* Filter row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(140px, 180px) minmax(140px, 180px) minmax(160px, 220px) auto', gap: 8, marginBottom: 14 }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Search title or message…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: 30, width: '100%' }}
          />
        </div>
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          {facets.severities.map((s) => <option key={s.name} value={s.name}>{SEVERITY_META[s.name]?.label || s.name} ({s.count})</option>)}
        </select>
        <select className="input" value={server} onChange={(e) => setServer(e.target.value)}>
          <option value="">All servers</option>
          {facets.servers.map((s) => <option key={s.name} value={s.name}>{serverNameLookup[s.name] || s.name} ({s.count})</option>)}
        </select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All event types</option>
          {facets.types.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.count})</option>)}
        </select>
        {hasFilters && (
          <button className="btn btn-sm btn-ghost" onClick={handleClear} title="Clear filters">
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 8, color: 'var(--danger)', fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {!loading && entries.length === 0 ? (
        <EmptyState
          icon={<Bell size={36} />}
          title={hasFilters ? 'No matching notifications' : 'No notifications yet'}
          description={hasFilters ? 'Try widening the filter.' : 'Server events and alerts will appear here as they happen.'}
          action={hasFilters ? (
            <button className="btn btn-sm btn-secondary" onClick={handleClear}>
              <X size={14} /> Clear filters
            </button>
          ) : null}
        />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entries.map((n) => <NotificationRow key={n.id} n={n} serverName={serverNameLookup[n.serverId]} onDelete={() => handleDeleteOne(n.id)} />)}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 16 }}>
              <button className="btn btn-xs btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Page {page + 1} of {totalPages}</span>
              <button className="btn btn-xs btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NotificationRow({ n, serverName, onDelete }) {
  const meta = SEVERITY_META[n.severity] || { color: 'var(--text-muted)', icon: Activity, label: n.severity || 'event' };
  const Icon = meta.icon;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '10px 14px',
        background: 'var(--bg-surface, var(--bg-card))',
        border: `1px solid ${n.read ? 'var(--border)' : 'color-mix(in srgb, ' + meta.color + ' 40%, var(--border))'}`,
        borderRadius: 6,
        opacity: n.read ? 0.75 : 1,
      }}
    >
      <div style={{ color: meta.color, flexShrink: 0, marginTop: 2 }}>
        <Icon size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13 }}>{n.title}</strong>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '1px 6px', letterSpacing: 0.3,
            background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
            color: meta.color, borderRadius: 3, textTransform: 'uppercase',
          }}>
            {meta.label}
          </span>
          {n.type && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>
              {n.type}
            </span>
          )}
          {serverName && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {serverName}</span>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }} title={n.timestamp}>
            {timeAgo(n.timestamp)}
          </span>
          <button className="btn btn-xs btn-ghost" onClick={onDelete} title="Remove" style={{ color: 'var(--text-muted)' }}>
            <X size={11} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{n.message}</div>
      </div>
    </div>
  );
}
