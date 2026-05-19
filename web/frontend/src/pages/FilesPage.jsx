import React, { useState, useEffect, useRef, useCallback } from 'react';
import API from '../api';
import { formatBytes } from '../utils';
import { Folder, FolderOpen, FileCode, FileCog, FileJson, FileText, Zap, Globe, File, Save, RefreshCw, ChevronDown, ChevronRight, Loader, Plus, X } from '../components/Icon';

// ─── Monaco — bundled locally (no CDN dependency) ────────────────────
//
// Previously loaded via AMD from cdnjs, which broke when corporate/home
// firewalls blocked cdnjs.cloudflare.com. This app is local-first — the
// editor has no business depending on the internet.
//
// The `?worker` imports are a Vite-native way to ship Monaco's web workers
// as bundled JS files. `self.MonacoEnvironment` tells Monaco where to find
// them (per-language workers + a generic fallback).
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Do this once — repeated assignment is harmless but noisy if lazy-loaded
// more than once. Guard with a truthy check on self.MonacoEnvironment.
if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === 'json') return new jsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };
}

// Define the Citadel dark theme once, module-scoped. Safe to call multiple
// times (Monaco dedupes) but this way it's a one-shot cost.
monaco.editor.defineTheme('dayz-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1b1e24',
    'editor.lineHighlightBackground': '#252830',
    'editorLineNumber.foreground': '#5a6170',
    'editorLineNumber.activeForeground': '#c6c6c6',
  },
});

export default function FilesPage({ serverId }) {

  // Tree state: { [dirPath]: entries[] }
  const [tree, setTree] = useState({});
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [loadingDirs, setLoadingDirs] = useState(new Set());

  // Tabs & editor
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // Template picker (Expansion docs sync). Opens a modal listing the 117
  // upstream JSON skeletons; choosing one creates the file at the path the
  // user specifies (defaults to a sensible Expansion location).
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const modelsRef = useRef({});
  const tabsRef = useRef(tabs);
  const activeTabRef = useRef(activeTab);
  tabsRef.current = tabs;
  activeTabRef.current = activeTab;

  // -- Helpers --
  const getLanguage = (filename) => {
    const ext = (filename || '').split('.').pop().toLowerCase();
    return { js: 'javascript', json: 'json', xml: 'xml', html: 'html', css: 'css',
      cfg: 'ini', ini: 'ini', bat: 'bat', cmd: 'bat', ps1: 'powershell',
      c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', py: 'python', sh: 'shell',
      md: 'markdown', txt: 'plaintext', log: 'plaintext', csv: 'plaintext',
      yaml: 'yaml', yml: 'yaml', sql: 'sql', types: 'xml' }[ext] || 'plaintext';
  };

  const getFileIcon = (filename, isDir, isExpanded) => {
    if (isDir) return isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />;
    const ext = (filename || '').split('.').pop().toLowerCase();
    const iconMap = {
      cfg: <FileCog size={14} />, xml: <FileCode size={14} />, json: <FileJson size={14} />,
      bat: <Zap size={14} />, cmd: <Zap size={14} />,
      c: <FileCode size={14} />, cpp: <FileCode size={14} />, h: <FileCode size={14} />, hpp: <FileCode size={14} />,
      log: <FileText size={14} />, txt: <FileText size={14} />,
      md: <FileText size={14} />, js: <FileCode size={14} />, py: <FileCode size={14} />,
      html: <Globe size={14} />, css: <FileCode size={14} />, ini: <FileCog size={14} />
    };
    return iconMap[ext] || <File size={14} />;
  };

  const formatSize = (bytes) => (!bytes || bytes <= 0) ? '' : formatBytes(bytes);

  // -- Directory loading with cache --
  const loadDir = useCallback(async (dirPath) => {
    setLoadingDirs(prev => new Set(prev).add(dirPath));
    try {
      const data = await API.get(`/api/servers/${serverId}/files?dir=${encodeURIComponent(dirPath)}`);
      setTree(prev => ({ ...prev, [dirPath]: Array.isArray(data) ? data : [] }));
      return data;
    } catch (err) {
      window.addToast(err.message, 'error');
      return [];
    } finally {
      setLoadingDirs(prev => { const s = new Set(prev); s.delete(dirPath); return s; });
    }
  }, [serverId]);

  const toggleDir = useCallback(async (dirPath) => {
    const newExp = new Set(expandedDirs);
    if (newExp.has(dirPath)) {
      newExp.delete(dirPath);
    } else {
      newExp.add(dirPath);
      if (!tree[dirPath]) await loadDir(dirPath);
    }
    setExpandedDirs(newExp);
  }, [expandedDirs, tree, loadDir]);

  const refreshTree = useCallback(() => {
    setTree({});
    loadDir('');
  }, [loadDir]);

  // -- Tab management --
  const openFile = useCallback(async (entry) => {
    if (tabs.find(t => t.path === entry.path)) {
      setActiveTab(entry.path);
      return;
    }
    try {
      const data = await API.get(`/api/servers/${serverId}/files/read?file=${encodeURIComponent(entry.path)}`);
      if (data.error) { window.addToast(data.error, 'error'); return; }
      const newTab = {
        path: entry.path,
        name: entry.name,
        content: data.content,
        originalContent: data.content,
        language: getLanguage(entry.name),
        size: data.size || 0,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTab(entry.path);
    } catch (err) {
      window.addToast(err.message, 'error');
    }
  }, [tabs, serverId]);

  const closeTab = useCallback((e, tabPath) => {
    e.stopPropagation();
    if (modelsRef.current[tabPath]) {
      modelsRef.current[tabPath].disposable.dispose();
      modelsRef.current[tabPath].model.dispose();
      delete modelsRef.current[tabPath];
    }
    setTabs(prev => {
      const newTabs = prev.filter(t => t.path !== tabPath);
      if (activeTabRef.current === tabPath) {
        const idx = prev.findIndex(t => t.path === tabPath);
        const next = newTabs[Math.min(idx, newTabs.length - 1)];
        setActiveTab(next ? next.path : null);
      }
      return newTabs;
    });
  }, []);

  const saveFile = useCallback(async () => {
    const currentPath = activeTabRef.current;
    const tab = tabsRef.current.find(t => t.path === currentPath);
    if (!tab) return;
    const content = editorRef.current ? editorRef.current.getValue() : tab.content;
    try {
      await API.put(`/api/servers/${serverId}/files/write`, { file: tab.path, content });
      setTabs(prev => prev.map(t => t.path === tab.path ? { ...t, content, originalContent: content } : t));
      if (modelsRef.current[tab.path]) {
        modelsRef.current[tab.path].savedContent = content;
      }
      window.addToast('File saved (backup created)', 'success');
    } catch (err) {
      window.addToast(err.message, 'error');
    }
  }, [serverId]);

  // -- Initialize --
  useEffect(() => {
    loadDir('');
    setExpandedDirs(new Set(['']));
  }, [loadDir]);

  // -- Monaco editor lifecycle --
  // Monaco is imported at module load (see top of file), so it's always
  // ready by the time this effect runs. No more polling, no more load
  // failure — the editor is part of the bundle.
  useEffect(() => {
    if (!containerRef.current) return;
    const tab = tabs.find(t => t.path === activeTab);
    if (!tab) {
      if (editorRef.current) editorRef.current.setModel(null);
      return;
    }
    if (!editorRef.current) {
      editorRef.current = monaco.editor.create(containerRef.current, {
        theme: 'dayz-dark', automaticLayout: true,
        minimap: { enabled: true, scale: 1 }, fontSize: 14,
        fontFamily: "'JetBrains Mono', monospace", fontLigatures: true,
        lineNumbers: 'on', renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true }, smoothScrolling: true,
        cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
        padding: { top: 8 }, scrollBeyondLastLine: false,
        wordWrap: 'off', tabSize: 2,
        suggest: { showWords: false }, quickSuggestions: false,
      });
      editorRef.current.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => saveFile()
      );
      editorRef.current.onDidChangeCursorPosition((e) => {
        setCursorPos({ line: e.position.lineNumber, col: e.position.column });
      });
    }
    const uri = monaco.Uri.parse('inmemory://model/' + tab.path);
    let model = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel(tab.content || '', tab.language, uri);
      const disposable = model.onDidChangeContent(() => {
        const val = model.getValue();
        setTabs(prev => prev.map(t => t.path === tab.path ? { ...t, content: val } : t));
      });
      modelsRef.current[tab.path] = { model, disposable, savedContent: tab.originalContent };
    }
    editorRef.current.setModel(model);
    editorRef.current.focus();
  }, [activeTab, tabs.length]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (editorRef.current) { editorRef.current.dispose(); editorRef.current = null; }
      Object.values(modelsRef.current).forEach(m => {
        m.disposable.dispose();
        m.model.dispose();
      });
      modelsRef.current = {};
    };
  }, []);

  // -- Render tree recursively --
  const renderTree = (dirPath, depth) => {
    const entries = tree[dirPath];
    if (!entries) return null;
    const filtered = searchTerm
      ? entries.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.type === 'directory')
      : entries;
    return filtered.map(entry => {
      const isDir = entry.type === 'directory';
      const isExp = expandedDirs.has(entry.path);
      const isActive = activeTab === entry.path;
      return (
        <React.Fragment key={entry.path}>
          <div
            className={`tree-node ${isActive ? 'selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => isDir ? toggleDir(entry.path) : openFile(entry)}
            title={isDir ? entry.path : `${entry.path} \u2014 ${formatSize(entry.size)}`}
          >
            <span className="tree-arrow">
              {isDir ? (loadingDirs.has(entry.path) ? <Loader size={12} /> : (isExp ? <ChevronDown size={12} /> : <ChevronRight size={12} />)) : '\u00A0'}
            </span>
            <span className="tree-icon">{getFileIcon(entry.name, isDir, isExp)}</span>
            <span className="tree-name">{entry.name}</span>
          </div>
          {isDir && isExp && renderTree(entry.path, depth + 1)}
        </React.Fragment>
      );
    });
  };

  const currentTab = tabs.find(t => t.path === activeTab);
  const breadcrumb = currentTab ? currentTab.path.split('/') : [];

  return (
    <div className="fade-in">
      <div className="file-explorer">
        {/* -- Sidebar -- */}
        <div className="file-sidebar">
          <div className="file-sidebar-header">
            <span>Explorer</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setTemplatePickerOpen(true)}
                title="New file from Expansion template"
                style={{ padding: '2px 6px', fontSize: 12 }}
              >
                <Plus size={14} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={refreshTree} title="Refresh" style={{ padding: '2px 6px', fontSize: 12 }}><RefreshCw size={14} /></button>
            </div>
          </div>
          <div className="file-search">
            <input type="text" placeholder="Filter files..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <div className="file-sidebar-tree">
            {renderTree('', 0)}
            {loadingDirs.has('') && <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12 }}>Loading file tree...</div>}
          </div>
        </div>

        {/* -- Editor Panel -- */}
        <div className="file-editor-panel">
          {tabs.length > 0 && (
            <div className="editor-tabs">
              {tabs.map(tab => (
                <div key={tab.path} className={`editor-tab ${activeTab === tab.path ? 'active' : ''}`} onClick={() => setActiveTab(tab.path)}>
                  <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center' }}>{getFileIcon(tab.name)}</span>
                  <span>{tab.name}</span>
                  {tab.content !== tab.originalContent && <span className="tab-dot"></span>}
                  <span className="tab-close" onClick={e => closeTab(e, tab.path)}>{'\u00D7'}</span>
                </div>
              ))}
            </div>
          )}

          {currentTab && (
            <div className="editor-breadcrumb">
              {breadcrumb.map((part, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="sep">{'\u203A'}</span>}
                  <span>{part}</span>
                </React.Fragment>
              ))}
            </div>
          )}

          <div className="editor-container" ref={containerRef} style={{ display: currentTab ? 'block' : 'none' }}></div>

          {currentTab && (
            <div className="editor-status-bar">
              <div className="status-left">
                <span>{currentTab.language.toUpperCase()}</span>
                <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
                {currentTab.content !== currentTab.originalContent && (
                  <span style={{ color: '#ffd700' }}>{'\u25CF'} Modified</span>
                )}
              </div>
              <div className="status-right">
                <span>{formatSize(currentTab.size) || ''}</span>
                <span style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={saveFile}><Save size={14} /> Save (Ctrl+S)</span>
              </div>
            </div>
          )}

          {!currentTab && (
            <div className="editor-empty">
              <div className="icon"><FileText size={48} /></div>
              <p>Select a file to edit</p>
              <div className="shortcuts">
                <span>Browse files in the explorer sidebar</span>
                <span>Use the filter to quickly find files</span>
                <span><kbd>Ctrl+S</kbd> to save changes</span>
                <span>Click <Plus size={12} /> in the explorer to create a file from a DayZ Expansion template</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {templatePickerOpen && (
        <TemplatePickerModal
          serverId={serverId}
          onClose={() => setTemplatePickerOpen(false)}
          onCreated={(path) => {
            setTemplatePickerOpen(false);
            refreshTree();
            window.addToast(`Created ${path}`, 'success');
            openFile({ path, name: path.split('/').pop() });
          }}
        />
      )}
    </div>
  );
}

// ─── Template picker modal ──────────────────────────────────────────
//
// Backed by /api/expansion-docs/templates (the 117 JSON skeletons synced from
// dayzexpansion.com via scripts/sync-expansion-docs/sync.js).
//
// Workflow:
//   1. Fetch the template index on mount.
//   2. User searches + picks a template (e.g. "HardlineSettings").
//   3. User confirms the target path (we pre-fill a sensible default).
//   4. POST the rendered template content to /api/servers/:id/files/write.
//
// Path safety is enforced server-side (SAFE_WRITE_EXTENSIONS whitelist,
// safePath jail). We keep the client-side defaults sensible but don't try to
// validate paths here — the server is the source of truth.

function defaultTargetPath(templateName) {
  if (/^(Map|BaseBuilding|Hardline|Market|SafeZone|Spawn|P2PMarket|PersonalStorage|AILocation|AIPatrol)Settings$/.test(templateName)) {
    return `mpmissions/<your-mission>/expansion/settings/${templateName}.json`;
  }
  if (/Settings$/.test(templateName)) {
    return `Profiles/ExpansionMod/Settings/${templateName}.json`;
  }
  if (/^Quest_/.test(templateName)) return `Profiles/ExpansionMod/Quests/Quests/${templateName}.json`;
  if (/^QuestNPC/.test(templateName)) return `Profiles/ExpansionMod/Quests/NPCs/${templateName}.json`;
  if (/^Objective_/.test(templateName)) return `Profiles/ExpansionMod/Quests/Objectives/${templateName}.json`;
  if (/Loadout$/.test(templateName)) return `Profiles/ExpansionMod/Loadouts/${templateName}.json`;
  return `Profiles/ExpansionMod/Market/${templateName}.json`;
}

function TemplatePickerModal({ serverId, onClose, onCreated }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [targetPath, setTargetPath] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await API.get('/api/expansion-docs/templates');
        if (cancelled) return;
        setTemplates(Array.isArray(list) ? list : []);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Failed to load templates');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selected) setTargetPath(defaultTargetPath(selected.name));
    else setTargetPath('');
  }, [selected]);

  const filtered = search
    ? templates.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : templates;

  const trimmedPath = targetPath.trim();
  const hasPlaceholder = trimmedPath.includes('<');
  // Defense-in-depth UX mirror of the backend's safePath check. Server
  // enforces these too — this just lets the user see the error before
  // they click Create.
  const hasTraversal = /(^|[\\/])\.\.([\\/]|$)/.test(trimmedPath);
  const isAbsolute = /^([A-Za-z]:[\\/]|[\\/])/.test(trimmedPath);
  const pathError = hasTraversal
    ? 'Path cannot contain ".." segments.'
    : isAbsolute
      ? 'Use a relative path under the server install directory.'
      : null;
  const isValidPath = trimmedPath.length > 0 && !hasPlaceholder && !pathError;

  const handleCreate = async () => {
    if (!selected || !isValidPath) return;
    setCreating(true);
    try {
      const body = await API.get(`/api/expansion-docs/templates/${encodeURIComponent(selected.name)}`);
      const content = JSON.stringify(body, null, 2) + '\n';
      await API.put(`/api/servers/${serverId}/files/write`, { file: trimmedPath, content });
      onCreated(trimmedPath);
    } catch (err) {
      window.addToast(err.message || 'Failed to create file', 'error');
      setCreating(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card"
        style={{
          width: 'min(720px, 92vw)', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column', padding: 0,
        }}
      >
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontWeight: 600, flex: 1 }}>New file from DayZ Expansion template</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} title="Close"><X size={14} /></button>
        </div>

        <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
          <input
            className="input"
            placeholder={`Search ${templates.length || ''} templates...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', fontSize: 13 }}
          />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>}
          {error && <div style={{ padding: 24, textAlign: 'center', color: 'var(--accent-red, #e53e3e)' }}>{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
              No templates match &ldquo;{search}&rdquo;.
            </div>
          )}
          {!loading && !error && filtered.map(t => (
            <div
              key={t.name}
              onClick={() => setSelected(t)}
              style={{
                padding: '6px 10px', cursor: 'pointer', borderRadius: 4,
                background: selected?.name === t.name ? 'var(--bg-surface, var(--bg-deep))' : 'transparent',
                fontFamily: 'var(--font-mono, monospace)', fontSize: 12,
                borderLeft: selected?.name === t.name ? '2px solid var(--accent-blue)' : '2px solid transparent',
              }}
            >
              {t.name}
            </div>
          ))}
        </div>

        {selected && (
          <div style={{ padding: 12, borderTop: '1px solid var(--border)', background: 'var(--bg-surface, var(--bg-deep))' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Target path (relative to server install)
            </label>
            <input
              className="input"
              value={targetPath}
              onChange={e => setTargetPath(e.target.value)}
              style={{
                width: '100%',
                fontSize: 12,
                fontFamily: 'var(--font-mono, monospace)',
                borderColor: pathError ? 'var(--accent-red, #e5484d)' : undefined,
              }}
            />
            {pathError && (
              <div style={{ fontSize: 11, color: 'var(--accent-red, #e5484d)', marginTop: 4 }}>
                {pathError}
              </div>
            )}
            {!pathError && hasPlaceholder && (
              <div style={{ fontSize: 11, color: 'var(--accent-orange, #f59e0b)', marginTop: 4 }}>
                Replace the &lt;placeholder&gt; with your real mission name.
              </div>
            )}
          </div>
        )}

        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={creating}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={!selected || !isValidPath || creating}>
            {creating ? 'Creating...' : 'Create file'}
          </button>
        </div>
      </div>
    </div>
  );
}

