import { useNavigate } from 'react-router-dom';
import { useServers } from '../contexts/ServersContext';
import { formatUptime } from '../utils';
import { Server, Cpu, Users, Clock } from '../components/Icon';

export default function ServerHubPage() {
  const { servers } = useServers();
  const navigate = useNavigate();

  const onSelect = (id) => navigate(`/servers/${id}/overview`);
  const runningCount = servers.filter(s => s.status === 'running').length;
  const totalPlayers = servers.reduce((a, s) => a + (s.playerCount || 0), 0);

  return (
    <div>
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
          <p>Deploy your first DayZ server to get started.</p>
        </div>
      ) : (
        <div className="grid grid-3">
          {servers.map(srv => (
            <div key={srv.id} className={`server-card ${srv.status}`} onClick={() => onSelect(srv.id)}>
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
          ))}
        </div>
      )}
    </div>
  );
}
