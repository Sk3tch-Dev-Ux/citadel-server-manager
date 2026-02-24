import { formatUptime } from '../utils';
import { Server } from '../components/Icon';

export default function ServerHubPage({ servers, onSelect }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><div className="main-title">Server Hub</div><div className="main-subtitle">{servers.length} server instance{servers.length !== 1 ? 's' : ''} configured</div></div>
      </div>
      <div className="stat-row">
        <div className="stat-box"><div className="stat-label">Total Servers</div><div className="stat-value">{servers.length}</div></div>
        <div className="stat-box"><div className="stat-label">Running</div><div className="stat-value" style={{ color: 'var(--accent-blue)' }}>{servers.filter(s => s.status === 'running').length}</div></div>
        <div className="stat-box"><div className="stat-label">Total Players</div><div className="stat-value" style={{ color: 'var(--accent-blue)' }}>{servers.reduce((a, s) => a + (s.playerCount || 0), 0)}</div></div>
        <div className="stat-box"><div className="stat-label">Avg CPU</div><div className="stat-value">{servers.length ? (servers.reduce((a, s) => a + (s.cpu || 0), 0) / servers.length).toFixed(0) : 0}%</div></div>
      </div>
      {servers.length === 0 ? (
        <div className="empty-state"><div className="empty-icon"><Server size={48} /></div><div className="empty-title">No Servers</div><p>Deploy your first DayZ server to get started.</p></div>
      ) : (
        <div className="grid grid-3">
          {servers.map(srv => (
            <div key={srv.id} className={`server-card ${srv.status}`} onClick={() => onSelect(srv.id)}>
              <div className="server-card-header">
                <div>
                  <div className="server-card-name">{srv.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{srv.gameTitle || 'DayZ, PC'}</div>
                </div>
                <span className={`status-badge status-${srv.status || 'stopped'}`}><span className="status-dot" />{srv.status || 'stopped'}</span>
              </div>
              <div className="server-card-stats">
                <div className="server-card-stat"><div className="server-card-stat-label">CPU</div><div className="server-card-stat-value">{(srv.cpu || 0).toFixed(0)}%</div></div>
                <div className="server-card-stat"><div className="server-card-stat-label">RAM</div><div className="server-card-stat-value">{(srv.ram || 0).toFixed(1)}%</div></div>
                <div className="server-card-stat"><div className="server-card-stat-label">Players</div><div className="server-card-stat-value">{srv.playerCount || 0}/{srv.maxPlayers || 60}</div></div>
                <div className="server-card-stat"><div className="server-card-stat-label">Uptime</div><div className="server-card-stat-value">{formatUptime(srv.uptime)}</div></div>
              </div>
              <div className="server-card-bar"><div className="server-card-bar-fill" style={{ width: `${Math.min(srv.cpu || 0, 100)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
