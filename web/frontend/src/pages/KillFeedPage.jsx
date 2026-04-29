import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { useSocket } from '../contexts/SocketContext';
import useServerMap from '../hooks/useServerMap';
import API from '../api';
import EmptyState from '../components/ui/EmptyState';
import PageLoader from '../components/PageLoader';
import BarChart from '../components/BarChart';
import {
  Crosshair, Target, Skull, Trophy, Activity, Clock, RefreshCw,
  ChevronRight, AlertTriangle, MapPin, BarChart3,
} from '../components/Icon';
import { throttle } from '../utils';

const InteractiveMap = lazy(() => import('../components/InteractiveMap'));

const SORT_OPTIONS = [
  { value: 'kills', label: 'Kills' },
  { value: 'kd', label: 'K/D' },
  { value: 'headshots', label: 'Headshots' },
  { value: 'longestKill', label: 'Longest Kill' },
];

export default function KillFeedPage({ serverId }) {
  const socket = useSocket();
  const serverMap = useServerMap(serverId);
  const [tab, setTab] = useState('feed'); // feed | leaderboard | map
  const [kills, setKills] = useState([]);
  const [leaderboard, setLeaderboard] = useState(null);
  const [stats, setStats] = useState(null);
  const [sortBy, setSortBy] = useState('kills');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─── Initial load ─────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [k, lb, st] = await Promise.all([
        API.get(`/api/servers/${serverId}/pvp/kills?limit=200`),
        API.get(`/api/servers/${serverId}/pvp/leaderboard?limit=50&sortBy=${sortBy}`),
        API.get(`/api/servers/${serverId}/pvp/stats`),
      ]);
      setKills(k?.kills || []);
      setLeaderboard(lb);
      setStats(st);
    } catch (err) {
      setError(err.message || 'Failed to load PvP data');
    } finally {
      setLoading(false);
    }
  }, [serverId, sortBy]);

  useEffect(() => { load(); }, [load]);

  // ─── Live event stream ────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    socket.emit('citadel:subscribe', { serverId });

    // Throttle reload of leaderboard/stats; the kills feed updates live per-event
    const refreshAggregates = throttle(() => {
      API.get(`/api/servers/${serverId}/pvp/leaderboard?limit=50&sortBy=${sortBy}`).then(setLeaderboard).catch(() => {});
      API.get(`/api/servers/${serverId}/pvp/stats`).then(setStats).catch(() => {});
    }, 2000);

    const onEvents = (data) => {
      if (data.serverId !== serverId) return;
      const newKills = (data.events || [])
        .filter((e) => e?.type === 'kill')
        .map((e) => ({ ...e, headshot: (e.zone || '').toLowerCase() === 'head' }));
      if (newKills.length === 0) return;
      setKills((prev) => [...newKills.reverse(), ...prev].slice(0, 500));
      refreshAggregates();
    };

    socket.on('citadel:events', onEvents);
    return () => {
      socket.emit('citadel:unsubscribe');
      socket.off('citadel:events', onEvents);
      refreshAggregates.cancel();
    };
  }, [socket, serverId, sortBy]);

  const killMarkers = useMemo(() =>
    kills.filter((k) => k.killerPos || k.victimPos).map((k, i) => ({
      id: `kill-${i}-${k.timestamp}`,
      position: k.victimPos ? [k.victimPos.x || 0, k.victimPos.z || 0] : [k.killerPos.x || 0, k.killerPos.z || 0],
      color: k.headshot ? '#ef4444' : '#f59e0b',
      radius: k.headshot ? 8 : 5,
      tooltip: `${k.name} → ${k.victimName}${k.headshot ? ' [HS]' : ''} · ${Math.round(k.distance || 0)}m`,
    })),
    [kills]);

  // ─── Renders ──────────────────────────────────────────────
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Crosshair size={22} style={{ color: 'var(--accent)' }} />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Kill Feed</h1>
          {stats?.wipeId && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
              wipe: {stats.wipeId.slice(0, 8)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-sm btn-secondary" onClick={load} title="Reload">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary stats row */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
          <StatCard icon={<Skull size={16} />} label="Total kills" value={stats.totalKills} />
          <StatCard icon={<Target size={16} />} label="Headshot rate" value={`${Math.round((stats.headshotPct || 0) * 100)}%`} />
          <StatCard icon={<Trophy size={16} />} label="Longest kill" value={stats.longestKill ? `${Math.round(stats.longestKill.distance)}m` : '—'}
            sub={stats.longestKill ? `${stats.longestKill.killer} · ${stats.longestKill.weapon || '—'}` : null} />
          <StatCard icon={<Activity size={16} />} label="Players with kills" value={stats.playerCount} />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
        {[
          { id: 'feed', label: 'Live Feed', icon: Activity },
          { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 },
          { id: 'map', label: 'Kill Map', icon: MapPin },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(t.id)}
              style={{ borderRadius: '6px 6px 0 0' }}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: 12, background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 8, color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          <AlertTriangle size={14} style={{ marginRight: 6 }} /> {error}
        </div>
      )}

      {loading && <PageLoader />}

      {!loading && tab === 'feed' && <KillFeedTab kills={kills} />}
      {!loading && tab === 'leaderboard' && <LeaderboardTab data={leaderboard} sortBy={sortBy} onSortChange={setSortBy} />}
      {!loading && tab === 'analytics' && <AnalyticsTab kills={kills} stats={stats} leaderboard={leaderboard} />}
      {!loading && tab === 'map' && (
        <Suspense fallback={<PageLoader />}>
          <div style={{ height: 'calc(100vh - 340px)', minHeight: 400, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <InteractiveMap mapName={serverMap} markers={killMarkers} showGrid />
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            Red markers = headshots · Orange = body shots · Hover for details
          </p>
        </Suspense>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function StatCard({ icon, label, value, sub }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function KillFeedTab({ kills }) {
  if (kills.length === 0) {
    return (
      <EmptyState
        icon={<Crosshair size={36} />}
        title="No kills yet"
        description="Kill events appear here in real time as players fight. If your server is running and players are dropping, give the in-game mod a few seconds to report the first event."
      />
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {kills.map((k, i) => <KillRow key={`${k.timestamp}-${i}`} kill={k} />)}
    </div>
  );
}

function KillRow({ kill }) {
  const time = kill.timestamp ? new Date(kill.timestamp).toLocaleTimeString() : '';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
      fontSize: 13,
    }}>
      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, minWidth: 60 }}>
        {time}
      </span>
      <span style={{ fontWeight: 600 }}>{kill.name || 'Unknown'}</span>
      <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
      <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{kill.victimName || 'Unknown'}</span>
      {kill.headshot && (
        <span style={{
          padding: '1px 6px', fontSize: 10, fontWeight: 700,
          background: 'color-mix(in srgb, var(--danger) 15%, transparent)',
          color: 'var(--danger)', borderRadius: 4,
        }}>HEADSHOT</span>
      )}
      <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12, display: 'flex', gap: 12 }}>
        <span>{kill.weapon || '—'}</span>
        <span>{Math.round(kill.distance || 0)}m</span>
      </span>
    </div>
  );
}

// ─── Analytics tab ──────────────────────────────────────────

function AnalyticsTab({ kills, stats, leaderboard }) {
  // Hour-of-day buckets from the kill feed timestamps
  const hourData = useMemo(() => {
    const buckets = new Array(24).fill(0);
    for (const k of kills) {
      if (!k.timestamp) continue;
      const h = new Date(k.timestamp).getHours();
      if (!Number.isNaN(h)) buckets[h] += 1;
    }
    return buckets.map((count, hour) => ({
      label: `${String(hour).padStart(2, '0')}:00`,
      value: count,
    }));
  }, [kills]);

  // Distance distribution buckets — tuned for DayZ engagement ranges
  const distanceData = useMemo(() => {
    const buckets = [
      { label: '0–50m', value: 0, min: 0, max: 50 },
      { label: '50–100m', value: 0, min: 50, max: 100 },
      { label: '100–200m', value: 0, min: 100, max: 200 },
      { label: '200–400m', value: 0, min: 200, max: 400 },
      { label: '400–800m', value: 0, min: 400, max: 800 },
      { label: '800m+', value: 0, min: 800, max: Infinity },
    ];
    for (const k of kills) {
      const d = Number(k.distance) || 0;
      const b = buckets.find((x) => d >= x.min && d < x.max);
      if (b) b.value += 1;
    }
    return buckets.map(({ label, value }) => ({ label, value }));
  }, [kills]);

  const avgDistance = useMemo(() => {
    if (kills.length === 0) return 0;
    const total = kills.reduce((s, k) => s + (Number(k.distance) || 0), 0);
    return total / kills.length;
  }, [kills]);

  const topWeapons = stats?.topWeapons?.slice(0, 10).map((w) => ({ label: w.weapon, value: w.count })) || [];
  const top3 = leaderboard?.entries?.slice(0, 3) || [];

  if (kills.length === 0 && top3.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 size={36} />}
        title="Nothing to analyze yet"
        description="Analytics will populate once your server has some kills logged. Come back after the first firefight."
      />
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
      {/* Weapons */}
      <Panel title="Top weapons" subtitle="Kills by weapon — current wipe">
        <BarChart data={topWeapons} />
      </Panel>

      {/* Hour of day */}
      <Panel title="Kills by hour" subtitle="Recent activity by server-clock hour">
        <BarChart data={hourData} color="var(--accent-purple, #a78bfa)" height={380} />
      </Panel>

      {/* Distance distribution */}
      <Panel title="Engagement range" subtitle={`Avg distance: ${Math.round(avgDistance)}m`}>
        <BarChart data={distanceData} color="var(--accent-orange, #f59e0b)" />
      </Panel>

      {/* Top 3 side-by-side */}
      <Panel title="Top 3 killers" subtitle="Head-to-head comparison">
        {top3.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
            Waiting for the leaderboard to populate.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${top3.length}, 1fr)`, gap: 10 }}>
            {top3.map((p, i) => (
              <div key={p.steamId} style={{
                padding: 12,
                background: 'var(--bg-deep)',
                border: `1px solid ${i === 0 ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Trophy size={14} style={{ color: i === 0 ? 'var(--accent)' : 'var(--text-muted)' }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{i + 1}</span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                </div>
                <ComparisonRow label="Kills" value={p.kills} />
                <ComparisonRow label="K/D" value={p.kd.toFixed(2)} />
                <ComparisonRow label="HS %" value={`${Math.round(p.headshotPct * 100)}%`} />
                <ComparisonRow label="Longest" value={p.longestKill ? `${Math.round(p.longestKill.distance)}m` : '—'} />
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function ComparisonRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function LeaderboardTab({ data, sortBy, onSortChange }) {
  if (!data || !data.entries) return null;
  if (data.entries.length === 0) {
    return (
      <EmptyState
        icon={<Trophy size={36} />}
        title="Leaderboard is empty"
        description="As kills are logged, the leaderboard builds automatically. It'll reset the next time you run a server wipe from Dangerzone."
      />
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sort by:</span>
        <select className="input" value={sortBy} onChange={(e) => onSortChange(e.target.value)} style={{ width: 180 }}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={11} /> Last reset: {data.lastReset ? new Date(data.lastReset).toLocaleString() : '—'}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Player</th>
              <th style={{ textAlign: 'right' }}>Kills</th>
              <th style={{ textAlign: 'right' }}>Deaths</th>
              <th style={{ textAlign: 'right' }}>K/D</th>
              <th style={{ textAlign: 'right' }}>HS</th>
              <th style={{ textAlign: 'right' }}>HS %</th>
              <th style={{ textAlign: 'right' }}>Longest</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((p, i) => (
              <tr key={p.steamId}>
                <td style={{ fontWeight: 700, color: i < 3 ? 'var(--accent)' : 'var(--text-muted)' }}>#{i + 1}</td>
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                <td style={{ textAlign: 'right' }}>{p.kills}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{p.deaths}</td>
                <td style={{ textAlign: 'right' }}>{p.kd.toFixed(2)}</td>
                <td style={{ textAlign: 'right' }}>{p.headshots}</td>
                <td style={{ textAlign: 'right' }}>{Math.round(p.headshotPct * 100)}%</td>
                <td style={{ textAlign: 'right' }}>{p.longestKill ? `${Math.round(p.longestKill.distance)}m` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
