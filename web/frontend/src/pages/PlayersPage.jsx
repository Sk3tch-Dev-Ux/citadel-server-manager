import { useState, useEffect, useMemo, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import Modal from '../components/ui/Modal';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '../components/ui/DropdownMenu';
import {
  Users, MoreVertical, Heart, Package, Send, LogOut,
  Trash2, Bomb, Skull, ShieldBan, Search,
} from '../components/Icon';

export default function PlayersPage({ serverId }) {
  const socket = useSocket();
  const [players, setPlayers] = useState([]);

  // ─── Spawn Item Modal State ──────────────────────────────
  const [spawnTarget, setSpawnTarget] = useState(null);
  const [items, setItems] = useState([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [itemQuantity, setItemQuantity] = useState(1);
  const [spawning, setSpawning] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef(null);

  // ─── Player List ─────────────────────────────────────────
  useEffect(() => {
    API.get(`/api/servers/${serverId}/players`).then(d => setPlayers(Array.isArray(d) ? d : []));
  }, [serverId]);

  useEffect(() => {
    const handler = (data) => {
      if (data.serverId === serverId) setPlayers(Array.isArray(data.players) ? data.players : []);
    };
    socket.on('players', handler);
    return () => socket.off('players', handler);
  }, [serverId, socket]);

  // ─── Lazy-load Item List ─────────────────────────────────
  useEffect(() => {
    if (spawnTarget && !itemsLoaded) {
      API.get(`/api/servers/${serverId}/items`).then(data => {
        if (Array.isArray(data)) setItems(data);
        setItemsLoaded(true);
      }).catch(() => setItemsLoaded(true));
    }
  }, [spawnTarget, itemsLoaded, serverId]);

  // ─── Filtered Suggestions ────────────────────────────────
  const filteredItems = useMemo(() => {
    if (!itemSearch.trim() || itemSearch.length < 2) return [];
    const q = itemSearch.toLowerCase();
    return items.filter(i => i.className.toLowerCase().includes(q)).slice(0, 20);
  }, [items, itemSearch]);

  // ─── Player Actions ──────────────────────────────────────
  const doAction = async (steamId, action, label, extra = {}) => {
    try {
      await API.post(`/api/servers/${serverId}/actions/${action}`, { steamId, ...extra });
      window.addToast?.(`${label} successful`, 'success');
    } catch (err) {
      window.addToast?.(`${label} failed: ${err.message}`, 'error');
    }
  };

  const kick = async (id) => {
    await API.post(`/api/servers/${serverId}/players/${id}/kick`, { reason: 'Kicked by admin' });
    window.addToast('Player kicked', 'success');
  };

  const ban = async (id) => {
    await API.post(`/api/servers/${serverId}/players/${id}/ban`, { reason: 'Banned by admin' });
    window.addToast('Player banned', 'success');
  };

  // ─── Spawn Item Submit ───────────────────────────────────
  const handleSpawnItem = async (e) => {
    e.preventDefault();
    if (!itemSearch.trim() || !spawnTarget) return;
    setSpawning(true);
    try {
      await API.post(`/api/servers/${serverId}/actions/spawn-item`, {
        steamId: spawnTarget.steamId,
        itemClass: itemSearch.trim(),
        quantity: itemQuantity,
      });
      window.addToast?.(`Spawned ${itemSearch.trim()} x${itemQuantity} on ${spawnTarget.name}`, 'success');
      closeSpawnModal();
    } catch (err) {
      window.addToast?.(`Spawn failed: ${err.message}`, 'error');
    }
    setSpawning(false);
  };

  const openSpawnModal = (player) => {
    setSpawnTarget({ id: player.id, steamId: player.steamId || player.id, name: player.name });
    setItemSearch('');
    setItemQuantity(1);
    setShowSuggestions(false);
  };

  const closeSpawnModal = () => {
    setSpawnTarget(null);
    setItemSearch('');
    setItemQuantity(1);
    setShowSuggestions(false);
  };

  const selectItem = (className) => {
    setItemSearch(className);
    setShowSuggestions(false);
  };

  // ─── Render ──────────────────────────────────────────────
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {players.length} player(s) online
        </span>
      </div>

      {players.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Users size={48} /></div>
          <div className="empty-title">No Players Online</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>IP</th>
                <th>Ping</th>
                <th style={{ width: 48 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {players.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.id}</td>
                  <td>{p.ip || '\u2014'}</td>
                  <td>{p.ping || '\u2014'}</td>
                  <td>
                    <PlayerActionsMenu
                      player={p}
                      onHeal={() => doAction(p.steamId || p.id, 'heal', `Heal ${p.name}`)}
                      onSpawnItem={() => openSpawnModal(p)}
                      onMessage={() => {
                        const msg = window.prompt(`Send message to ${p.name}:`);
                        if (msg) doAction(p.steamId || p.id, 'message', `Message ${p.name}`, { message: msg });
                      }}
                      onKick={() => kick(p.id)}
                      onStrip={() => {
                        if (window.confirm(`Strip all gear from ${p.name}?`))
                          doAction(p.steamId || p.id, 'strip', `Strip ${p.name}`);
                      }}
                      onExplode={() => {
                        if (window.confirm(`Explode ${p.name}?`))
                          doAction(p.steamId || p.id, 'explode', `Explode ${p.name}`);
                      }}
                      onKill={() => {
                        if (window.confirm(`Kill ${p.name}?`))
                          doAction(p.steamId || p.id, 'kill', `Kill ${p.name}`);
                      }}
                      onBan={() => ban(p.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Spawn Item Modal ──────────────────────────────── */}
      <Modal
        open={!!spawnTarget}
        onClose={closeSpawnModal}
        title={`Spawn Item \u2014 ${spawnTarget?.name || 'Player'}`}
      >
        <form onSubmit={handleSpawnItem} style={{ padding: '0 4px' }}>
          <div className="input-group">
            <label className="input-label">Item Class</label>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text-muted)', pointerEvents: 'none',
                }} />
                <input
                  ref={searchRef}
                  className="input"
                  style={{ paddingLeft: 34 }}
                  value={itemSearch}
                  onChange={e => { setItemSearch(e.target.value); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder="Search items... e.g. AKM, M4A1, BandageDressing"
                  autoFocus
                  autoComplete="off"
                />
              </div>
              {showSuggestions && filteredItems.length > 0 && (
                <div className="item-suggestions">
                  {filteredItems.map(item => (
                    <button
                      key={item.className}
                      type="button"
                      className="item-suggestion"
                      onClick={() => selectItem(item.className)}
                    >
                      <span className="item-suggestion__name">{item.className}</span>
                      {item.category && (
                        <span className="item-suggestion__cat">{item.category}</span>
                      )}
                    </button>
                  ))}
                  {filteredItems.length === 20 && (
                    <div className="item-suggestion__more">
                      Keep typing to narrow results...
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="settings-hint">
              {itemsLoaded
                ? `${items.length} items loaded from server types.xml`
                : spawnTarget ? 'Loading item list...' : ''}
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Quantity</label>
            <input
              className="input"
              type="number"
              min={1}
              max={99}
              value={itemQuantity}
              onChange={e => setItemQuantity(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))}
              style={{ width: 100 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="button" className="btn btn-secondary" onClick={closeSpawnModal}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!itemSearch.trim() || spawning}
            >
              <Package size={14} style={{ marginRight: 6 }} />
              {spawning ? 'Spawning...' : `Spawn x${itemQuantity}`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Player Actions Dropdown ─────────────────────────────────

function PlayerActionsMenu({
  player, onHeal, onSpawnItem, onMessage, onKick,
  onStrip, onExplode, onKill, onBan,
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button className="btn btn-sm btn-icon" title="Player actions">
          <MoreVertical size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onHeal}>
          <Heart size={14} /> Heal
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSpawnItem}>
          <Package size={14} /> Spawn Item
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMessage}>
          <Send size={14} /> Message
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onKick}>
          <LogOut size={14} /> Kick
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onStrip}>
          <Trash2 size={14} /> Strip Gear
        </DropdownMenuItem>
        <DropdownMenuItem danger onSelect={onExplode}>
          <Bomb size={14} /> Explode
        </DropdownMenuItem>
        <DropdownMenuItem danger onSelect={onKill}>
          <Skull size={14} /> Kill
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem danger onSelect={onBan}>
          <ShieldBan size={14} /> Ban
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
