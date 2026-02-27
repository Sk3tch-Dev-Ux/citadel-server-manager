import { useState, useEffect, useCallback } from 'react';
import API from '../api';
import { Modal } from './ui';
import { ChevronRight, Folder, FolderOpen, Search } from './Icon';

/**
 * Directory browser modal — lets users pick a folder from the server's installDir.
 * Reuses the existing GET /api/servers/:id/files?dir=X endpoint.
 */
export default function DirectoryBrowserModal({ open, onClose, serverId, onSelect }) {
  const [rootEntries, setRootEntries] = useState([]);
  const [expanded, setExpanded] = useState({});      // { path: entries[] }
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // Load root directory when modal opens
  useEffect(() => {
    if (!open || !serverId) return;
    setSelected('');
    setSearch('');
    setExpanded({});
    setLoading(true);
    API.get(`/api/servers/${serverId}/files?dir=.`).then(data => {
      const dirs = (Array.isArray(data) ? data : []).filter(e => e.type === 'directory');
      setRootEntries(dirs);
      setLoading(false);
    }).catch(() => {
      setRootEntries([]);
      setLoading(false);
    });
  }, [open, serverId]);

  const toggleExpand = useCallback(async (dirPath) => {
    if (expanded[dirPath]) {
      setExpanded(prev => {
        const next = { ...prev };
        delete next[dirPath];
        return next;
      });
    } else {
      try {
        const children = await API.get(`/api/servers/${serverId}/files?dir=${encodeURIComponent(dirPath)}`);
        const dirs = (Array.isArray(children) ? children : []).filter(e => e.type === 'directory');
        setExpanded(prev => ({ ...prev, [dirPath]: dirs }));
      } catch {
        setExpanded(prev => ({ ...prev, [dirPath]: [] }));
      }
    }
  }, [expanded, serverId]);

  const handleSelect = () => {
    if (selected) {
      onSelect(selected);
    }
  };

  const renderTree = (items, depth = 0) => {
    const filtered = search
      ? items.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
      : items;

    return filtered.map(e => {
      const isExpanded = !!expanded[e.path];
      const isSelected = selected === e.path;

      return (
        <div key={e.path}>
          <div
            className={`dir-tree-item${isSelected ? ' selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 20 }}
            onClick={() => setSelected(e.path)}
          >
            <span
              className={`dir-expand${isExpanded ? ' open' : ''}`}
              onClick={(ev) => { ev.stopPropagation(); toggleExpand(e.path); }}
            >
              <ChevronRight size={14} />
            </span>
            {isExpanded ? <FolderOpen size={14} style={{ color: 'var(--accent-orange)' }} /> : <Folder size={14} style={{ color: 'var(--accent-orange)' }} />}
            <span>{e.name}</span>
          </div>
          {isExpanded && expanded[e.path] && (
            <div className="dir-tree-children">
              {expanded[e.path].length > 0
                ? renderTree(expanded[e.path], depth + 1)
                : <div style={{ padding: '4px 8px 4px ' + (28 + depth * 20) + 'px', fontSize: 12, color: 'var(--text-muted)' }}>Empty</div>
              }
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Select Backup Directory" large>
      <div className="dir-browser-search">
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Search directories..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 32 }}
          />
        </div>
      </div>

      <div className="dir-browser-tree">
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
        ) : rootEntries.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No directories found</div>
        ) : (
          renderTree(rootEntries)
        )}
      </div>

      <div className="dir-browser-footer">
        <div className="dir-browser-selected">
          {selected || 'No directory selected'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSelect} disabled={!selected}>Select Directory</button>
        </div>
      </div>
    </Modal>
  );
}
