import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import EmptyState from '../components/ui/EmptyState';
import PageLoader from '../components/PageLoader';
import {
  MessageSquare, Search, X, Download, RefreshCw, AlertTriangle, Activity,
} from '../components/Icon';
import { useDebouncedValue } from '../utils';

const CHANNEL_COLORS = {
  direct: '#22c55e',
  global: '#3b82f6',
  vehicle: '#f59e0b',
  radio: '#a78bfa',
  transmit: '#a78bfa',
  admin: '#ef4444',
};

function channelColor(ch) {
  if (!ch) return 'var(--text-muted)';
  const key = ch.toLowerCase();
  return CHANNEL_COLORS[key] || 'var(--text-secondary)';
}

function timeStr(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function ChatLogPage({ serverId }) {
  const socket = useSocket();
  const [messages, setMessages] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [player, setPlayer] = useState('');
  const [channel, setChannel] = useState('');
  const [q, setQ] = useState('');
  const [live, setLive] = useState(true);
  const debouncedPlayer = useDebouncedValue(player, 200);
  const debouncedQ = useDebouncedValue(q, 200);

  const fetchMessages = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (debouncedPlayer) params.set('player', debouncedPlayer);
      if (channel) params.set('channel', channel);
      if (debouncedQ) params.set('q', debouncedQ);
      const [msgsRes, channelsRes] = await Promise.all([
        API.get(`/api/servers/${serverId}/chat?${params.toString()}`),
        API.get(`/api/servers/${serverId}/chat/channels`),
      ]);
      setMessages(msgsRes?.messages || []);
      setChannels(channelsRes?.channels || []);
    } catch (err) {
      setError(err.message || 'Failed to load chat');
    } finally {
      setLoading(false);
    }
  }, [serverId, debouncedPlayer, channel, debouncedQ]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // ─── Live socket updates ──────────────────────────────────
  useEffect(() => {
    if (!socket || !live) return;
    socket.emit('citadel:subscribe', { serverId });
    const onEvents = (data) => {
      if (data.serverId !== serverId) return;
      const chatEvents = (data.events || []).filter((e) => e?.type === 'chat');
      if (chatEvents.length === 0) return;
      setMessages((prev) => {
        // Apply current filters to incoming events so the feed stays coherent
        const passes = chatEvents.filter((e) => {
          if (channel && e.channel !== channel) return false;
          if (debouncedPlayer) {
            const needle = debouncedPlayer.toLowerCase();
            if (!(e.name || '').toLowerCase().includes(needle) && e.steamId !== debouncedPlayer) return false;
          }
          if (debouncedQ && !(e.message || '').toLowerCase().includes(debouncedQ.toLowerCase())) return false;
          return true;
        });
        if (passes.length === 0) return prev;
        return [...passes.reverse(), ...prev].slice(0, 500);
      });
    };
    socket.on('citadel:events', onEvents);
    return () => {
      socket.emit('citadel:unsubscribe');
      socket.off('citadel:events', onEvents);
    };
  }, [socket, serverId, live, channel, debouncedPlayer, debouncedQ]);

  const handleClearFilters = () => {
    setPlayer(''); setChannel(''); setQ('');
  };

  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (debouncedPlayer) params.set('player', debouncedPlayer);
    if (channel) params.set('channel', channel);
    if (debouncedQ) params.set('q', debouncedQ);
    // Bearer auth is in localStorage; the browser will handle download via API helper
    const qs = params.toString();
    const url = `/api/servers/${serverId}/chat/export.csv${qs ? '?' + qs : ''}`;
    // API helper has a raw() that attaches auth; we want the browser to save the file
    API.raw(url)
      .then(async (res) => {
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = res.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'chat.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      })
      .catch((err) => window.addToast?.(`Export failed: ${err.message}`, 'error'));
  };

  const hasFilters = !!(player || channel || q);
  const isEmpty = !loading && messages.length === 0;

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <MessageSquare size={22} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Chat Log</h1>
        {live && (
          <span title="Receiving live updates" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent-green, #22c55e)' }}>
            <Activity size={11} className="pulse" /> Live
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setLive((l) => !l)} title={live ? 'Pause live updates' : 'Resume live updates'}>
            {live ? 'Pause' : 'Resume'}
          </button>
          <button className="btn btn-sm btn-secondary" onClick={fetchMessages} title="Reload">
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-sm btn-secondary" onClick={handleExportCsv} title="Download CSV (respects filters)">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Filter row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(180px, 1fr) minmax(160px, 220px) auto', gap: 10, marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Message contains…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: 32, width: '100%' }}
          />
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Player name or SteamID…"
            value={player}
            onChange={(e) => setPlayer(e.target.value)}
            style={{ paddingLeft: 32, width: '100%' }}
          />
        </div>
        <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">All channels</option>
          {channels.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
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

      {loading && <PageLoader />}

      {!loading && isEmpty && (
        <EmptyState
          icon={<MessageSquare size={36} />}
          title={hasFilters ? 'No chat messages match your filters' : 'No chat messages yet'}
          description={
            hasFilters
              ? 'Try removing some filters. The server only keeps the last few thousand messages in memory — older messages may have rolled off.'
              : "Chat messages appear here as players talk. Make sure the @CitadelAdmin mod is loaded — it's what captures chat events."
          }
          action={hasFilters ? (
            <button className="btn btn-sm btn-secondary" onClick={handleClearFilters}>
              <X size={14} /> Clear filters
            </button>
          ) : null}
        />
      )}

      {!loading && !isEmpty && (
        <ChatList messages={messages} />
      )}

      {!loading && !isEmpty && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
          Showing {messages.length} message{messages.length === 1 ? '' : 's'}
          {hasFilters ? ' (filtered)' : ''}. Newest first.
        </p>
      )}
    </div>
  );
}

function ChatList({ messages }) {
  const rows = useMemo(() => messages, [messages]);
  return (
    <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 340px)', overflow: 'auto' }}>
      <table>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-surface, var(--bg-card))' }}>
          <tr>
            <th style={{ width: 80 }}>Time</th>
            <th style={{ width: 90 }}>Channel</th>
            <th style={{ width: 180 }}>Player</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={`${m.timestamp}-${i}`}>
              <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>
                {timeStr(m.timestamp)}
              </td>
              <td>
                <span style={{
                  padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                  background: `color-mix(in srgb, ${channelColor(m.channel)} 15%, transparent)`,
                  color: channelColor(m.channel),
                  borderRadius: 4, whiteSpace: 'nowrap',
                }}>
                  {m.channel || '—'}
                </span>
              </td>
              <td style={{ fontWeight: 600 }} title={m.steamId}>{m.name || 'Unknown'}</td>
              <td style={{ wordBreak: 'break-word' }}>{m.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
