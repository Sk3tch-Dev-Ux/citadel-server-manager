import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import Modal from '../components/ui/Modal';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '../components/ui/DropdownMenu';
import {
  Users, MoreVertical, Heart, Package, Send, LogOut,
  Trash2, Bomb, Skull, ShieldBan, Search, Locate, Lock,
  Navigation, Eye, Loader, Droplets, Pill, Coffee,
  UtensilsCrossed, ZapOff, Eraser, ArrowUpFromLine,
  Shield, Zap, Infinity as InfinityIcon, Backpack, Wand2, Clock, User, X,
} from '../components/Icon';
import { useDebouncedValue, timeAgo } from '../utils';

export default function PlayersPage({ serverId }) {
  const socket = useSocket();
  const { confirm, prompt, DialogComponent } = useConfirmDialog();
  const [players, setPlayers] = useState([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [historySearchOpen, setHistorySearchOpen] = useState(false);

  // ─── Spawn Item Modal State ──────────────────────────────
  const [spawnTarget, setSpawnTarget] = useState(null);
  const [items, setItems] = useState([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [itemQuantity, setItemQuantity] = useState(1);
  const [spawning, setSpawning] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef(null);

  // ─── Teleport To Player Modal State ────────────────────
  const [teleportSource, setTeleportSource] = useState(null);

  // ─── Loadout Viewer Modal State ────────────────────────
  const [loadoutTarget, setLoadoutTarget] = useState(null);
  const [loadoutData, setLoadoutData] = useState(null);
  const [loadoutLoading, setLoadoutLoading] = useState(false);

  // ─── Player List ─────────────────────────────────────────
  useEffect(() => {
    API.get(`/api/servers/${serverId}/players`).then(d => setPlayers(Array.isArray(d) ? d : []));
  }, [serverId]);

  // ─── Ban List (global — one database, applies to all servers) ──
  const [bans, setBans] = useState([]);
  const [bansOpen, setBansOpen] = useState(false);
  const loadBans = () => API.get(`/api/servers/${serverId}/bans`)
    .then(d => setBans(Array.isArray(d) ? d : []))
    .catch(() => {});
  useEffect(() => { loadBans(); }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const unban = async (b) => {
    const ok = await confirm({
      title: `Unban ${b.playerName || b.steamId}`,
      message: `Remove the ban for ${b.steamId}? They can reconnect immediately (ban.txt and the mod enforcement list update on all servers).`,
      confirmLabel: 'Unban',
    });
    if (!ok) return;
    try {
      await API.del(`/api/servers/${serverId}/bans/${b.id}`);
      window.addToast?.(`${b.playerName || b.steamId} unbanned`, 'success');
      loadBans();
    } catch (err) {
      window.addToast?.(`Unban failed: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    const handler = (data) => {
      if (data.serverId === serverId) setPlayers(Array.isArray(data.players) ? data.players : []);
    };
    socket.on('players', handler);
    return () => socket.off('players', handler);
  }, [serverId, socket]);

  // ─── Lazy-load Item List ─────────────────────────────────
  const [itemsError, setItemsError] = useState(false);
  useEffect(() => {
    if (spawnTarget && !itemsLoaded) {
      setItemsError(false);
      API.get(`/api/servers/${serverId}/items`).then(data => {
        if (Array.isArray(data)) setItems(data);
        else setItemsError(true);
        setItemsLoaded(true);
      }).catch(() => { setItemsError(true); setItemsLoaded(true); });
    }
  }, [spawnTarget, itemsLoaded, serverId]);

  // ─── Filtered Suggestions ────────────────────────────────
  const filteredItems = useMemo(() => {
    if (!itemSearch.trim() || itemSearch.length < 2) return [];
    const q = itemSearch.toLowerCase();
    return items.filter(i => i.className.toLowerCase().includes(q)).slice(0, 20);
  }, [items, itemSearch]);

  // ─── Player Actions ──────────────────────────────────────
  const [actionInProgress, setActionInProgress] = useState(null);
  const doAction = async (steamId, action, label, extra = {}) => {
    if (actionInProgress) return;
    setActionInProgress(`${steamId}:${action}`);
    try {
      const result = await API.post(`/api/servers/${serverId}/actions/${action}`, { steamId, ...extra });
      if (result?.error) window.addToast?.(result.error, 'error');
      else window.addToast?.(`${label} successful`, 'success');
    } catch (err) {
      window.addToast?.(`${label} failed: ${err.message}`, 'error');
    }
    setActionInProgress(null);
  };

  const kick = async (steamId, name) => {
    const reason = await prompt({
      title: `Kick ${name}`,
      message: 'Provide a reason for the kick:',
      placeholder: 'Kicked by admin',
      defaultValue: 'Kicked by admin',
      confirmLabel: 'Kick',
    });
    if (reason === null) return; // cancelled
    try {
      await API.post(`/api/servers/${serverId}/actions/kick`, { steamId, reason: reason.trim() || 'Kicked by admin' });
      window.addToast?.(`${name} kicked`, 'success');
    } catch (err) {
      window.addToast?.(`Kick failed: ${err.message}`, 'error');
    }
  };

  const ban = async (steamId, name) => {
    const reason = await prompt({
      title: `Ban ${name}`,
      message: 'This will permanently ban the player and remove them from the server.',
      placeholder: 'Reason for ban',
      defaultValue: 'Banned by admin',
      confirmLabel: 'Ban Permanently',
      variant: 'danger',
    });
    if (reason === null) return; // cancelled
    try {
      await API.post(`/api/servers/${serverId}/actions/ban`, { steamId, reason: reason.trim() || 'Banned by admin' });
      window.addToast?.(`${name} banned`, 'success');
    } catch (err) {
      window.addToast?.(`Ban failed: ${err.message}`, 'error');
    }
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

  // ─── Teleport To Player ───────────────────────────────
  const openTeleportToPlayer = (player) => {
    setTeleportSource({ id: player.id, steamId: player.steamId || player.id, name: player.name });
  };

  const doTeleportToPlayer = async (targetPlayer) => {
    if (!teleportSource) return;
    try {
      await API.post(`/api/servers/${serverId}/actions/teleport-to-player`, {
        steamId: teleportSource.steamId,
        targetSteamId: targetPlayer.steamId || targetPlayer.id,
      });
      window.addToast?.(`Teleported ${teleportSource.name} to ${targetPlayer.name}`, 'success');
    } catch (err) {
      window.addToast?.(`Teleport failed: ${err.message}`, 'error');
    }
    setTeleportSource(null);
  };

  // ─── Get Loadout ──────────────────────────────────────
  const openLoadout = async (player) => {
    const steamId = player.steamId || player.id;
    setLoadoutTarget({ name: player.name, steamId });
    setLoadoutLoading(true);
    setLoadoutData(null);
    try {
      const result = await API.get(`/api/servers/${serverId}/actions/loadout/${encodeURIComponent(steamId)}`);
      setLoadoutData(result?.data?.items || result?.items || []);
    } catch (err) {
      window.addToast?.(`Failed to get loadout: ${err.message}`, 'error');
      setLoadoutTarget(null);
    }
    setLoadoutLoading(false);
  };

  // ─── Filtered Online List ────────────────────────────────
  const visiblePlayers = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.steamId || p.id || '').includes(q) ||
      (p.ip || '').includes(q)
    );
  }, [players, filterQuery]);

  // ─── Render ──────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {filterQuery
            ? `${visiblePlayers.length} of ${players.length} player(s) online`
            : `${players.length} player(s) online`}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Filter online players…"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{ paddingLeft: 30, paddingRight: filterQuery ? 28 : 10, minWidth: 220 }}
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
              title="Clear"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => setHistorySearchOpen(true)}
          title="Search all players (including offline) — profile history"
        >
          <Clock size={14} /> Search history
        </button>
      </div>

      {players.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon empty-state-icon-large"><Users size={48} /></div>
          <div className="empty-title">No players online</div>
          <p style={{ color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto' }}>
            Players will appear here as they connect. If your server is running and players
            are joining, check that RCON is configured correctly under Server Settings.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          {/* Audit N8 \u2014 mobile-card-table converts to stacked cards below
              600px via CSS. data-label on each <td> labels the cell when
              it stacks. Critical for crisis-at-2am mobile usability. */}
          <table className="mobile-card-table">
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
              {visiblePlayers.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>
                    <Link
                      to={`/servers/${serverId}/players/${p.steamId || p.id}`}
                      style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      title="View player profile & history"
                    >
                      {p.name}
                      <User size={12} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
                    </Link>
                  </td>
                  <td data-label="ID" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.id}</td>
                  <td data-label="IP">{p.ip || '\u2014'}</td>
                  <td data-label="Ping">{p.ping || '\u2014'}</td>
                  <td data-label="Actions">
                    <PlayerActionsMenu
                      player={p}
                      onHeal={() => doAction(p.steamId || p.id, 'heal', `Heal ${p.name}`)}
                      onSpawnItem={() => openSpawnModal(p)}
                      onMessage={async () => {
                        const msg = await prompt({ title: 'Send Message', message: `Send message to ${p.name}:`, placeholder: 'Type your message...' });
                        if (msg) doAction(p.steamId || p.id, 'message', `Message ${p.name}`, { message: msg });
                      }}
                      onUnstuck={() => doAction(p.steamId || p.id, 'unstuck', `Unstuck ${p.name}`)}
                      onFreeze={async () => {
                        if (await confirm({ title: 'Freeze Player', message: `Freeze ${p.name}? They will be unable to move.`, confirmLabel: 'Freeze', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'freeze', `Freeze ${p.name}`, { frozen: 1 });
                      }}
                      onUnfreeze={() => doAction(p.steamId || p.id, 'freeze', `Unfreeze ${p.name}`, { frozen: 0 })}
                      onTeleportTo={() => openTeleportToPlayer(p)}
                      onLoadout={() => openLoadout(p)}
                      onKick={() => kick(p.steamId || p.id, p.name)}
                      onStrip={async () => {
                        if (await confirm({ title: 'Strip Gear', message: `Strip all gear from ${p.name}?`, confirmLabel: 'Strip', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'strip', `Strip ${p.name}`);
                      }}
                      onExplode={async () => {
                        if (await confirm({ title: 'Explode Player', message: `Explode ${p.name}?`, confirmLabel: 'Explode', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'explode', `Explode ${p.name}`);
                      }}
                      onKill={async () => {
                        if (await confirm({ title: 'Kill Player', message: `Kill ${p.name}?`, confirmLabel: 'Kill', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'kill', `Kill ${p.name}`);
                      }}
                      onBan={() => ban(p.steamId || p.id, p.name)}
                      /* ─── New Health/Status Actions ──────────── */
                      onDry={() => doAction(p.steamId || p.id, 'dry', `Dry ${p.name}`)}
                      onCure={() => doAction(p.steamId || p.id, 'cure', `Cure ${p.name}`)}
                      onForceDrink={() => doAction(p.steamId || p.id, 'force-drink', `Force drink ${p.name}`)}
                      onForceEat={() => doAction(p.steamId || p.id, 'force-eat', `Force eat ${p.name}`)}
                      onStopBleeding={() => doAction(p.steamId || p.id, 'stop-bleeding', `Stop bleeding ${p.name}`)}
                      onKnockout={async () => {
                        if (await confirm({ title: 'Knockout', message: `Knock out ${p.name}?`, confirmLabel: 'Knockout', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'knockout', `Knockout ${p.name}`);
                      }}
                      onWake={() => doAction(p.steamId || p.id, 'wake', `Wake ${p.name}`)}
                      onBreakLegs={async () => {
                        if (await confirm({ title: 'Break Legs', message: `Break ${p.name}'s legs?`, confirmLabel: 'Break Legs', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'break-legs', `Break legs ${p.name}`);
                      }}
                      onMakeSick={async () => {
                        if (await confirm({ title: 'Make Sick', message: `Make ${p.name} sick (cholera)?`, confirmLabel: 'Make Sick', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'make-sick', `Make sick ${p.name}`, { diseaseType: 'cholera' });
                      }}
                      /* ─── New Ability/State Actions ──────────── */
                      onSetGodmode={() => doAction(p.steamId || p.id, 'set-godmode', `God mode ON ${p.name}`)}
                      onRemoveGodmode={() => doAction(p.steamId || p.id, 'remove-godmode', `God mode OFF ${p.name}`)}
                      onSetInvisible={() => doAction(p.steamId || p.id, 'set-invisible', `Invisible ON ${p.name}`)}
                      onRemoveInvisible={() => doAction(p.steamId || p.id, 'remove-invisible', `Invisible OFF ${p.name}`)}
                      onSetStaminaInfinite={() => doAction(p.steamId || p.id, 'set-stamina-infinite', `Infinite stamina ON ${p.name}`)}
                      onRemoveStaminaInfinite={() => doAction(p.steamId || p.id, 'remove-stamina-infinite', `Infinite stamina OFF ${p.name}`)}
                      onFillMagazines={() => doAction(p.steamId || p.id, 'fill-magazines', `Fill magazines ${p.name}`)}
                      onClearInventory={async () => {
                        if (await confirm({ title: 'Clear Inventory', message: `Delete all items from ${p.name}?`, confirmLabel: 'Clear', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'clear-inventory', `Clear inventory ${p.name}`);
                      }}
                      onDropGear={async () => {
                        if (await confirm({ title: 'Drop Gear', message: `Force ${p.name} to drop all gear on the ground?`, confirmLabel: 'Drop', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'drop-gear', `Drop gear ${p.name}`);
                      }}
                      onLaunch={async () => {
                        if (await confirm({ title: 'Launch Player', message: `Launch ${p.name} into the sky?`, confirmLabel: 'Launch', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'launch', `Launch ${p.name}`, { power: 50, angle: 75 });
                      }}
                      onRespawn={async () => {
                        if (await confirm({ title: 'Respawn', message: `Force ${p.name} to respawn? This will kill them.`, confirmLabel: 'Respawn', variant: 'danger' }))
                          doAction(p.steamId || p.id, 'respawn', `Respawn ${p.name}`);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Ban List (global database) ───────────────────── */}
      <div className="card" style={{ marginTop: 24 }}>
        <div
          className="card-header"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setBansOpen(o => !o)}
        >
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldBan size={16} /> Bans ({bans.length})
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            global — applies to all servers · click to {bansOpen ? 'hide' : 'show'}
          </span>
        </div>
        {bansOpen && (bans.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
            No active bans.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="mobile-card-table">
              <thead>
                <tr><th>Player</th><th>Steam ID</th><th>Reason</th><th>Banned</th><th>By</th><th style={{ width: 90 }} /></tr>
              </thead>
              <tbody>
                {bans.map(b => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.playerName || '—'}</td>
                    <td data-label="Steam ID" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{b.steamId}</td>
                    <td data-label="Reason">{b.reason || '—'}</td>
                    <td data-label="Banned">{b.bannedAt ? timeAgo(b.bannedAt) : '—'}</td>
                    <td data-label="By">{b.bannedBy || '—'}</td>
                    <td data-label="">
                      <button className="btn btn-sm btn-secondary" onClick={() => unban(b)}>Unban</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

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

      {/* ─── Teleport To Player Modal ──────────────────────── */}
      <Modal
        open={!!teleportSource}
        onClose={() => setTeleportSource(null)}
        title={`Teleport ${teleportSource?.name || 'Player'} To...`}
      >
        <div style={{ padding: '0 4px' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
            Select a target player to teleport {teleportSource?.name} to their position.
          </p>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {players
              .filter(p => (p.steamId || p.id) !== teleportSource?.steamId)
              .map(p => (
                <button
                  key={p.id}
                  className="item-suggestion"
                  style={{ width: '100%' }}
                  onClick={() => doTeleportToPlayer(p)}
                >
                  <span className="item-suggestion__name">{p.name}</span>
                  <span className="item-suggestion__cat">{p.steamId || p.id}</span>
                </button>
              ))}
            {players.filter(p => (p.steamId || p.id) !== teleportSource?.steamId).length === 0 && (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                No other players online
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setTeleportSource(null)}>Cancel</button>
          </div>
        </div>
      </Modal>

      {/* ─── Loadout Viewer Modal ──────────────────────────── */}
      <Modal
        open={!!loadoutTarget}
        onClose={() => { setLoadoutTarget(null); setLoadoutData(null); }}
        title={`Loadout — ${loadoutTarget?.name || 'Player'}`}
      >
        <div style={{ padding: '0 4px' }}>
          {loadoutLoading ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
              <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
              <div style={{ marginTop: 8 }}>Loading inventory...</div>
            </div>
          ) : loadoutData && loadoutData.length > 0 ? (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Item</th>
                    <th style={{ width: 60, textAlign: 'right' }}>Qty</th>
                    <th style={{ width: 80, textAlign: 'right' }}>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {loadoutData.map((item, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{item.className}</td>
                      <td style={{ textAlign: 'right' }}>{item.quantity || 1}</td>
                      <td style={{ textAlign: 'right' }}>
                        {item.maxHealth > 0
                          ? `${Math.round((item.health / item.maxHealth) * 100)}%`
                          : '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : loadoutData ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
              Player has no items
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => { setLoadoutTarget(null); setLoadoutData(null); }}>
              Close
            </button>
          </div>
        </div>
      </Modal>

      {historySearchOpen && (
        <HistorySearchModal
          serverId={serverId}
          onClose={() => setHistorySearchOpen(false)}
        />
      )}

      {DialogComponent}
    </div>
  );
}

// ─── History Search Modal ────────────────────────────────────

function HistorySearchModal({ serverId, onClose }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const debouncedQ = useDebouncedValue(q, 200);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (debouncedQ) params.set('q', debouncedQ);
    API.get(`/api/servers/${serverId}/players/search?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setResults(data?.results || []);
        setTotal(data?.total || 0);
      })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQ, serverId]);

  const fmtMs = (ms) => {
    if (!ms) return '—';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <Modal open onClose={onClose} title="Player history search" large>
      <div style={{ padding: 16 }}>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Search by name, alias, or SteamID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            style={{ paddingLeft: 30, width: '100%' }}
          />
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          {loading ? 'Searching…' : `${results.length} of ${total} profile${total === 1 ? '' : 's'} shown. Click a row to view full history.`}
        </div>

        <div style={{ maxHeight: '55vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          {results.length === 0 && !loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {debouncedQ ? `No profiles match "${debouncedQ}"` : 'No profiles recorded yet — they build as players connect.'}
            </div>
          ) : (
            <table>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-surface, var(--bg-card))', zIndex: 1 }}>
                <tr>
                  <th>Name</th>
                  <th style={{ width: 120 }}>Last seen</th>
                  <th style={{ width: 80 }}>Sessions</th>
                  <th style={{ width: 90 }}>Play time</th>
                  <th style={{ width: 70 }}>K/D</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.steamId}>
                    <td>
                      <Link
                        to={`/servers/${serverId}/players/${r.steamId}`}
                        onClick={onClose}
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        <div style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {r.name}
                          {r.online && <span style={{ fontSize: 9, padding: '1px 6px', background: 'color-mix(in srgb, #22c55e 15%, transparent)', color: '#22c55e', borderRadius: 3, fontWeight: 700 }}>ONLINE</span>}
                          {r.notesCount > 0 && <span style={{ fontSize: 9, padding: '1px 6px', background: 'color-mix(in srgb, #f59e0b 15%, transparent)', color: '#f59e0b', borderRadius: 3, fontWeight: 700 }}>{r.notesCount} NOTE{r.notesCount === 1 ? '' : 'S'}</span>}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{r.steamId}</div>
                        {r.aliases?.length > 1 && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            aka {r.aliases.filter((a) => a !== r.name).slice(0, 3).join(', ')}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.online ? 'Online now' : timeAgo(r.lastSeen)}</td>
                    <td>{r.totalSessions}</td>
                    <td>{fmtMs(r.totalPlayMs)}</td>
                    <td>{r.lifetimeKills}/{r.lifetimeDeaths}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Player Actions Dropdown ─────────────────────────────────

function PlayerActionsMenu({
  player, onHeal, onSpawnItem, onMessage, onUnstuck, onFreeze, onUnfreeze,
  onTeleportTo, onLoadout, onKick, onStrip, onExplode, onKill, onBan,
  onDry, onCure, onForceDrink, onForceEat, onStopBleeding, onKnockout, onWake,
  onBreakLegs, onMakeSick,
  onSetGodmode, onRemoveGodmode, onSetInvisible, onRemoveInvisible,
  onSetStaminaInfinite, onRemoveStaminaInfinite, onFillMagazines,
  onClearInventory, onDropGear, onLaunch, onRespawn,
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button className="btn btn-sm btn-icon" title="Player actions">
          <MoreVertical size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent style={{ maxHeight: 480, overflowY: 'auto' }}>
        {/* ─── Healing & Care ─── */}
        <div className="dropdown-label">Healing</div>
        <DropdownMenuItem onSelect={onHeal}>
          <Heart size={14} /> Full Heal
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCure}>
          <Pill size={14} /> Cure Diseases
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onStopBleeding}>
          <Droplets size={14} /> Stop Bleeding
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDry}>
          <Droplets size={14} /> Dry Player
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onForceDrink}>
          <Coffee size={14} /> Max Hydration
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onForceEat}>
          <UtensilsCrossed size={14} /> Max Nutrition
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onWake}>
          <Zap size={14} /> Wake Up
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onUnstuck}>
          <Locate size={14} /> Unstuck
        </DropdownMenuItem>

        {/* ─── Admin Abilities ─── */}
        <DropdownMenuSeparator />
        <div className="dropdown-label">Admin Powers</div>
        <DropdownMenuItem onSelect={onSetGodmode}>
          <Shield size={14} /> God Mode On
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemoveGodmode}>
          <Shield size={14} /> God Mode Off
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSetInvisible}>
          <Eye size={14} /> Invisible On
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemoveInvisible}>
          <Eye size={14} /> Invisible Off
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSetStaminaInfinite}>
          <InfinityIcon size={14} /> Infinite Stamina On
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemoveStaminaInfinite}>
          <InfinityIcon size={14} /> Infinite Stamina Off
        </DropdownMenuItem>

        {/* ─── Inventory & Items ─── */}
        <DropdownMenuSeparator />
        <div className="dropdown-label">Inventory</div>
        <DropdownMenuItem onSelect={onLoadout}>
          <Eye size={14} /> View Loadout
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSpawnItem}>
          <Package size={14} /> Spawn Item
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onFillMagazines}>
          <Wand2 size={14} /> Fill Magazines
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onStrip}>
          <Trash2 size={14} /> Strip Gear
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDropGear}>
          <Backpack size={14} /> Drop All Gear
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onClearInventory}>
          <Eraser size={14} /> Clear Inventory
        </DropdownMenuItem>

        {/* ─── Communication & Movement ─── */}
        <DropdownMenuSeparator />
        <div className="dropdown-label">Movement</div>
        <DropdownMenuItem onSelect={onMessage}>
          <Send size={14} /> Message
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onTeleportTo}>
          <Navigation size={14} /> Teleport To Player
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onFreeze}>
          <Lock size={14} /> Freeze
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onUnfreeze}>
          <Locate size={14} /> Unfreeze
        </DropdownMenuItem>

        {/* ─── Moderation ─── */}
        <DropdownMenuSeparator />
        <div className="dropdown-label">Moderation</div>
        <DropdownMenuItem onSelect={onKick}>
          <LogOut size={14} /> Kick
        </DropdownMenuItem>
        <DropdownMenuItem danger onSelect={onBan}>
          <ShieldBan size={14} /> Ban
        </DropdownMenuItem>

        {/* ─── Harmful / Danger ─── */}
        <DropdownMenuSeparator />
        <div className="dropdown-label">Harmful</div>
        <DropdownMenuItem danger onSelect={onKnockout}>
          <ZapOff size={14} /> Knockout
        </DropdownMenuItem>
        <DropdownMenuItem danger onSelect={onBreakLegs}>
          <Skull size={14} /> Break Legs
        </DropdownMenuItem>
        <DropdownMenuItem danger onSelect={onMakeSick}>
          <Pill size={14} /> Make Sick
        </DropdownMenuItem>
        <DropdownMenuItem danger onSelect={onLaunch}>
          <ArrowUpFromLine size={14} /> Launch
        </DropdownMenuItem>
        <DropdownMenuItem danger onSelect={onExplode}>
          <Bomb size={14} /> Explode
        </DropdownMenuItem>
        <DropdownMenuItem danger onSelect={onKill}>
          <Skull size={14} /> Kill
        </DropdownMenuItem>
        <DropdownMenuItem danger onSelect={onRespawn}>
          <Skull size={14} /> Force Respawn
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
