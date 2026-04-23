import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import API from '../api';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/ui/EmptyState';
import {
  User, ArrowLeft, MessageSquare, Crosshair, Skull, Activity, Clock,
  Plus, Trash2, AlertTriangle, Copy, Globe, LogIn, LogOut, StickyNote, Calendar,
} from '../components/Icon';
import { timeAgo } from '../utils';

// ─── helpers ────────────────────────────────────────────────

function fmtDuration(ms) {
  if (!ms || ms < 0) return '0m';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || (!d && !h)) parts.push(`${m}m`);
  return parts.join(' ');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

const EVENT_META = {
  connect:   { icon: LogIn,         color: '#22c55e', label: 'Connected'    },
  disconnect:{ icon: LogOut,        color: '#94a3b8', label: 'Disconnected' },
  chat:      { icon: MessageSquare, color: '#3b82f6', label: 'Chat'         },
  kill:      { icon: Crosshair,     color: '#ef4444', label: 'Kill'         },
  death:     { icon: Skull,         color: '#f59e0b', label: 'Death'        },
  suicide:   { icon: Skull,         color: '#a78bfa', label: 'Suicide'      },
};

// ─── page ───────────────────────────────────────────────────

export default function PlayerProfilePage() {
  const { serverId, steamId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [noteDraft, setNoteDraft] = useState('');
  const [postingNote, setPostingNote] = useState(false);

  const fetchProfile = useCallback(async () => {
    setError(null);
    try {
      const data = await API.get(`/api/servers/${serverId}/players/${steamId}/profile`);
      setProfile(data);
    } catch (err) {
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [serverId, steamId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleAddNote = async () => {
    const text = noteDraft.trim();
    if (!text || postingNote) return;
    setPostingNote(true);
    try {
      await API.post(`/api/servers/${serverId}/players/${steamId}/notes`, { text });
      setNoteDraft('');
      await fetchProfile();
      window.addToast?.('Note added', 'success');
    } catch (err) {
      window.addToast?.(`Failed to add note: ${err.message}`, 'error');
    } finally {
      setPostingNote(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await API.del(`/api/servers/${serverId}/players/${steamId}/notes/${noteId}`);
      await fetchProfile();
      window.addToast?.('Note deleted', 'success');
    } catch (err) {
      window.addToast?.(`Failed to delete: ${err.message}`, 'error');
    }
  };

  const copySteamId = () => {
    navigator.clipboard?.writeText(steamId).then(
      () => window.addToast?.('SteamID copied', 'success'),
      () => {},
    );
  };

  if (loading) return <PageLoader />;

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/servers/${serverId}/players`)}>
          <ArrowLeft size={14} /> Back to Players
        </button>
        <EmptyState
          icon={<AlertTriangle size={36} />}
          title="Could not load profile"
          description={error + '. If this player has never been seen online since profile tracking was enabled, no profile exists yet.'}
        />
      </div>
    );
  }

  if (!profile) return null;

  const kd = profile.kd ?? (profile.lifetimeDeaths > 0 ? profile.lifetimeKills / profile.lifetimeDeaths : profile.lifetimeKills);
  const hsPct = profile.headshotPct ?? (profile.lifetimeKills > 0 ? profile.lifetimeHeadshots / profile.lifetimeKills : 0);

  return (
    <div style={{ padding: 16 }}>
      {/* Back link */}
      <Link
        to={`/servers/${serverId}/players`}
        className="btn btn-sm btn-ghost"
        style={{ marginBottom: 12, display: 'inline-flex' }}
      >
        <ArrowLeft size={14} /> Back to Players
      </Link>

      {/* Header card */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'color-mix(in srgb, var(--accent) 20%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)', flexShrink: 0,
          }}>
            <User size={32} />
          </div>

          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{profile.name}</h1>
              {profile.online ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, padding: '2px 8px', background: 'color-mix(in srgb, #22c55e 15%, transparent)', color: '#22c55e', borderRadius: 4 }}>
                  <Activity size={10} className="pulse" /> ONLINE
                </span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', background: 'color-mix(in srgb, var(--text-muted) 15%, transparent)', color: 'var(--text-muted)', borderRadius: 4 }}>
                  OFFLINE
                </span>
              )}
              {profile.notes?.length > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', background: 'color-mix(in srgb, #f59e0b 15%, transparent)', color: '#f59e0b', borderRadius: 4 }}>
                  <StickyNote size={10} /> {profile.notes.length} note{profile.notes.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
              <span>{steamId}</span>
              <button
                className="btn btn-xs btn-ghost"
                onClick={copySteamId}
                title="Copy SteamID"
                style={{ padding: 2 }}
              >
                <Copy size={12} />
              </button>
              <a
                href={`https://steamcommunity.com/profiles/${steamId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-xs btn-ghost"
                title="Open Steam profile"
                style={{ padding: 2 }}
              >
                <Globe size={12} />
              </a>
            </div>

            {profile.aliases?.length > 1 && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ fontWeight: 600 }}>Also known as:</span>{' '}
                {profile.aliases.filter((a) => a !== profile.name).slice(0, 6).join(', ')}
              </div>
            )}
          </div>
        </div>

        {/* Key stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 16 }}>
          <StatBox label="Sessions" value={profile.totalSessions?.toLocaleString() || '0'} />
          <StatBox label="Total play time" value={fmtDuration(profile.totalPlayMs)} />
          <StatBox label="Lifetime K/D" value={`${profile.lifetimeKills} / ${profile.lifetimeDeaths}`} hint={`${kd.toFixed(2)} ratio`} />
          <StatBox label="Headshot %" value={`${(hsPct * 100).toFixed(1)}%`} hint={`${profile.lifetimeHeadshots} total`} />
          <StatBox label="Messages" value={profile.totalMessages?.toLocaleString() || '0'} />
          <StatBox label="First seen" value={timeAgo(profile.firstSeen)} hint={fmtDate(profile.firstSeen)} />
          <StatBox label="Last seen" value={profile.online ? 'Online now' : timeAgo(profile.lastSeen)} hint={profile.online ? null : fmtDate(profile.lastSeen)} />
          {profile.ips?.length > 0 && (
            <StatBox label="Known IPs" value={`${profile.ips.length}`} hint={profile.ips.slice(0, 2).join(', ')} />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {[
          { id: 'overview', label: 'Timeline', icon: <Clock size={14} /> },
          { id: 'sessions', label: `Sessions (${profile.sessions?.length || 0})`, icon: <Calendar size={14} /> },
          { id: 'chat', label: `Chat (${profile.recentChat?.length || 0})`, icon: <MessageSquare size={14} /> },
          { id: 'notes', label: `Notes (${profile.notes?.length || 0})`, icon: <StickyNote size={14} /> },
        ].map((t) => (
          <button
            key={t.id}
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.id)}
            style={{ borderRadius: '6px 6px 0 0', marginBottom: -1 }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <TimelineTab events={profile.recentEvents} />}
      {tab === 'sessions' && <SessionsTab sessions={profile.sessions} currentSessionStart={profile.currentSessionStart} />}
      {tab === 'chat' && <ChatTab chat={profile.recentChat} />}
      {tab === 'notes' && (
        <NotesTab
          notes={profile.notes}
          draft={noteDraft}
          onDraftChange={setNoteDraft}
          posting={postingNote}
          onAdd={handleAddNote}
          onDelete={handleDeleteNote}
        />
      )}
    </div>
  );
}

// ─── sub-components ─────────────────────────────────────────

function StatBox({ label, value, hint }) {
  return (
    <div style={{ padding: 12, background: 'var(--bg-surface, var(--bg-card))', border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function TimelineTab({ events }) {
  if (!events || events.length === 0) {
    return <EmptyState icon={<Clock size={36} />} title="No timeline events yet" description="Events (connects, chats, kills, deaths) will appear here as they happen." />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {events.map((ev, i) => {
        const meta = EVENT_META[ev.type] || { icon: Activity, color: 'var(--text-muted)', label: ev.type || 'event' };
        const Icon = meta.icon;
        return (
          <div key={`${ev.timestamp}-${i}`} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px',
            background: 'var(--bg-surface, var(--bg-card))', border: '1px solid var(--border)', borderRadius: 6,
          }}>
            <div style={{ flexShrink: 0, color: meta.color, marginTop: 2 }}><Icon size={16} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: meta.color, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3 }}>{meta.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{fmtDate(ev.timestamp)}</span>
              </div>
              <TimelineEventBody ev={ev} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineEventBody({ ev }) {
  if (ev.type === 'chat') {
    return (
      <div style={{ fontSize: 13, marginTop: 2 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 6 }}>[{ev.channel || 'unknown'}]</span>
        {ev.message}
      </div>
    );
  }
  if (ev.type === 'kill') {
    return (
      <div style={{ fontSize: 13, marginTop: 2 }}>
        Killed <strong>{ev.victim}</strong>
        {ev.weapon ? <> with <code style={{ fontSize: 11 }}>{ev.weapon}</code></> : null}
        {ev.distance ? <> at {Math.round(ev.distance)}m</> : null}
        {ev.headshot ? <span style={{ color: '#f59e0b', marginLeft: 8, fontWeight: 700 }}>HEADSHOT</span> : null}
      </div>
    );
  }
  if (ev.type === 'death') {
    return (
      <div style={{ fontSize: 13, marginTop: 2 }}>
        Killed by <strong>{ev.killer}</strong>
        {ev.weapon ? <> with <code style={{ fontSize: 11 }}>{ev.weapon}</code></> : null}
        {ev.distance ? <> at {Math.round(ev.distance)}m</> : null}
      </div>
    );
  }
  if (ev.type === 'suicide') {
    return <div style={{ fontSize: 13, marginTop: 2, color: 'var(--text-muted)' }}>Self-kill{ev.cause ? ` — ${ev.cause}` : ''}</div>;
  }
  if (ev.type === 'disconnect') {
    return <div style={{ fontSize: 13, marginTop: 2, color: 'var(--text-muted)' }}>Session lasted {fmtDuration(ev.durationMs)}</div>;
  }
  return null;
}

function SessionsTab({ sessions, currentSessionStart }) {
  const all = useMemo(() => {
    const list = [...(sessions || [])];
    if (currentSessionStart) {
      list.unshift({
        start: currentSessionStart,
        end: null,
        durationMs: Date.now() - Date.parse(currentSessionStart),
        live: true,
      });
    }
    return list;
  }, [sessions, currentSessionStart]);

  if (all.length === 0) {
    return <EmptyState icon={<Calendar size={36} />} title="No sessions recorded" description="Each time this player connects and disconnects, a session will be logged here." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 180 }}>Start</th>
            <th style={{ width: 180 }}>End</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {all.map((s, i) => (
            <tr key={`${s.start}-${i}`}>
              <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{fmtDate(s.start)}</td>
              <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
                {s.live ? <span style={{ color: '#22c55e', fontWeight: 700 }}>Ongoing</span> : fmtDate(s.end)}
              </td>
              <td>{fmtDuration(s.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChatTab({ chat }) {
  if (!chat || chat.length === 0) {
    return <EmptyState icon={<MessageSquare size={36} />} title="No chat messages recorded" description="Chat messages from this player will accumulate here. The last 100 are kept." />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {chat.map((m, i) => (
        <div key={`${m.timestamp}-${i}`} style={{
          display: 'flex', gap: 10, padding: '6px 10px',
          background: 'var(--bg-surface, var(--bg-card))', border: '1px solid var(--border)', borderRadius: 6,
          alignItems: 'baseline',
        }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)', minWidth: 66 }}>
            {fmtTime(m.timestamp)}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--accent)', minWidth: 54 }}>
            {m.channel}
          </span>
          <span style={{ fontSize: 13, flex: 1, wordBreak: 'break-word' }}>{m.message}</span>
        </div>
      ))}
    </div>
  );
}

function NotesTab({ notes, draft, onDraftChange, posting, onAdd, onDelete }) {
  return (
    <div>
      <div style={{ padding: 12, background: 'var(--bg-surface, var(--bg-card))', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
        <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', fontWeight: 600 }}>
          Add admin note
        </label>
        <textarea
          className="input"
          rows={3}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="e.g. Verified long-time player, friendly · Spotted teaming with <name> · Reported for stream sniping on 2025-03-14"
          style={{ width: '100%', marginTop: 6, resize: 'vertical', fontFamily: 'inherit' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onAdd();
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Ctrl/⌘+Enter to save · Notes are visible to all admins and persist across wipes
          </span>
          <button className="btn btn-sm btn-primary" onClick={onAdd} disabled={posting || !draft.trim()}>
            <Plus size={14} /> {posting ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </div>

      {!notes || notes.length === 0 ? (
        <EmptyState icon={<StickyNote size={36} />} title="No notes yet" description="Admin notes help you remember context about this player across sessions and wipes." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notes.map((n) => (
            <div key={n.id} style={{
              padding: 12, background: 'var(--bg-surface, var(--bg-card))', border: '1px solid var(--border)', borderRadius: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{n.authorName}</strong>
                  {' · '}{fmtDate(n.timestamp)}
                </div>
                <button className="btn btn-xs btn-ghost" onClick={() => onDelete(n.id)} title="Delete note" style={{ color: 'var(--danger)' }}>
                  <Trash2 size={12} />
                </button>
              </div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
