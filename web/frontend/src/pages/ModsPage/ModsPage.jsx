import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import API from '../../api';
import WorkshopItem from './WorkshopItem';
import SteamSettingsPanel from './SteamSettingsPanel';
import { Puzzle, Search, Flame, Settings, Package, Trash2, ChevronUp, ChevronDown, AlertTriangle, Download } from '../../components/Icon';

const formatSubs = (n) => {
  if (!n) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
};

export default function ModsPage({ serverId }) {
  const socket = useSocket();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [mods, setMods] = useState([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState('installed');
  const [popularMods, setPopularMods] = useState([]);
  const [loadingPopular, setLoadingPopular] = useState(false);
  const [installProgress, setInstallProgress] = useState({});
  const [pendingUpdates, setPendingUpdates] = useState({});
  const searchTimeout = useRef(null);

  useEffect(() => { API.get(`/api/servers/${serverId}/mods`).then(d => setMods(Array.isArray(d) ? d : [])); }, [serverId]);

  // Fetch pending mod updates
  useEffect(() => {
    API.get(`/api/servers/${serverId}/mods/updates`).then(d => setPendingUpdates(d || {})).catch(() => {});
  }, [serverId]);

  // Listen for real-time mod update events
  useEffect(() => {
    const handler = (data) => {
      if (data.serverId === serverId && data.workshopId) {
        setPendingUpdates(prev => ({ ...prev, [data.workshopId]: { name: data.mod, detectedAt: new Date().toISOString() } }));
      }
    };
    socket.on('modUpdate', handler);
    return () => socket.off('modUpdate', handler);
  }, [serverId, socket]);

  const pendingCount = Object.keys(pendingUpdates).length;
  const hasUpdate = (workshopId) => !!pendingUpdates[workshopId];

  useEffect(() => {
    const handler = (data) => { if (data.serverId === serverId) setMods(Array.isArray(data.mods) ? data.mods : []); };
    socket.on('mods', handler);
    return () => socket.off('mods', handler);
  }, [serverId, socket]);

  const handleSearch = (query) => {
    setSearch(query);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (query.trim().length < 2) { setResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await API.get('/api/workshop/search?q=' + encodeURIComponent(query.trim()));
        const items = Array.isArray(data && data.results) ? data.results : [];
        setResults(items);
      } catch (e) { console.error('[Workshop] search error:', e); window.addToast('Workshop search failed', 'error'); setResults([]); }
      setSearching(false);
    }, 400);
  };

  const doSearch = async () => {
    if (!search.trim() || search.trim().length < 2) return;
    setSearching(true);
    try {
      const data = await API.get('/api/workshop/search?q=' + encodeURIComponent(search.trim()));
      const items = Array.isArray(data && data.results) ? data.results : [];
      setResults(items);
    } catch (e) { console.error('[Workshop] doSearch error:', e); window.addToast('Workshop search failed', 'error'); setResults([]); }
    setSearching(false);
  };

  const loadPopular = async () => {
    if (popularMods.length > 0) return;
    setLoadingPopular(true);
    try {
      const data = await API.get('/api/workshop/popular');
      const items = Array.isArray(data && data.results) ? data.results : [];
      setPopularMods(items);
    } catch (e) { console.error('[Workshop] popular error:', e); window.addToast('Failed to load popular mods', 'error'); }
    setLoadingPopular(false);
  };

  const isInstalled = (wid) => mods.some(m => String(m.workshopId) === String(wid));
  const isInstalling = (wid) => { const p = installProgress[wid]; return p && ['starting', 'downloading', 'installing', 'downloaded'].includes(p.status); };

  const install = async (workshopId, name) => {
    if (isInstalled(workshopId) || isInstalling(workshopId)) return;
    setInstallProgress(prev => ({ ...prev, [workshopId]: { status: 'starting', progress: 0, message: 'Requesting download...' } }));
    try {
      await API.post(`/api/servers/${serverId}/mods/install`, { workshopId, name });
    } catch (err) {
      window.addToast(`Install failed: ${err.message}`, 'error');
      setInstallProgress(prev => ({ ...prev, [workshopId]: { status: 'error', progress: 0, message: err.message } }));
    }
  };

  const uninstall = async (workshopId) => {
    await API.del(`/api/servers/${serverId}/mods/uninstall/${workshopId}`);
    setMods(ms => ms.filter(m => m.workshopId !== workshopId));
    window.addToast('Mod uninstalled', 'success');
  };

  const toggleMod = async (workshopId, enabled) => {
    await API.patch(`/api/servers/${serverId}/mods/${workshopId}`, { enabled: !enabled });
    setMods(m => m.map(mod => mod.workshopId === workshopId ? { ...mod, enabled: !enabled } : mod));
  };

  // ─── Reorder handler ───────────────────────────────────────────────
  const moveMod = async (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= mods.length) return;
    const reordered = [...mods];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(newIndex, 0, moved);
    // Optimistic update
    setMods(reordered);
    try {
      await API.post(`/api/servers/${serverId}/mods/reorder`, {
        order: reordered.map(m => m.name),
      });
    } catch (err) {
      window.addToast('Reorder failed: ' + (err.message || 'Unknown error'), 'error');
      // Revert on failure
      API.get(`/api/servers/${serverId}/mods`).then(d => setMods(Array.isArray(d) ? d : []));
    }
  };

  // ─── Type change handler ───────────────────────────────────────────
  const changeModType = async (modName, newType) => {
    // Optimistic update
    setMods(prev => prev.map(m => m.name === modName ? { ...m, type: newType } : m));
    try {
      await API.patch(`/api/servers/${serverId}/mods/${encodeURIComponent(modName)}/type`, { type: newType });
    } catch (err) {
      window.addToast('Type change failed: ' + (err.message || 'Unknown error'), 'error');
      API.get(`/api/servers/${serverId}/mods`).then(d => setMods(Array.isArray(d) ? d : []));
    }
  };

  useEffect(() => {
    const handler = (data) => {
      if (data.serverId !== serverId) return;
      setInstallProgress(prev => ({ ...prev, [data.workshopId]: { status: data.status, progress: data.progress, message: data.message } }));
      if (data.status === 'complete') {
        API.get(`/api/servers/${serverId}/mods`).then(d => setMods(Array.isArray(d) ? d : []));
        window.addToast(data.message, 'success');
      } else if (data.status === 'error') {
        window.addToast(`Install failed: ${data.message}`, 'error');
      }
    };
    socket.on('modInstallProgress', handler);
    return () => socket.off('modInstallProgress', handler);
  }, [serverId, socket]);

  return (
    <div>
      <div className="tabs">
        <div className={`tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>
          <Puzzle size={14} /> Installed ({mods.length})
          {pendingCount > 0 && <span className="mod-update-count" title={`${pendingCount} mod update${pendingCount > 1 ? 's' : ''} available`}>{pendingCount}</span>}
        </div>
        <div className={`tab ${tab === 'workshop' ? 'active' : ''}`} onClick={() => setTab('workshop')}><Search size={14} /> Workshop</div>
        <div className={`tab ${tab === 'popular' ? 'active' : ''}`} onClick={() => { setTab('popular'); loadPopular(); }}><Flame size={14} /> Popular</div>
        {isAdmin && <div className={`tab ${tab === 'steam' ? 'active' : ''}`} onClick={() => setTab('steam')}><Settings size={14} /> Steam</div>}
      </div>

      {tab === 'installed' && (
        <div>
          {mods.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon empty-state-icon-large"><Package size={48} /></div>
              <div className="empty-title">No Mods Installed</div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 360, lineHeight: 1.5 }}>Install mods from the Steam Workshop to customize your server experience.</p>
              <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => setTab('workshop')}><Search size={14} /> Browse Workshop</button>
            </div>
          ) : (
            <div>
              {mods.map((mod, i) => (
                <div className="mod-item" key={mod.workshopId || mod.name}>
                  <span className="mod-order">#{i + 1}</span>
                  <div className="mod-reorder">
                    <button onClick={() => moveMod(i, -1)} disabled={i === 0} title="Move up">
                      <ChevronUp size={12} />
                    </button>
                    <button onClick={() => moveMod(i, 1)} disabled={i === mods.length - 1} title="Move down">
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <div className={`toggle ${mod.enabled ? 'on' : ''}`} onClick={() => toggleMod(mod.workshopId, mod.enabled)}><div className="toggle-knob" /></div>
                  <span className="mod-name" style={{ opacity: mod.enabled ? 1 : 0.4 }}>
                    {mod.name}
                    {hasUpdate(mod.workshopId) && (
                      <span className="mod-update-badge" title="Workshop update available">
                        <AlertTriangle size={11} /> Update
                      </span>
                    )}
                  </span>
                  <select
                    className="mod-type-select"
                    value={mod.type || 'client'}
                    onChange={(e) => changeModType(mod.name, e.target.value)}
                    title="Mod type: Client mods use -mod= (downloaded by players), Server mods use -serverMod= (server-only)"
                  >
                    <option value="client">Client</option>
                    <option value="server">Server</option>
                  </select>
                  <span className={`mod-type-badge ${mod.type || 'client'}`}>
                    {(mod.type || 'client') === 'server' ? 'Server' : 'Client'}
                  </span>
                  <a href={mod.workshopId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}` : '#'}
                    target="_blank" rel="noopener" className="mod-id" title="Open on Steam Workshop">
                    {mod.workshopId || 'local'}
                  </a>
                  <button className="btn btn-sm btn-danger" onClick={() => uninstall(mod.workshopId)} title="Uninstall"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'workshop' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 12 }}><Search size={16} /> Search Steam Workshop</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="workshop-search-box" style={{ flex: 1 }}>
                <span className="workshop-search-icon"><Search size={14} /></span>
                <input className="input" placeholder="Search DayZ mods on Steam Workshop..."
                  value={search} onChange={e => handleSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()} style={{ paddingLeft: 36 }} autoFocus />
              </div>
              <button className="btn btn-blue" onClick={doSearch} disabled={searching}>{searching ? 'Searching...' : 'Search'}</button>
            </div>
          </div>
          {searching && <div className="workshop-loading">Searching Steam Workshop...</div>}
          {!searching && results.length > 0 && (
            <div className="workshop-results">
              {results.map(r => <WorkshopItem key={r.workshopId} item={r} isInstalled={isInstalled} isInstalling={isInstalling} installProgress={installProgress} onInstall={install} formatSubs={formatSubs} />)}
            </div>
          )}
          {!searching && search.length >= 2 && results.length === 0 && (
            <div className="workshop-loading">No mods found for "{search}"</div>
          )}
          {!searching && search.length < 2 && results.length === 0 && (
            <div className="workshop-loading">Type at least 2 characters to search</div>
          )}
        </div>
      )}

      {tab === 'popular' && (
        <div>
          <div className="card-title" style={{ marginBottom: 12 }}><Flame size={16} /> Popular DayZ Mods</div>
          {loadingPopular && <div className="workshop-loading">Loading popular mods...</div>}
          {!loadingPopular && popularMods.length > 0 && (
            <div className="workshop-results">
              {popularMods.map(r => <WorkshopItem key={r.workshopId} item={r} isInstalled={isInstalled} isInstalling={isInstalling} installProgress={installProgress} onInstall={install} formatSubs={formatSubs} />)}
            </div>
          )}
          {!loadingPopular && popularMods.length === 0 && (
            <div className="workshop-loading">No popular mods available</div>
          )}
        </div>
      )}

      {tab === 'steam' && <SteamSettingsPanel />}
    </div>
  );
}
