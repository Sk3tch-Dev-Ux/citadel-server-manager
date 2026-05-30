/**
 * useItemCatalog — fetch the server's item catalog ([{className, category}]) once
 * and share it across components/tabs via a module-level cache (the catalog is
 * large and identical per server, so refetching per tab is wasteful).
 */
import { useState, useEffect } from 'react';
import API from '../api';

const _cache = new Map();      // serverId -> items[]
const _inflight = new Map();   // serverId -> Promise

export default function useItemCatalog(serverId) {
  const [catalog, setCatalog] = useState(() => _cache.get(serverId) || []);

  useEffect(() => {
    if (!serverId) return;
    if (_cache.has(serverId)) { setCatalog(_cache.get(serverId)); return; }
    let cancelled = false;
    let p = _inflight.get(serverId);
    if (!p) {
      p = API.get(`/api/servers/${serverId}/items`)
        .then((items) => { const arr = Array.isArray(items) ? items : []; _cache.set(serverId, arr); return arr; })
        .catch(() => { const arr = []; _cache.set(serverId, arr); return arr; })
        .finally(() => _inflight.delete(serverId));
      _inflight.set(serverId, p);
    }
    p.then((arr) => { if (!cancelled) setCatalog(arr); });
    return () => { cancelled = true; };
  }, [serverId]);

  return catalog;
}
