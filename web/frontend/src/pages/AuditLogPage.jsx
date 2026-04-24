/**
 * Audit Log — full admin action history with filters and CSV export.
 *
 * Replaces the former "Audit Log" tab buried in UsersPage. Customers paying
 * for the compliance feature get a first-class page with date-range, user,
 * action, and full-text filters, plus CSV export for incident review.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api';
import EmptyState from '../components/ui/EmptyState';
import PageLoader from '../components/PageLoader';
import { useDebouncedValue, timeAgo } from '../utils';
import {
  FileText, Search, Download, RefreshCw, X, AlertTriangle,
} from '../components/Icon';

const PAGE_SIZE = 100;

function tsFull(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Severity inferred from action prefix — we color-code high-impact actions
// so the page reads at a glance: red for destructive, amber for moderation, etc.
const ACTION_COLORS = [
  { prefix: ['ban', 'kick', 'explode', 'kill', 'dangerzone', 'wipe', 'delete'], color: '#ef4444' },
  { prefix: ['player.', 'watchlist.', 'role.', 'user.', 'freeze', 'strip'], color: '#f59e0b' },
  { prefix: ['server.', 'restart', 'config.', 'mod.', 'backup.'], color: '#3b82f6' },
  { prefix: ['login', 'logout', 'auth.'], color: '#a78bfa' },
];
function actionColor(action) {
  if (!action) return '#94a3b8';
  const a = action.toLowerCase();
  for (const { prefix, color } of ACTION_COLORS) {
    if (prefix.some((p) => a.startsWith(p) || a.includes(`.${p}`))) return color;
  }
  return '#94a3b8';
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [actions, setActions] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [q, setQ] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);
  const debouncedQ = useDebouncedValue(q, 200);

  const params = useMemo(() => {
    const p = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (debouncedQ) p.set('q', debouncedQ);
    if (userFilter) p.set('user', userFilter);
    if (actionFilter) p.set('action', actionFilter);
    if (fromDate) p.set('from', new Date(fromDate).toISOString());
    if (toDate) p.set('to', new Date(toDate + 'T23:59:59').toISOString());
    return p;
  }, [debouncedQ, userFilter, actionFilter, fromDate, toDate, page]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [listRes, actionsRes, usersRes] = await Promise.all([
        API.get(`/api/audit?${params.toString()}`),
        actions.length === 0 ? API.get('/api/audit/actions') : Promise.resolve(null),
        users.length === 0 ? API.get('/api/audit/users') : Promise.resolve(null),
      ]);
      setEntries(Array.isArray(listRes?.entries) ? listRes.entries : []);
      setTotal(listRes?.total || 0);
      setUnfilteredTotal(listRes?.unfilteredTotal || 0);
      if (actionsRes) setActions(actionsRes.actions || []);
      if (usersRes) setUsers(usersRes.users || []);
    } catch (err) {
      setError(err.message || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => { load(); }, [load]);

  // Reset page when filters change (but not on pure page change)
  useEffect(() => { setPage(0); }, [debouncedQ, userFilter, actionFilter, fromDate, toDate]);

  const handleClearFilters = () => {
    setQ(''); setUserFilter(''); setActionFilter(''); setFromDate(''); setToDate('');
  };

  const hasFilters = !!(debouncedQ || userFilter || actionFilter || fromDate || toDate);

  const handleExport = () => {
    const exportParams = new URLSearchParams(params);
    exportParams.delete('limit');
    exportParams.delete('offset');
    API.raw(`/api/audit/export.csv?${exportParams.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = res.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'audit.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      })
      .catch((err) => window.addToast?.(`Export failed: ${err.message}`, 'error'));
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (loading && entries.length === 0 && !hasFilters) return <PageLoader />;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <FileText size={22} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Audit Log</h1>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {hasFilters
            ? `${total.toLocaleString()} of ${unfilteredTotal.toLocaleString()} entries`
            : `${unfilteredTotal.toLocaleString()} entries`}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="btn btn-sm btn-secondary" onClick={handleExport} disabled={entries.length === 0}>
          <Download size={13} /> Export CSV
        </button>
      </div>

      <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
        Complete history of admin actions — player commands, config edits, role changes, server control.
        Filter by any combination of user, action, date range, or free text. Export to CSV for incident review.
      </p>

      {/* Filter bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(200px, 1fr) minmax(160px, 200px) minmax(160px, 220px) minmax(140px, 160px) minmax(140px, 160px) auto',
        gap: 8, marginBottom: 14,
      }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Search details, user, action…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: 30, width: '100%' }}
          />
        </div>
        <select className="input" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
          <option value="">All users</option>
          {users.map((u) => <option key={u.username} value={u.username}>{u.username} ({u.count})</option>)}
        </select>
        <select className="input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.count})</option>)}
        </select>
        <input
          className="input"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          title="From date"
        />
        <input
          className="input"
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          title="To date"
        />
        {hasFilters && (
          <button className="btn btn-sm btn-ghost" onClick={handleClearFilters} title="Clear all filters">
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
          icon={<FileText size={36} />}
          title={hasFilters ? 'No entries match your filters' : 'Audit log is empty'}
          description={hasFilters ? 'Try widening the date range or clearing filters.' : 'Admin actions will be recorded here as they happen.'}
          action={hasFilters ? (
            <button className="btn btn-sm btn-secondary" onClick={handleClearFilters}>
              <X size={14} /> Clear filters
            </button>
          ) : null}
        />
      ) : (
        <>
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 360px)', overflow: 'auto' }}>
            <table>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-surface, var(--bg-card))' }}>
                <tr>
                  <th style={{ width: 170 }}>Time</th>
                  <th style={{ width: 140 }}>User</th>
                  <th style={{ width: 180 }}>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--text-muted)' }} title={e.timestamp}>
                      <div>{tsFull(e.timestamp).split(',')[0]}</div>
                      <div>{tsFull(e.timestamp).split(',').slice(1).join(',').trim()}</div>
                      <div style={{ fontSize: 10 }}>{timeAgo(e.timestamp)}</div>
                    </td>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>
                      {e.username || <em style={{ color: 'var(--text-muted)' }}>system</em>}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', letterSpacing: 0.3,
                        background: `color-mix(in srgb, ${actionColor(e.action)} 15%, transparent)`,
                        color: actionColor(e.action), borderRadius: 3, whiteSpace: 'nowrap',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}>
                        {e.action}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, wordBreak: 'break-word' }}>
                      {e.details || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 12 }}>
              <button className="btn btn-xs btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Page {page + 1} of {totalPages}
              </span>
              <button className="btn btn-xs btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
