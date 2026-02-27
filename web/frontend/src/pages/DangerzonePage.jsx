import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import { useServers } from '../contexts/ServersContext';
import API from '../api';
import Accordion from '../components/Accordion';
import { Modal } from '../components/ui';
import {
  AlertTriangle, RefreshCw, Users, Flame, Trash2, HardDrive,
  Copy, Download, Check, Loader, X, Info, Shield,
} from '../components/Icon';

// ─── Severity config ────────────────────────────────────────
const SEVERITY = {
  warning: { color: 'var(--accent-yellow)', label: 'Warning' },
  danger: { color: 'var(--accent-red)', label: 'Danger' },
  critical: { color: '#ff4466', label: 'Critical' },
};

const PRESET_ICONS = {
  RefreshCw: <RefreshCw size={18} />,
  Users: <Users size={18} />,
  Flame: <Flame size={18} />,
};

// ─── Main Page ──────────────────────────────────────────────
export default function DangerzonePage({ serverId }) {
  const socket = useSocket();
  const navigate = useNavigate();
  const { servers } = useServers();
  const currentServer = servers.find(s => s.id === serverId);

  // Wipe state
  const [presets, setPresets] = useState([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [wipeModal, setWipeModal] = useState(null);

  // Logs state
  const [logsScan, setLogsScan] = useState(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [selectedLogCategories, setSelectedLogCategories] = useState([]);
  const [clearingLogs, setClearingLogs] = useState(false);

  // Replicate state
  const [sourceServerId, setSourceServerId] = useState('');
  const [replicateComponents, setReplicateComponents] = useState(['config', 'mpmissions', 'mods']);
  const [replicatePreview, setReplicatePreview] = useState(null);
  const [replicateModal, setReplicateModal] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Rebuild state
  const [rebuildModal, setRebuildModal] = useState(false);

  // Delete state
  const [deleteModal, setDeleteModal] = useState(false);

  // Progress
  const [progress, setProgress] = useState(null);
  const [operating, setOperating] = useState(false);

  // ─── Load data ──────────────────────────────────────────
  const loadPresets = useCallback(async () => {
    setPresetsLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/dangerzone/wipe-presets`);
      if (data && data.presets) setPresets(data.presets);
    } catch { /* skip */ }
    setPresetsLoading(false);
  }, [serverId]);

  const loadLogsScan = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/dangerzone/logs-scan`);
      if (data && data.categories) {
        setLogsScan(data);
        setSelectedLogCategories(data.categories.filter(c => c.fileCount > 0).map(c => c.id));
      }
    } catch { /* skip */ }
    setLogsLoading(false);
  }, [serverId]);

  useEffect(() => {
    loadPresets();
    loadLogsScan();
  }, [loadPresets, loadLogsScan]);

  // ─── Socket.IO Progress ─────────────────────────────────
  useEffect(() => {
    const handler = (data) => {
      if (data.serverId !== serverId) return;
      setProgress(data);
      if (data.status === 'starting' || data.status === 'stopping' || data.status === 'backing-up' ||
          data.status === 'wiping' || data.status === 'replicating') {
        setOperating(true);
      }
      if (data.status === 'complete' || data.status === 'error') {
        setOperating(false);
        // Refresh data after operation
        setTimeout(() => { loadPresets(); loadLogsScan(); }, 1000);
      }
    };
    socket.on('dangerzoneProgress', handler);
    return () => socket.off('dangerzoneProgress', handler);
  }, [serverId, socket, loadPresets, loadLogsScan]);

  // ─── Wipe handler ───────────────────────────────────────
  const handleWipe = async (presetId, confirmText) => {
    if (!currentServer || confirmText !== currentServer.name) return;
    setWipeModal(null);
    try {
      const resp = await API.post(`/api/servers/${serverId}/dangerzone/wipe`, {
        preset: presetId,
        confirmName: confirmText,
      });
      if (resp.error) throw new Error(resp.error);
      window.addToast(resp.message || 'Wipe initiated', 'info');
    } catch (err) {
      window.addToast(err.message || 'Wipe failed', 'error');
    }
  };

  // ─── Clear logs handler ─────────────────────────────────
  const handleClearLogs = async () => {
    if (selectedLogCategories.length === 0) return;
    setClearingLogs(true);
    try {
      const resp = await API.post(`/api/servers/${serverId}/dangerzone/clear-logs`, {
        categories: selectedLogCategories,
      });
      if (resp.error) throw new Error(resp.error);
      window.addToast(`${resp.message} (${resp.freedFormatted} freed)`, 'success');
      await loadLogsScan();
    } catch (err) {
      window.addToast(err.message || 'Failed to clear logs', 'error');
    }
    setClearingLogs(false);
  };

  // ─── Replicate preview ─────────────────────────────────
  const handlePreview = async () => {
    if (!sourceServerId || replicateComponents.length === 0) return;
    setPreviewLoading(true);
    try {
      const data = await API.post(`/api/servers/${serverId}/dangerzone/replicate-preview`, {
        sourceServerId,
        components: replicateComponents,
      });
      if (data.error) throw new Error(data.error);
      setReplicatePreview(data);
      setReplicateModal(true);
    } catch (err) {
      window.addToast(err.message || 'Preview failed', 'error');
    }
    setPreviewLoading(false);
  };

  // ─── Replicate handler ─────────────────────────────────
  const handleReplicate = async (confirmText) => {
    if (!currentServer || confirmText !== currentServer.name) return;
    setReplicateModal(false);
    setReplicatePreview(null);
    try {
      const resp = await API.post(`/api/servers/${serverId}/dangerzone/replicate`, {
        sourceServerId,
        components: replicateComponents,
        confirmName: confirmText,
      });
      if (resp.error) throw new Error(resp.error);
      window.addToast(resp.message || 'Replication initiated', 'info');
    } catch (err) {
      window.addToast(err.message || 'Replication failed', 'error');
    }
  };

  // ─── Rebuild handler ────────────────────────────────────
  const handleRebuild = async (confirmText) => {
    if (!currentServer || confirmText !== currentServer.name) return;
    setRebuildModal(false);
    try {
      window.addToast('Rebuild initiated', 'info');
      const resp = await API.post(`/api/servers/${serverId}/rebuild`);
      if (resp.error) throw new Error(resp.error);
      window.addToast(resp.message || 'Rebuild complete!', 'success');
    } catch (err) {
      window.addToast(err.message || 'Rebuild failed', 'error');
    }
  };

  // ─── Delete handler ─────────────────────────────────────
  const handleDelete = async (confirmText) => {
    if (!currentServer || confirmText !== currentServer.name) return;
    setDeleteModal(false);
    try {
      await API.del('/api/servers/' + serverId);
      window.addToast('Server removed from panel', 'success');
      navigate('/');
    } catch (err) {
      window.addToast(err.message || 'Delete failed', 'error');
    }
  };

  const toggleLogCategory = (id) => {
    setSelectedLogCategories(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const toggleComponent = (id) => {
    setReplicateComponents(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const otherServers = servers.filter(s => s.id !== serverId);

  const selectedLogsSize = logsScan
    ? logsScan.categories
        .filter(c => selectedLogCategories.includes(c.id))
        .reduce((sum, c) => sum + c.sizeBytes, 0)
    : 0;

  return (
    <div style={{ maxWidth: 760 }}>
      {/* Warning Banner */}
      <div className="dz-warning-banner">
        <AlertTriangle size={16} />
        <div>
          <strong>Dangerous Operations</strong>
          <span>These maintenance operations can permanently modify or remove server data. Always ensure you have recent backups before proceeding.</span>
        </div>
      </div>

      {/* Progress Banner */}
      {progress && (progress.status !== 'complete' && progress.status !== 'error' ? true : Date.now() - (progress._ts || 0) < 8000) && (
        <ProgressBanner progress={progress} onDismiss={() => setProgress(null)} />
      )}

      {/* ─── Server Wipe ──────────────────────────────────── */}
      <Accordion title="Server Wipe" icon="" danger={true} defaultOpen={true}>
        <div className="dz-section-desc">
          Select a wipe preset below. A backup is automatically created before any wipe operation, and the server will be stopped if running.
        </div>
        {presetsLoading ? (
          <div className="dz-loading"><Loader size={16} className="spin" /> Loading presets...</div>
        ) : presets.length === 0 ? (
          <div className="dz-empty">No wipe presets available. The server installation directory may not contain the expected DayZ file structure.</div>
        ) : (
          <div className="dz-preset-list">
            {presets.map(preset => (
              <div key={preset.id} className={`dz-preset-card dz-severity-${preset.severity}`}>
                <div className="dz-preset-icon" style={{ color: SEVERITY[preset.severity]?.color }}>
                  {PRESET_ICONS[preset.icon] || <AlertTriangle size={18} />}
                </div>
                <div className="dz-preset-info">
                  <div className="dz-preset-name">{preset.name}</div>
                  <div className="dz-preset-desc">{preset.description}</div>
                  {preset.severity === 'critical' && (
                    <div className="dz-preset-critical-tag">
                      <AlertTriangle size={12} /> This cannot be undone
                    </div>
                  )}
                </div>
                <div className="dz-preset-meta">
                  <div className="dz-preset-size">
                    <HardDrive size={12} /> {preset.sizeFormatted}
                  </div>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={!preset.available || operating}
                    onClick={() => setWipeModal(preset)}
                  >
                    Wipe
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Accordion>

      {/* ─── Server Replicate ─────────────────────────────── */}
      <Accordion title="Replicate Server" icon="">
        <div className="dz-section-desc">
          Copy a validated build/configuration from another server to this one. The target server will be backed up before any changes are applied.
        </div>
        {otherServers.length === 0 ? (
          <div className="dz-empty">
            <Info size={14} /> You need at least two servers configured to use replication. Add another server first.
          </div>
        ) : (
          <>
            <div className="dz-replicate-form">
              <div className="settings-row">
                <span className="settings-row-label">Source Server</span>
                <div className="settings-row-value">
                  <select
                    className="input"
                    value={sourceServerId}
                    onChange={e => { setSourceServerId(e.target.value); setReplicatePreview(null); }}
                  >
                    <option value="">Select a server...</option>
                    {otherServers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="settings-row-label" style={{ marginBottom: 8 }}>Components to Copy</div>
                <div className="dz-component-grid">
                  {[
                    { id: 'config', label: 'Server Config', desc: 'serverDZ.cfg (hostname preserved)' },
                    { id: 'mpmissions', label: 'Mission Files', desc: 'CE XMLs, types.xml, events (excludes persistence)' },
                    { id: 'mods', label: 'Mods & Keys', desc: 'All @-prefixed mod directories + .bikey files' },
                    { id: 'profiles', label: 'Profiles', desc: 'BattlEye config, ban lists (excludes logs)' },
                  ].map(comp => (
                    <label key={comp.id} className={`dz-component-item ${replicateComponents.includes(comp.id) ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={replicateComponents.includes(comp.id)}
                        onChange={() => toggleComponent(comp.id)}
                      />
                      <div>
                        <div className="dz-component-label">{comp.label}</div>
                        <div className="dz-component-desc">{comp.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!sourceServerId || replicateComponents.length === 0 || previewLoading || operating}
                  onClick={handlePreview}
                >
                  {previewLoading ? <><Loader size={14} className="spin" /> Analyzing...</> : <><Copy size={14} /> Preview Changes</>}
                </button>
              </div>
            </div>
          </>
        )}
      </Accordion>

      {/* ─── Clear Log Storage ────────────────────────────── */}
      <Accordion title="Clear Log Storage" icon="">
        <div className="dz-section-desc">
          Scan and remove server log files to free up disk space. Active log files (currently in use) may be skipped.
        </div>
        {logsLoading ? (
          <div className="dz-loading"><Loader size={16} className="spin" /> Scanning logs...</div>
        ) : !logsScan || logsScan.categories.every(c => c.fileCount === 0) ? (
          <div className="dz-empty">No log files found.</div>
        ) : (
          <>
            <div className="dz-log-list">
              {logsScan.categories.map(cat => (
                <label key={cat.id} className={`dz-log-row ${cat.fileCount === 0 ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedLogCategories.includes(cat.id)}
                    onChange={() => toggleLogCategory(cat.id)}
                    disabled={cat.fileCount === 0}
                  />
                  <span className="dz-log-name">{cat.name}</span>
                  <span className="dz-log-count">{cat.fileCount} file{cat.fileCount !== 1 ? 's' : ''}</span>
                  <span className="dz-log-size">{cat.sizeFormatted}</span>
                </label>
              ))}
            </div>
            <div className="dz-log-footer">
              <span className="dz-log-total">
                Selected: {formatSize(selectedLogsSize)}
              </span>
              <button
                className="btn btn-danger btn-sm"
                disabled={selectedLogCategories.length === 0 || clearingLogs || operating}
                onClick={handleClearLogs}
              >
                {clearingLogs ? <><Loader size={14} className="spin" /> Clearing...</> : <><Trash2 size={14} /> Clear Selected</>}
              </button>
            </div>
          </>
        )}
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={loadLogsScan} disabled={logsLoading}>
            <RefreshCw size={14} /> Rescan
          </button>
        </div>
      </Accordion>

      {/* ─── Rebuild Server ───────────────────────────────── */}
      <Accordion title="Wipe & Reinstall" icon="" danger={true}>
        <div className="dz-section-desc">
          Completely rebuild the server installation from scratch. This will remove all server files (except backups) and reinstall them via SteamCMD.
        </div>
        <div className="dz-warning-box">
          <AlertTriangle size={14} />
          <span>WARNING: This operation will completely remove and reinstall the server. All custom configurations and data may be lost.</span>
        </div>
        <button
          className="btn btn-danger btn-sm"
          style={{ marginTop: 12 }}
          disabled={operating}
          onClick={() => setRebuildModal(true)}
        >
          <Shield size={14} /> Rebuild Server
        </button>
      </Accordion>

      {/* ─── Delete Server ────────────────────────────────── */}
      <Accordion title="Delete Server" icon="" danger={true}>
        <div className="dz-section-desc">
          Remove this server from the panel. This does not delete server files on disk — only removes it from management.
        </div>
        <button
          className="btn btn-danger btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => setDeleteModal(true)}
        >
          <Trash2 size={14} /> Delete Server
        </button>
      </Accordion>

      {/* ─── Modals ───────────────────────────────────────── */}

      {/* Wipe Confirmation */}
      {wipeModal && (
        <ConfirmModal
          open={!!wipeModal}
          onClose={() => setWipeModal(null)}
          title={`Confirm: ${wipeModal.name}`}
          description={wipeModal.description}
          severity={wipeModal.severity}
          warnings={[
            'A backup will be created automatically before wiping.',
            'The server will be stopped if currently running.',
            wipeModal.severity === 'critical' ? 'This will delete ALL persistence data. This cannot be undone.' : null,
          ].filter(Boolean)}
          serverName={currentServer?.name || ''}
          confirmLabel={`Wipe ${wipeModal.name.split(' ')[0]}`}
          onConfirm={(text) => handleWipe(wipeModal.id, text)}
        />
      )}

      {/* Replicate Confirmation */}
      {replicateModal && replicatePreview && (
        <ReplicateConfirmModal
          open={replicateModal}
          onClose={() => setReplicateModal(false)}
          preview={replicatePreview}
          serverName={currentServer?.name || ''}
          onConfirm={handleReplicate}
        />
      )}

      {/* Rebuild Confirmation */}
      <ConfirmModal
        open={rebuildModal}
        onClose={() => setRebuildModal(false)}
        title="Confirm: Wipe & Reinstall"
        description="This will delete all server files (except backups) and completely reinstall via SteamCMD. This may take several minutes."
        severity="critical"
        warnings={[
          'All server files will be deleted and re-downloaded.',
          'Custom configurations and mods will be lost.',
          'The server will be stopped if currently running.',
        ]}
        serverName={currentServer?.name || ''}
        confirmLabel="Rebuild Server"
        onConfirm={handleRebuild}
      />

      {/* Delete Confirmation */}
      <ConfirmModal
        open={deleteModal}
        onClose={() => setDeleteModal(false)}
        title="Confirm: Delete Server"
        description="Remove this server from the panel. Server files on disk will NOT be deleted."
        severity="danger"
        warnings={[
          'The server will no longer appear in the panel.',
          'Server files remain on disk and can be re-added later.',
        ]}
        serverName={currentServer?.name || ''}
        confirmLabel="Delete Server"
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ─── Progress Banner Component ──────────────────────────────
function ProgressBanner({ progress, onDismiss }) {
  const isActive = ['starting', 'stopping', 'backing-up', 'backed-up', 'backup-warning', 'wiping', 'replicating', 'downloading'].includes(progress.status);
  const isComplete = progress.status === 'complete';
  const isError = progress.status === 'error';

  return (
    <div className={`dz-progress-banner ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''} ${isError ? 'error' : ''}`}>
      <div className="dz-progress-content">
        {isActive && <Loader size={16} className="spin" />}
        {isComplete && <Check size={16} />}
        {isError && <X size={16} />}
        <span>{progress.message}</span>
      </div>
      {(isComplete || isError) && (
        <button className="dz-progress-dismiss" onClick={onDismiss}><X size={14} /></button>
      )}
    </div>
  );
}

// ─── Type-to-Confirm Modal ──────────────────────────────────
function ConfirmModal({ open, onClose, title, description, severity, warnings, serverName, confirmLabel, onConfirm }) {
  const [confirmText, setConfirmText] = useState('');
  const isMatch = confirmText === serverName;

  // Reset on open/close
  useEffect(() => { if (open) setConfirmText(''); }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="dz-confirm-modal">
        <p className="dz-confirm-desc">{description}</p>

        {warnings && warnings.length > 0 && (
          <div className={`dz-confirm-warnings dz-severity-${severity}`}>
            {warnings.map((w, i) => (
              <div key={i} className="dz-confirm-warning-item">
                <Info size={13} /> <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="dz-confirm-input-section">
          <label className="dz-confirm-label">
            Type <strong>{serverName}</strong> to confirm:
          </label>
          <input
            className={`input dz-confirm-input ${confirmText && (isMatch ? 'matched' : 'mismatched')}`}
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder={serverName}
            autoFocus
          />
        </div>

        <div className="dz-confirm-actions">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-danger btn-sm"
            disabled={!isMatch}
            onClick={() => onConfirm(confirmText)}
          >
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Replicate Confirm Modal ────────────────────────────────
function ReplicateConfirmModal({ open, onClose, preview, serverName, onConfirm }) {
  const [confirmText, setConfirmText] = useState('');
  const isMatch = confirmText === serverName;

  useEffect(() => { if (open) setConfirmText(''); }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Confirm: Replicate Server" large>
      <div className="dz-confirm-modal">
        <div className="dz-replicate-summary">
          <div className="dz-replicate-flow">
            <span className="dz-replicate-server source">{preview.sourceServer.name}</span>
            <span className="dz-replicate-arrow">&rarr;</span>
            <span className="dz-replicate-server target">{preview.targetServer.name}</span>
          </div>
        </div>

        <div className="dz-replicate-components">
          {preview.components.map(comp => (
            <div key={comp.id} className={`dz-replicate-comp-row ${comp.willOverwrite ? 'overwrite' : ''}`}>
              <div className="dz-replicate-comp-name">
                {comp.sourceExists ? <Check size={14} style={{ color: 'var(--accent-green)' }} /> : <X size={14} style={{ color: 'var(--text-muted)' }} />}
                {comp.name}
              </div>
              <div className="dz-replicate-comp-detail">{comp.details}</div>
              <div className="dz-replicate-comp-size">{comp.sizeFormatted}</div>
              {comp.willOverwrite && <span className="dz-overwrite-badge">Overwrite</span>}
            </div>
          ))}
        </div>

        <div className="dz-replicate-total">
          Total: {preview.totalSizeFormatted}
        </div>

        <div className="dz-confirm-warnings dz-severity-warning">
          <div className="dz-confirm-warning-item"><Info size={13} /> A backup of the target server will be created first.</div>
          <div className="dz-confirm-warning-item"><Info size={13} /> The target server will be stopped if running.</div>
        </div>

        <div className="dz-confirm-input-section">
          <label className="dz-confirm-label">
            Type <strong>{serverName}</strong> to confirm:
          </label>
          <input
            className={`input dz-confirm-input ${confirmText && (isMatch ? 'matched' : 'mismatched')}`}
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder={serverName}
            autoFocus
          />
        </div>

        <div className="dz-confirm-actions">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!isMatch}
            onClick={() => onConfirm(confirmText)}
          >
            <Copy size={14} /> Replicate
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Helpers ────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
