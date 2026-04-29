/**
 * Global Ban Database — paid Citadel Cloud feature.
 *
 * Wrapped in <LicenseGate> so non-subscribers see the upgrade card. Paying
 * customers and trial users see the actual page: total community bans
 * currently protecting their server, sync status, and a manual sync trigger.
 *
 * Data sources:
 *   GET  /api/cloud-bans/status — cache stats + enforcer state
 *   GET  /api/cloud-bans/list   — paginated list of cached community bans
 *   POST /api/cloud-bans/sync   — manual sync trigger
 */
import { useState, useEffect, useCallback } from 'react';
import API from '../api';
import LicenseGate from '../components/LicenseGate';
import { ShieldBan, RefreshCw, Loader, Activity, AlertTriangle, Sparkles } from '../components/Icon';

const PAGE_SIZE = 100;

export default function GlobalBansPage() {
  return (
    <LicenseGate
      feature="cloud"
      featureName="Global Ban Database"
      description="Citadel Cloud subscribers contribute their bans to a shared cheater pool. The Cloud add-on is $10/month on top of your Citadel subscription, includes a 7-day free trial, and protects your server against every cheater the network has banned."
    >
      <GlobalBansContent />
    </LicenseGate>
  );
}

function GlobalBansContent() {
  const [status, setStatus] = useState(null);
  const [bans, setBans] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const res = await API.get('/api/cloud-bans/status');
      setStatus(res);
    } catch (err) {
      window.addToast?.(`Failed to load Cloud Bans status: ${err.message}`, 'error');
    }
  }, []);

  const loadList = useCallback(async (off = 0) => {
    try {
      const res = await API.get(`/api/cloud-bans/list?limit=${PAGE_SIZE}&offset=${off}`);
      if (res?.items) {
        setBans(off === 0 ? res.items : (prev) => [...prev, ...res.items]);
        setTotal(res.total || 0);
        setOffset(off + (res.items?.length || 0));
      }
    } catch (err) {
      window.addToast?.(`Failed to load community bans: ${err.message}`, 'error');
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadStatus(), loadList(0)]);
      setLoading(false);
    })();
  }, [loadStatus, loadList]);

  async function handleManualSync() {
    setSyncing(true);
    try {
      const res = await API.post('/api/cloud-bans/sync', {});
      if (res?.ok) {
        window.addToast?.(
          `Sync complete: +${res.totalAdded || 0} bans, -${res.totalRemoved || 0} removed.`,
          'success',
        );
        await Promise.all([loadStatus(), loadList(0)]);
      } else {
        window.addToast?.(`Sync failed: ${res?.reason || 'unknown'}`, 'error');
      }
    } catch (err) {
      window.addToast?.(`Sync failed: ${err.message}`, 'error');
    } finally {
      setSyncing(false);
    }
  }

  const filtered = bans.filter((b) => {
    if (filter !== 'all' && b.reasonCategory !== filter) return false;
    if (search && !b.steamId.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <Loader size={24} className="spin" />
      </div>
    );
  }

  const cacheStats = status?.cache || {};
  const enforcer = status?.enforcer || {};

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px 48px' }}>
      {/* ── Header ───────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <ShieldBan size={28} style={{ color: 'var(--accent)' }} />
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Global Ban Database</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
            Community-contributed cheater bans currently active on your server.
          </p>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard
          icon={<ShieldBan size={18} />}
          label="Active community bans"
          value={(cacheStats.total || 0).toLocaleString()}
          accent="var(--accent)"
        />
        <StatCard
          icon={<Sparkles size={18} />}
          label="Cheaters"
          value={(cacheStats.byCategory?.cheating || 0).toLocaleString()}
          accent="var(--danger)"
        />
        <StatCard
          icon={<AlertTriangle size={18} />}
          label="Griefers"
          value={(cacheStats.byCategory?.griefing || 0).toLocaleString()}
          accent="var(--warning)"
        />
        <StatCard
          icon={<Activity size={18} />}
          label="Last sync"
          value={cacheStats.lastSyncAt ? formatRelative(cacheStats.lastSyncAt) : 'never'}
          accent="var(--text-muted)"
          mono
        />
      </div>

      {/* ── Sync actions ──────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Citadel syncs the community ban list every hour. You can also trigger a manual sync now —
          useful right after subscribing or after a cluster of bans elsewhere in the network.
          {enforcer.lastError && (
            <div style={{ marginTop: 6, color: 'var(--danger)', fontSize: 12 }}>
              <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Last sync error: {enforcer.lastError}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleManualSync}
          disabled={syncing}
          className="btn btn-primary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} className={syncing ? 'spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {/* ── Per-server enforcement counts ────────────────── */}
      {enforcer.ownedBySever && Object.keys(enforcer.ownedBySever).length > 0 && (
        <div style={{
          background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
          borderRadius: 10,
          padding: 14,
          marginBottom: 20,
          fontSize: 13,
          color: 'var(--text-secondary)',
        }}>
          <strong style={{ color: 'var(--text-primary)' }}>Active enforcement:</strong>
          {' '}
          {Object.entries(enforcer.ownedBySever).map(([serverId, count], idx, arr) => (
            <span key={serverId}>
              <strong>{count.toLocaleString()}</strong> bans on <code style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{serverId}</code>
              {idx < arr.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          className="input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 200 }}
        >
          <option value="all">All categories ({total.toLocaleString()})</option>
          <option value="cheating">Cheating</option>
          <option value="griefing">Griefing</option>
          <option value="exploiting">Exploiting</option>
          <option value="other">Other</option>
        </select>
        <input
          type="search"
          className="input"
          placeholder="Search by SteamID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
      </div>

      {/* ── Table ────────────────────────────────────────── */}
      {bans.length === 0 ? (
        <div style={{
          padding: 40,
          textAlign: 'center',
          color: 'var(--text-muted)',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}>
          <ShieldBan size={36} style={{ marginBottom: 12, opacity: 0.5 }} />
          <div style={{ fontSize: 14 }}>No community bans on your server yet.</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            They&apos;ll appear here automatically as the network grows. Click &ldquo;Sync now&rdquo; above to refresh.
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SteamID</th>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Vouches</th>
                <th>Activated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.steamId}>
                  <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{b.steamId}</td>
                  <td>
                    <CategoryBadge category={b.reasonCategory} />
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 13 }}>{b.vouchCount}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {b.activatedAt ? formatRelative(b.activatedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {offset < total && (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => loadList(offset)}
                disabled={loading}
              >
                Load more ({total - offset} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, accent, mono }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: accent, marginBottom: 6 }}>
        {icon}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: mono ? 16 : 22,
        fontWeight: 600,
        fontFamily: mono ? 'var(--font-mono, monospace)' : 'inherit',
      }}>
        {value}
      </div>
    </div>
  );
}

function CategoryBadge({ category }) {
  const colors = {
    cheating:   { bg: 'color-mix(in srgb, var(--danger) 15%, transparent)',  fg: 'var(--danger)'  },
    griefing:   { bg: 'color-mix(in srgb, var(--warning) 15%, transparent)', fg: 'var(--warning)' },
    exploiting: { bg: 'color-mix(in srgb, var(--accent) 15%, transparent)',  fg: 'var(--accent)'  },
    other:      { bg: 'var(--bg-surface)',                                    fg: 'var(--text-muted)' },
  }[category] || { bg: 'var(--bg-surface)', fg: 'var(--text-muted)' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      background: colors.bg,
      color: colors.fg,
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 500,
      textTransform: 'capitalize',
    }}>
      {category}
    </span>
  );
}

function formatRelative(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const ms = Date.now() - t;
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
