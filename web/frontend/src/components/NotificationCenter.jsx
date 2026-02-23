import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import { timeAgo } from '../utils';

export default function NotificationCenter() {
  const socket = useSocket();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    API.get('/api/notifications').then(data => { if (Array.isArray(data)) setItems(data); });
  }, []);

  useEffect(() => {
    const handler = (n) => { setItems(prev => [n, ...prev].slice(0, 200)); };
    socket.on('notification', handler);
    return () => socket.off('notification', handler);
  }, [socket]);

  const unreadCount = items.filter(n => !n.read).length;

  const markAllRead = () => {
    API.patch('/api/notifications/read', {}).then(() => {
      setItems(prev => prev.map(n => ({ ...n, read: true })));
    });
  };

  const clearAll = () => {
    API.del('/api/notifications').then(() => setItems([]));
  };

  const markOneRead = (id) => {
    API.patch('/api/notifications/read', { ids: [id] }).then(() => {
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    });
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className="notif-bell" onClick={() => setOpen(!open)} title="Notifications">
        {'\uD83D\uDD14'}
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && <div className="notif-overlay" onClick={() => setOpen(false)} />}
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span className="notif-panel-title">
              Notifications {unreadCount > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>({unreadCount} unread)</span>}
            </span>
            <div className="notif-panel-actions">
              <button className="notif-panel-btn" onClick={markAllRead}>Mark all read</button>
              <button className="notif-panel-btn danger" onClick={clearAll}>Clear</button>
            </div>
          </div>
          <div className="notif-list">
            {items.length === 0 ? (
              <div className="notif-empty">
                <div className="notif-empty-icon">{'\uD83D\uDD14'}</div>
                <div>No notifications yet</div>
              </div>
            ) : items.map(n => (
              <div
                key={n.id}
                className={'notif-item' + (!n.read ? ' unread' : '') + (n.severity ? ' severity-' + n.severity : '')}
                onClick={() => { if (!n.read) markOneRead(n.id); }}
              >
                <div className="notif-item-icon">{n.icon || '\uD83D\uDD14'}</div>
                <div className="notif-item-body">
                  <div className="notif-item-title">{n.title}</div>
                  <div className="notif-item-msg">{n.message}</div>
                  <div className="notif-item-time">{timeAgo(n.timestamp)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
