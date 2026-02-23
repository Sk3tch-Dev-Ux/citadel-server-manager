import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../../contexts/SocketContext';
import API from '../../api';
import WorkshopItem from './WorkshopItem';
import SteamSettingsPanel from './SteamSettingsPanel';

const formatSubs = (n) => {
  if (!n) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
};

export default function ModsPage({ serverId }) {
  const socket = useSocket();
  const [mods, setMods] = useState([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState('installed');
  const [popularMods, setPopularMods] = useState([]);
  const [loadingPopular, setLoadingPopular] = useState(false);
  const [installProgress, setInstallProgress] = useState({});
  const searchTimeout = useRef(null);

  useEffect(() => { API.get(`/api/servers/${serverId}/mods`).then(setMods); }, [serverId]);

  useEffect(() => {
    const handler = (data) => { if (data.serverId === serverId) setMods(data.mods); };
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

  useEffect(() => {
    const handler = (data) => {
      if (data.serverId !== serverId) return;
      setInstallProgress(prev => ({ ...prev, [data.workshopId]: { status: data.status, progress: data.progress, message: data.message } }));
      if (data.status === 'complete') {
        API.get(`/api/servers/${serverId}/mods`).then(setMods);
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
        <div className={`tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>{'\uD83E\uDDE9'} Installed ({mods.length})</div>
        <div className={`tab ${tab === 'workshop' ? 'active' : ''}`} onClick={() => setTab('workshop')}>{'\uD83D\uDD0D'} Workshop</div>
        <div className={`tab ${tab === 'popular' ? 'active' : ''}`} onClick={() => { setTab('popular'); loadPopular(); }}>{'\uD83D\uDD25'} Popular</div>
        <div className={`tab ${tab === 'steam' ? 'active' : ''}`} onClick={() => setTab('steam')}>{'\u2699\uFE0F'} Steam</div>
      </div>

      {tab === 'installed' && (
        <div>
          {mods.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">{'\uD83D\uDCE6'}</div>
              <div className="empty-title">No Mods Installed</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Search the Workshop tab to find and install mods</div>
            </div>
          ) : (
            <div>
              {mods.map((mod, i) => (
                <div className="mod-item" key={mod.workshopId || mod.name}>
                  <span className="mod-order">#{i + 1}</span>
                  <div className={`toggle ${mod.enabled ? 'on' : ''}`} onClick={() => toggleMod(mod.workshopId, mod.enabled)}><div className="toggle-knob" /></div>
                  <span className="mod-name" style={{ opacity: mod.enabled ? 1 : 0.4 }}>{mod.name}</span>
                  <a href={mod.workshopId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}` : '#'}
                    target="_blank" rel="noopener" className="mod-id" title="Open on Steam Workshop">
                    {mod.workshopId || 'local'}
                  </a>
                  <button className="btn btn-sm btn-danger" onClick={() => uninstall(mod.workshopId)} title="Uninstall">{'\uD83D\uDDD1'}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'workshop' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 12 }}>{'\uD83D\uDD0D'} Search Steam Workshop</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="workshop-search-box" style={{ flex: 1 }}>
                <span className="workshop-search-icon">{'\uD83D\uDD0E'}</span>
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
          <div className="card-title" style={{ marginBottom: 12 }}>{'\uD83D\uDD25'} Popular DayZ Mods</div>
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
