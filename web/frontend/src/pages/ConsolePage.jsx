/**
 * Console / RCON page.
 *
 * Reworked in v2.8:
 *   - Command history (↑/↓ arrows, persisted to localStorage per server)
 *   - Favorites / pinned commands (chip row above the input)
 *   - Live autocomplete dropdown filtered against the server's allowed
 *     RCON commands (fetched from `/rcon/commands` — stays in sync with
 *     the server-side whitelist automatically)
 *   - Inline help text below the input showing the description of the
 *     currently-typed command
 *   - Output section: filter by source (DayZ stdout / RCON responses),
 *     clear-visible-buffer button, copy-to-clipboard on any line
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import {
  Terminal, Send, Star, X, Trash2, Copy, Clock, Eraser,
} from '../components/Icon';

const HISTORY_CAP = 50;
const FAVORITES_CAP = 12;

function storageKey(kind, serverId) {
  return `citadel:console:${kind}:${serverId}`;
}
function loadStorage(kind, serverId, fallback) {
  try {
    const raw = localStorage.getItem(storageKey(kind, serverId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
}
function saveStorage(kind, serverId, value) {
  try { localStorage.setItem(storageKey(kind, serverId), JSON.stringify(value)); } catch { /* quota */ }
}

export default function ConsolePage({ serverId }) {
  const socket = useSocket();
  const [logs, setLogs] = useState([]);
  const [cmd, setCmd] = useState('');
  const [sending, setSending] = useState(false);

  // Autocomplete + history + favorites
  const [allowedCommands, setAllowedCommands] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1); // -1 = not browsing history
  const [history, setHistory] = useState(() => loadStorage('history', serverId, []));
  const [favorites, setFavorites] = useState(() => loadStorage('favorites', serverId, ['players', 'uptime', 'server']));
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(0);

  // Output filtering
  const [filterSource, setFilterSource] = useState('all'); // 'all' | 'rcon' | 'server'

  // Refs
  const outputRef = useRef(null);
  const inputRef = useRef(null);
  const autoScrollRef = useRef(true);

  // ─── Load initial + allowed commands ─────────────────────
  useEffect(() => {
    API.get(`/api/servers/${serverId}/console?limit=500`).then((d) => setLogs(Array.isArray(d) ? d : []));
    API.get(`/api/servers/${serverId}/rcon/commands`)
      .then((d) => setAllowedCommands(Array.isArray(d?.commands) ? d.commands : []))
      .catch(() => {});
    // Reload history/favorites when serverId changes (new tab on another server)
    setHistory(loadStorage('history', serverId, []));
    setFavorites(loadStorage('favorites', serverId, ['players', 'uptime', 'server']));
  }, [serverId]);

  // ─── Live socket ─────────────────────────────────────────
  useEffect(() => {
    const consoleHandler = (data) => {
      if (data.serverId === serverId) setLogs((l) => [data, ...l].slice(0, 500));
    };
    const rconHandler = (data) => {
      if (data.serverId && data.serverId !== serverId) return;
      setLogs((l) => [{
        timestamp: data.timestamp || new Date().toISOString(),
        level: 'info',
        source: 'rcon',
        message: data.message,
      }, ...l].slice(0, 500));
    };
    socket.on('consoleLog', consoleHandler);
    socket.on('rconMessage', rconHandler);
    return () => { socket.off('consoleLog', consoleHandler); socket.off('rconMessage', rconHandler); };
  }, [serverId, socket]);

  // ─── Auto-scroll (only when near bottom) ─────────────────
  useEffect(() => {
    const el = outputRef.current;
    if (el && autoScrollRef.current) el.scrollTop = el.scrollHeight;
  }, [logs]);
  const handleScroll = () => {
    const el = outputRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // ─── Filtered output ─────────────────────────────────────
  const visibleLogs = useMemo(() => {
    if (filterSource === 'all') return logs;
    if (filterSource === 'rcon') return logs.filter((l) => l.source === 'rcon');
    if (filterSource === 'server') return logs.filter((l) => l.source !== 'rcon');
    return logs;
  }, [logs, filterSource]);

  // ─── Autocomplete suggestions ────────────────────────────
  const suggestions = useMemo(() => {
    if (!showSuggestions) return [];
    const q = cmd.trim().toLowerCase();
    if (!q) return [];
    return allowedCommands
      .filter((c) => c.command.toLowerCase().startsWith(q))
      .slice(0, 8);
  }, [cmd, showSuggestions, allowedCommands]);

  // Clamp suggestIdx when suggestions shrink
  useEffect(() => {
    if (suggestIdx >= suggestions.length) setSuggestIdx(0);
  }, [suggestions.length, suggestIdx]);

  // Current-command description (for inline help)
  const currentHelp = useMemo(() => {
    const verb = cmd.trim().split(/\s+/)[0]?.toLowerCase();
    if (!verb) return null;
    const found = allowedCommands.find((c) => c.command.toLowerCase() === verb);
    return found?.description || null;
  }, [cmd, allowedCommands]);

  // ─── Send + history ──────────────────────────────────────
  const pushHistory = useCallback((command) => {
    if (!command.trim()) return;
    setHistory((prev) => {
      // Remove dup of same command to keep list tight, then push to top
      const filtered = prev.filter((h) => h !== command);
      const next = [command, ...filtered].slice(0, HISTORY_CAP);
      saveStorage('history', serverId, next);
      return next;
    });
  }, [serverId]);

  const sendCmd = useCallback(async (overrideText) => {
    const text = (overrideText ?? cmd).trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const result = await API.post(`/api/servers/${serverId}/rcon`, { command: text });
      if (result?.error) {
        window.addToast?.(result.error, 'error');
      } else {
        pushHistory(text);
      }
      if (!overrideText) setCmd('');
      setHistoryIndex(-1);
      setShowSuggestions(false);
    } catch (err) {
      window.addToast?.(`RCON failed: ${err.message}`, 'error');
    }
    setSending(false);
  }, [cmd, sending, serverId, pushHistory]);

  // ─── Favorites management ────────────────────────────────
  const toggleFavorite = (command) => {
    setFavorites((prev) => {
      const next = prev.includes(command)
        ? prev.filter((f) => f !== command)
        : [command, ...prev].slice(0, FAVORITES_CAP);
      saveStorage('favorites', serverId, next);
      return next;
    });
  };
  const isFavorite = cmd.trim() && favorites.includes(cmd.trim());

  // ─── Keyboard handling on the input ─────────────────────
  const onKeyDown = (e) => {
    // Enter — accept suggestion if one's highlighted, else send
    if (e.key === 'Enter') {
      if (showSuggestions && suggestions.length > 0) {
        e.preventDefault();
        const pick = suggestions[suggestIdx];
        if (pick) {
          setCmd(pick.command + ' ');
          setShowSuggestions(false);
        }
        return;
      }
      sendCmd();
      return;
    }

    // Tab — accept suggestion
    if (e.key === 'Tab' && showSuggestions && suggestions.length > 0) {
      e.preventDefault();
      const pick = suggestions[suggestIdx];
      if (pick) {
        setCmd(pick.command + ' ');
        setShowSuggestions(false);
      }
      return;
    }

    // Escape — close suggestions / clear input
    if (e.key === 'Escape') {
      if (showSuggestions) {
        setShowSuggestions(false);
      } else if (cmd) {
        setCmd('');
      }
      return;
    }

    // Arrows — navigate suggestions first, else history
    if (e.key === 'ArrowDown') {
      if (showSuggestions && suggestions.length > 0) {
        e.preventDefault();
        setSuggestIdx((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (history.length > 0) {
        e.preventDefault();
        const nextIdx = Math.max(historyIndex - 1, -1);
        setHistoryIndex(nextIdx);
        setCmd(nextIdx === -1 ? '' : history[nextIdx]);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      if (showSuggestions && suggestions.length > 0) {
        e.preventDefault();
        setSuggestIdx((i) => Math.max(i - 1, 0));
      } else if (history.length > 0) {
        e.preventDefault();
        const nextIdx = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(nextIdx);
        setCmd(history[nextIdx]);
      }
      return;
    }
  };

  const onChange = (e) => {
    const v = e.target.value;
    setCmd(v);
    setHistoryIndex(-1);
    setShowSuggestions(v.trim().length > 0);
    setSuggestIdx(0);
  };

  // ─── Clear visible output ────────────────────────────────
  const clearOutput = () => setLogs([]);

  const copyLine = (line) => {
    const text = `${new Date(line.timestamp).toISOString()} [${line.source || 'server'}] ${line.message}`;
    navigator.clipboard?.writeText(text).then(
      () => window.addToast?.('Copied', 'success'),
      () => {}
    );
  };

  return (
    <div className="console-wrap">
      {/* Output toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface, var(--bg-card))',
      }}>
        <Terminal size={14} style={{ color: 'var(--accent)' }} />
        <strong style={{ fontSize: 13 }}>Console</strong>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {visibleLogs.length} of {logs.length} lines
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 2 }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'server', label: 'Server' },
            { id: 'rcon', label: 'RCON' },
          ].map((o) => (
            <button
              key={o.id}
              onClick={() => setFilterSource(o.id)}
              className={`btn btn-xs ${filterSource === o.id ? 'btn-primary' : 'btn-ghost'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button className="btn btn-xs btn-ghost" onClick={clearOutput} title="Clear visible buffer (server output unaffected)">
          <Eraser size={12} /> Clear
        </button>
      </div>

      {/* Output */}
      <div className="console-output" ref={outputRef} onScroll={handleScroll}>
        {visibleLogs.length === 0 && (
          <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
            {filterSource === 'all'
              ? 'Console output will appear here. Try a command like `players` or `uptime` below.'
              : `No ${filterSource} lines yet. Try switching to "All" above.`}
          </div>
        )}
        {[...visibleLogs].reverse().map((log, i) => (
          <div
            key={i}
            className={`console-line ${log.level || ''}`}
            onDoubleClick={() => copyLine(log)}
            title="Double-click to copy"
            style={{ cursor: 'text' }}
          >
            <span className="console-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
            {log.source === 'rcon' && <span style={{ color: 'var(--accent)' }}>[rcon] </span>}
            {log.message}
          </div>
        ))}
      </div>

      {/* Favorites row */}
      {favorites.length > 0 && (
        <div style={{
          display: 'flex', gap: 6, flexWrap: 'wrap',
          padding: '6px 12px', borderTop: '1px solid var(--border)',
          background: 'var(--bg-surface, var(--bg-card))',
          alignItems: 'center',
        }}>
          <Star size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
          {favorites.map((f) => (
            <button
              key={f}
              onClick={() => sendCmd(f)}
              onContextMenu={(e) => { e.preventDefault(); toggleFavorite(f); }}
              className="btn btn-xs btn-ghost"
              title="Click to run · Right-click to unpin"
              style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div style={{ position: 'relative', borderTop: '1px solid var(--border)' }}>
        {/* Autocomplete dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, right: 0,
            maxHeight: 240, overflow: 'auto',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderBottom: 'none', boxShadow: '0 -4px 12px rgba(0,0,0,0.2)',
          }}>
            {suggestions.map((s, i) => (
              <div
                key={s.command}
                onMouseDown={(e) => { e.preventDefault(); setCmd(s.command + ' '); setShowSuggestions(false); inputRef.current?.focus(); }}
                style={{
                  padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer', fontSize: 12,
                  background: i === suggestIdx ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : undefined,
                }}
              >
                <code style={{ fontWeight: 700, color: 'var(--accent)', minWidth: 110 }}>{s.command}</code>
                <span style={{ color: 'var(--text-muted)', flex: 1 }}>{s.description}</span>
              </div>
            ))}
            <div style={{
              padding: '4px 12px', fontSize: 10, color: 'var(--text-muted)',
              borderTop: '1px solid var(--border)', display: 'flex', gap: 12,
            }}>
              <span>↑↓ navigate</span>
              <span>Tab / Enter accept</span>
              <span>Esc close</span>
            </div>
          </div>
        )}

        <div className="console-input" style={{ position: 'relative', display: 'flex', gap: 6, padding: 8 }}>
          <input
            ref={inputRef}
            value={cmd}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onFocus={() => { if (cmd.trim()) setShowSuggestions(true); }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
            placeholder="Enter RCON command… (↑/↓ for history, Tab to autocomplete)"
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onClick={() => cmd.trim() && toggleFavorite(cmd.trim())}
            className="btn btn-ghost"
            disabled={!cmd.trim()}
            title={isFavorite ? 'Unpin from favorites' : 'Pin to favorites'}
            style={{ color: isFavorite ? '#f59e0b' : undefined, padding: '6px 10px' }}
          >
            <Star size={14} fill={isFavorite ? '#f59e0b' : 'none'} />
          </button>
          <button onClick={() => sendCmd()} disabled={sending || !cmd.trim()} className="btn btn-primary">
            <Send size={13} /> {sending ? '…' : 'Send'}
          </button>
        </div>

        {/* Inline help */}
        {currentHelp && (
          <div style={{
            padding: '0 12px 8px', fontSize: 11, color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Clock size={10} /> {currentHelp}
          </div>
        )}

        {/* History hint (only when empty and history exists) */}
        {!cmd && history.length > 0 && (
          <div style={{
            padding: '0 12px 8px', fontSize: 10, color: 'var(--text-muted)',
          }}>
            Press ↑ to recall your last command ({history.length} in history).
          </div>
        )}
      </div>
    </div>
  );
}
