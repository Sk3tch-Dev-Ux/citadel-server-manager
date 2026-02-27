import { useState, useEffect, useCallback } from 'react';
import API from '../api';
import { Modal, Toggle, EmptyState, Button, Input, FormField } from '../components/ui';
import { Send, Plus, Trash2, Edit, Check, X, Clock } from '../components/Icon';

function formatInterval(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDelay(seconds) {
  if (!seconds || seconds === 0) return 'Immediate';
  return `After ${formatInterval(seconds)}`;
}

// ─── Message Card ─────────────────────────────────────────
function MessageCard({ msg, onToggle, onEdit, onDelete }) {
  return (
    <div className={`messenger-card ${!msg.enabled ? 'messenger-card--disabled' : ''}`}>
      <div className="messenger-card-header">
        <div className="messenger-card-title-row">
          <span className={`scheduler-status-dot ${msg.enabled ? 'active' : ''}`} />
          <div className="messenger-card-text-preview">{msg.text}</div>
        </div>
        <div className="scheduler-card-actions">
          <button className="btn btn-icon btn-ghost" onClick={() => onEdit(msg)} title="Edit"><Edit size={14} /></button>
          <button className="btn btn-icon btn-ghost btn-danger-ghost" onClick={() => onDelete(msg)} title="Delete"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="messenger-card-meta">
        <span className="scheduler-meta-item" title="Broadcast interval">
          <Clock size={12} />
          Every {formatInterval(msg.intervalSeconds)}
        </span>
        <span className="scheduler-meta-item" title="Start delay after server boot">
          <Send size={12} />
          {formatDelay(msg.startDelaySeconds)}
        </span>
      </div>

      <div className="scheduler-card-footer">
        <span className="messenger-card-placeholders">
          Placeholders: <code>{'{server_name}'}</code> <code>{'{player_count}'}</code> <code>{'{max_players}'}</code>
        </span>
        <Toggle checked={msg.enabled} onCheckedChange={() => onToggle(msg)} />
      </div>
    </div>
  );
}

// ─── Create/Edit Modal ───────────────────────────────────
function MessageModal({ open, onClose, onSave, editingMsg }) {
  const isEdit = !!editingMsg;
  const [text, setText] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [startDelayMinutes, setStartDelayMinutes] = useState(0);

  useEffect(() => {
    if (editingMsg) {
      setText(editingMsg.text || '');
      setIntervalMinutes(Math.floor((editingMsg.intervalSeconds || 300) / 60));
      setStartDelayMinutes(Math.floor((editingMsg.startDelaySeconds || 0) / 60));
    } else {
      setText('');
      setIntervalMinutes(5);
      setStartDelayMinutes(0);
    }
  }, [editingMsg, open]);

  const handleSave = () => {
    if (!text.trim()) { window.addToast?.('Message text is required', 'error'); return; }
    if (intervalMinutes < 1) { window.addToast?.('Interval must be at least 1 minute', 'error'); return; }
    onSave({
      ...(editingMsg ? { id: editingMsg.id } : {}),
      text: text.trim(),
      intervalSeconds: intervalMinutes * 60,
      startDelaySeconds: startDelayMinutes * 60,
    });
  };

  return (
    <Modal open={open} onOpenChange={onClose} title={isEdit ? 'Edit Broadcast Message' : 'New Broadcast Message'}>
      <div className="scheduler-modal-form">
        <FormField label="Message Text">
          <textarea
            className="input messenger-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="e.g. Welcome to {server_name}! Current players: {player_count}/{max_players}"
            rows={3}
          />
          <span className="form-hint">
            Available placeholders: <code>{'{server_name}'}</code> <code>{'{player_count}'}</code> <code>{'{max_players}'}</code>
          </span>
        </FormField>

        <div className="scheduler-modal-row">
          <FormField label="Broadcast Interval (minutes)">
            <Input type="number" min={1} max={1440} value={intervalMinutes} onChange={e => setIntervalMinutes(parseInt(e.target.value, 10) || 5)} />
          </FormField>
          <FormField label="Start Delay (minutes after boot)">
            <Input type="number" min={0} max={1440} value={startDelayMinutes} onChange={e => setStartDelayMinutes(parseInt(e.target.value, 10) || 0)} />
          </FormField>
        </div>

        <div className="scheduler-modal-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>
            {isEdit ? <><Check size={14} /> Save Changes</> : <><Plus size={14} /> Create Message</>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────
export default function MessengerPage({ serverId }) {
  const [messenger, setMessenger] = useState({ enabled: true, messages: [] });
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMsg, setEditingMsg] = useState(null);

  const loadMessenger = useCallback(async () => {
    try {
      const data = await API.get(`/api/servers/${serverId}/messenger`);
      setMessenger({
        enabled: data?.enabled !== false,
        messages: Array.isArray(data?.messages) ? data.messages : [],
      });
    } catch {
      setMessenger({ enabled: true, messages: [] });
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadMessenger(); }, [loadMessenger]);

  const handleGlobalToggle = async () => {
    try {
      const data = await API.patch(`/api/servers/${serverId}/messenger/toggle`);
      setMessenger(prev => ({ ...prev, enabled: data.enabled }));
      window.addToast?.(`Messenger ${data.enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch { window.addToast?.('Failed to toggle messenger', 'error'); }
  };

  const handleToggle = async (msg) => {
    try {
      const updated = await API.patch(`/api/servers/${serverId}/messenger/${msg.id}/toggle`);
      setMessenger(prev => ({
        ...prev,
        messages: prev.messages.map(m => m.id === msg.id ? updated : m),
      }));
    } catch { window.addToast?.('Failed to toggle message', 'error'); }
  };

  const handleDelete = async (msg) => {
    if (!confirm('Delete this message?')) return;
    try {
      await API.del(`/api/servers/${serverId}/messenger/${msg.id}`);
      setMessenger(prev => ({
        ...prev,
        messages: prev.messages.filter(m => m.id !== msg.id),
      }));
      window.addToast?.('Message deleted', 'success');
    } catch { window.addToast?.('Failed to delete message', 'error'); }
  };

  const handleEdit = (msg) => {
    setEditingMsg(msg);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditingMsg(null);
    setModalOpen(true);
  };

  const handleSave = async (data) => {
    try {
      if (data.id) {
        const updated = await API.put(`/api/servers/${serverId}/messenger/${data.id}`, data);
        setMessenger(prev => ({
          ...prev,
          messages: prev.messages.map(m => m.id === data.id ? updated : m),
        }));
        window.addToast?.('Message updated', 'success');
      } else {
        const created = await API.post(`/api/servers/${serverId}/messenger`, data);
        setMessenger(prev => ({
          ...prev,
          messages: [...prev.messages, created],
        }));
        window.addToast?.('Message created', 'success');
      }
      setModalOpen(false);
      setEditingMsg(null);
    } catch { window.addToast?.('Failed to save message', 'error'); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading messenger...</div>;

  return (
    <div className="scheduler-page">
      <div className="scheduler-header">
        <div>
          <p className="scheduler-description">
            Automated RCON broadcast messages sent at regular intervals while the server is running.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="switch-row" style={{ margin: 0, padding: 0, border: 'none' }}>
            <span style={{ fontSize: 13, color: messenger.enabled ? 'var(--accent-green)' : 'var(--text-muted)' }}>
              {messenger.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <Toggle checked={messenger.enabled} onCheckedChange={handleGlobalToggle} />
          </div>
          <Button variant="primary" onClick={handleCreate}><Plus size={14} /> New Message</Button>
        </div>
      </div>

      {messenger.messages.length === 0 ? (
        <EmptyState icon={<Send size={48} />} title="No Broadcast Messages" description="Create automated messages to broadcast server rules, announcements, or welcome messages." action={<Button variant="primary" onClick={handleCreate}><Plus size={14} /> Create Message</Button>} />
      ) : (
        <div className="messenger-list">
          {messenger.messages.map(msg => (
            <MessageCard key={msg.id} msg={msg} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <MessageModal open={modalOpen} onClose={() => { setModalOpen(false); setEditingMsg(null); }} onSave={handleSave} editingMsg={editingMsg} />
    </div>
  );
}
