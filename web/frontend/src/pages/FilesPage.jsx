import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import { Folder, FolderOpen, FileCode, FileCog, FileJson, FileText, Zap, Globe, File, Save, RefreshCw, ChevronDown, ChevronRight, Loader } from '../components/Icon';

export default function FilesPage({ serverId }) {
  const socket = useSocket();

  // Tree state: { [dirPath]: entries[] }
  const [tree, setTree] = useState({});
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [loadingDirs, setLoadingDirs] = useState(new Set());

  // Tabs & editor
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [monacoLoaded, setMonacoLoaded] = useState(!!window.monaco);
  const [searchTerm, setSearchTerm] = useState('');
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

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

  const formatSize = (bytes) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

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

  // -- Load Monaco editor --
  useEffect(() => {
    if (window.monaco) { setMonacoLoaded(true); return; }
    const checkMonaco = setInterval(() => {
      if (window.monaco) { setMonacoLoaded(true); clearInterval(checkMonaco); }
    }, 200);
    return () => clearInterval(checkMonaco);
  }, []);

  // -- Configure Monaco theme --
  useEffect(() => {
    if (!monacoLoaded) return;
    monaco.editor.defineTheme('dayz-dark', {
      base: 'vs-dark', inherit: true, rules: [],
      colors: {
        'editor.background': '#1b1e24',
        'editor.lineHighlightBackground': '#252830',
        'editorLineNumber.foreground': '#5a6170',
        'editorLineNumber.activeForeground': '#c6c6c6',
      }
    });
    monaco.editor.setTheme('dayz-dark');
  }, [monacoLoaded]);

  // -- Monaco editor lifecycle --
  useEffect(() => {
    if (!monacoLoaded || !containerRef.current) return;
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
  }, [monacoLoaded, activeTab, tabs.length]);

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
            <button className="btn btn-ghost btn-sm" onClick={refreshTree} title="Refresh" style={{ padding: '2px 6px', fontSize: 12 }}><RefreshCw size={14} /></button>
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
