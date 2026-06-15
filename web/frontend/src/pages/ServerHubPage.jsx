import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServers } from '../contexts/ServersContext';
import { formatUptime } from '../utils';
import { Server, Cpu, Users, Clock, Play, Square, RotateCcw, CheckCircle, XCircle, X, Rocket, ExternalLink } from '../components/Icon';
import { Button } from '../components/ui';
import API from '../api';

export default function ServerHubPage() {
  const { servers } = useServers();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResults, setBatchResults] = useState(null);

  const onSelect = (id) => navigate(`/servers/${id}/overview`);
  const runningCount = servers.filter(s => s.status === 'running').length;
  const totalPlayers = servers.reduce((a, s) => a + (s.playerCount || 0), 0);

  const toggleSelect = useCallback((e, id) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selected.size === servers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(servers.map(s => s.id)));
    }
  }, [servers, selected.size]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setBatchResults(null);
  }, []);

  const executeBatch = useCallback(async (action) => {
    if (selected.size === 0) return;
    setBatchLoading(true);
    setBatchResults(null);
    try {
      const data = await API.post('/api/servers/batch', { action, serverIds: Array.from(selected) });
      if (data && data.results) {
        setBatchResults(data.results);
        const successes = data.results.filter(r => r.success).length;
        const failures = data.results.filter(r => !r.success).length;
        if (failures === 0) {
          window.addToast(`Batch ${action}: ${successes} server(s) succeeded`, 'success');
        } else {
          window.addToast(`Batch ${action}: ${successes} succeeded, ${failures} failed`, 'error');
        }
      }
    } catch (err) {
      window.addToast(`Batch ${action} failed: ${err.message}`, 'error');
    }
    setBatchLoading(false);
  }, [selected]);

  const getResultForServer = (id) => batchResults?.find(r => r.id === id);

  return (
    <div>
      {/* Positioning hint — this page is the local Agent's server list, not
          a cross-machine fleet view. True multi-Agent fleet visibility lives
          in Citadel Cloud. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 12px',
        marginBottom: 12,
        fontSize: 12,
        color: 'var(--text-muted)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        flexWrap: 'wrap',
      }}>
        <span>Servers managed by this copy of Citadel Server Manager.</span>
        <a
          href="https://citadels.cc/cloud"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          Multi-machine fleet view in Citadel Cloud <ExternalLink size={11} />
        </a>
      </div>

      {/* Summary Stats */}
      <div className="stat-row">
        <div className="stat-box accent-blue">
          <div className="stat-label">Total Servers</div>
          <div className="stat-value">{servers.length}</div>
        </div>
        <div className="stat-box accent-green">
          <div className="stat-label">Running</div>
          <div className="stat-value" style={{ color: 'var(--accent-green)' }}>{runningCount}</div>
        </div>
        <div className="stat-box accent-purple">
          <div className="stat-label">Total Players</div>
          <div className="stat-value" style={{ color: 'var(--accent-purple)' }}>{totalPlayers}</div>
        </div>
        <div className="stat-box accent-orange">
          <div className="stat-label">Avg CPU</div>
          <div className="stat-value">{servers.length ? (servers.reduce((a, s) => a + (s.cpu || 0), 0) / servers.length).toFixed(0) : 0}%</div>
        </div>
      </div>

      {/* Server Cards */}
      {servers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Server size={48} /></div>
          <div className="empty-title">No Servers</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>Deploy your first DayZ server to get started.</p>
          <Button variant="primary" onClick={() => navigate('/deploy')}><Rocket size={14} /> Deploy Server</Button>
        </div>
      ) : (
        <>
          {/* Select All / Deselect All Toggle */}
          <div className="batch-select-bar">
            <button className="btn btn-sm btn-secondary" onClick={selectAll}>
              {selected.size === servers.length ? 'Deselect All' : 'Select All'}
            </button>
            {selected.size > 0 && (
              <span className="batch-select-count">{selected.size} server{selected.size !== 1 ? 's' : ''} selected</span>
            )}
          </div>

          <div className="grid grid-3">
            {servers.map(srv => {
              const isSelected = selected.has(srv.id);
              const result = getResultForServer(srv.id);
              return (
                <div key={srv.id} className={`server-card ${srv.status} ${isSelected ? 'server-card--selected' : ''}`} onClick={() => onSelect(srv.id)}>
                  {/* Checkbox */}
                  <div
                    className={`server-card-checkbox ${isSelected ? 'checked' : ''}`}
                    onClick={(e) => toggleSelect(e, srv.id)}
                    title={isSelected ? 'Deselect' : 'Select for batch action'}
                  >
                    {isSelected && <CheckCircle size={14} />}
                  </div>

                  {/* Batch result indicator */}
                  {result && (
                    <div className={`server-card-result ${result.success ? 'success' : 'error'}`}>
                      {result.success ? <CheckCircle size={12} /> : <XCircle size={12} />}
                      <span>{result.message || result.error}</span>
                    </div>
                  )}

                  <div className="server-card-header">
                    <div>
                      <div className="server-card-name">{srv.name}</div>
                      <div className="server-card-game">DayZ, PC</div>
                    </div>
                    <span className={`status-badge status-${srv.status || 'stopped'}`}><span className="status-dot" />{srv.status || 'stopped'}</span>
                  </div>
                  <div className="server-card-ports">
                    <span>{srv.gamePort || 2302}</span>
                    <span className="port-sep">/</span>
                    <span>{srv.queryPort || 2303}</span>
                    <span className="port-sep">/</span>
                    <span>{srv.rconPort || 2305}</span>
                  </div>
                  <div className="server-card-stats">
                    <div className="server-card-stat">
                      <Cpu size={12} />
                      <div className="server-card-stat-value">{(srv.cpu || 0).toFixed(0)}%</div>
                    </div>
                    <div className="server-card-stat">
                      <Users size={12} />
                      <div className="server-card-stat-value">{srv.playerCount || 0}/{srv.maxPlayers || 60}</div>
                    </div>
                    <div className="server-card-stat">
                      <Clock size={12} />
                      <div className="server-card-stat-value">{formatUptime(srv.uptime)}</div>
                    </div>
                  </div>
                  <div className="server-card-bar"><div className="server-card-bar-fill" style={{ width: `${Math.min(srv.cpu || 0, 100)}%` }} /></div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Floating Batch Action Bar */}
      {selected.size > 0 && (
        <div className="batch-action-bar">
          <div className="batch-action-bar-inner">
            <span className="batch-action-label">{selected.size} server{selected.size !== 1 ? 's' : ''} selected</span>
            <div className="batch-action-buttons">
              <button className="btn btn-primary btn-sm" onClick={() => executeBatch('start')} disabled={batchLoading}>
                <Play size={14} /> Start All
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => executeBatch('stop')} disabled={batchLoading}>
                <Square size={14} /> Stop All
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => executeBatch('restart')} disabled={batchLoading}>
                <RotateCcw size={14} /> Restart All
              </button>
              <button className="btn btn-sm" onClick={clearSelection} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <X size={14} /> Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
