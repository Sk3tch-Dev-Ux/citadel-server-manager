import { useState, useEffect, useCallback, useRef } from 'react';
import API from '../api';
import { useServers } from '../contexts/ServersContext';
import { Modal, Toggle, EmptyState, Button, Input, FormField } from '../components/ui';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import PageLoader from '../components/PageLoader';
import { Send, Plus, Trash2, Edit, Check, X, Clock, Server, ChevronDown, FileText, MessageSquare } from '../components/Icon';

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

/* ─── Message Templates ─── */

const TEMPLATE_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'welcome', label: 'Welcome' },
  { id: 'rules', label: 'Rules' },
  { id: 'community', label: 'Community' },
  { id: 'gameplay', label: 'Gameplay' },
];

const MESSENGER_TEMPLATES = [
  /* ── Welcome ── */
  {
    id: 'welcome-basic',
    name: 'Welcome Message',
    description: 'Greet players with server name and population',
    category: 'welcome',
    color: '#57F287',
    text: 'Welcome to {server_name}! There are currently {player_count}/{max_players} players online. Enjoy your stay!',
    intervalMinutes: 15,
    startDelayMinutes: 2,
  },
  {
    id: 'welcome-new-player',
    name: 'New Player Tips',
    description: 'Helpful tips for freshspawns and new players',
    category: 'welcome',
    color: '#57F287',
    text: 'New to DayZ? Loot the coast for basic supplies, head inland for better gear. Watch your food, water, and temperature. Stay alert — not everyone is friendly!',
    intervalMinutes: 30,
    startDelayMinutes: 5,
  },
  /* ── Rules ── */
  {
    id: 'rules-general',
    name: 'Server Rules',
    description: 'Broadcast core server rules to all players',
    category: 'rules',
    color: '#FEE75C',
    text: 'Server Rules: No combat logging, no duping, no glitching. Play fair or face a ban. Full rules on our Discord.',
    intervalMinutes: 30,
    startDelayMinutes: 5,
  },
  {
    id: 'rules-kos',
    name: 'KOS / Safe Zone Rules',
    description: 'Remind players about KOS and safe zone policies',
    category: 'rules',
    color: '#FEE75C',
    text: 'Reminder: KOS is NOT allowed in safe zones. Violators will be banned. Check your map for safe zone boundaries.',
    intervalMinutes: 30,
    startDelayMinutes: 10,
  },
  {
    id: 'rules-base',
    name: 'Base Building Rules',
    description: 'Base raiding and building guidelines',
    category: 'rules',
    color: '#FEE75C',
    text: 'Base Rules: Max 3 code locks per door. No sky bases or floating structures. Raid only through doors — no glitching through walls.',
    intervalMinutes: 45,
    startDelayMinutes: 10,
  },
  {
    id: 'rules-report',
    name: 'Report Players',
    description: 'How to report rule-breakers or hackers',
    category: 'rules',
    color: '#ED4245',
    text: 'Spotted a cheater or rule-breaker? Report them on our Discord with video evidence. Admins review all reports.',
    intervalMinutes: 45,
    startDelayMinutes: 15,
  },
  /* ── Community ── */
  {
    id: 'community-discord',
    name: 'Discord Invite',
    description: 'Promote your Discord server',
    category: 'community',
    color: '#5865F2',
    text: 'Join our Discord for server updates, events, and support! discord.gg/YOUR-INVITE-HERE',
    intervalMinutes: 20,
    startDelayMinutes: 3,
  },
  {
    id: 'community-website',
    name: 'Website / Donations',
    description: 'Link to your website or donation page',
    category: 'community',
    color: '#5865F2',
    text: 'Support {server_name}! Visit our website for VIP perks, server info, and more: www.your-website.com',
    intervalMinutes: 30,
    startDelayMinutes: 10,
  },
  {
    id: 'community-vote',
    name: 'Vote for Us',
    description: 'Encourage players to vote or leave a review',
    category: 'community',
    color: '#5865F2',
    text: 'Enjoying {server_name}? Vote for us on your favorite DayZ server list! Every vote helps us grow.',
    intervalMinutes: 60,
    startDelayMinutes: 15,
  },
  /* ── Gameplay ── */
  {
    id: 'gameplay-restart',
    name: 'Restart Schedule',
    description: 'Inform players about the restart schedule',
    category: 'gameplay',
    color: '#EB459E',
    text: 'Server restarts every 6 hours (00:00, 06:00, 12:00, 18:00). Warnings broadcast 15 min, 10 min, 5 min, and 1 min before restart.',
    intervalMinutes: 30,
    startDelayMinutes: 5,
  },
  {
    id: 'gameplay-trader',
    name: 'Trader Location',
    description: 'Direct players to trader zones',
    category: 'gameplay',
    color: '#EB459E',
    text: 'Looking for a trader? Check your map for marked trader locations. Buy, sell, and trade safely in trader zones!',
    intervalMinutes: 30,
    startDelayMinutes: 10,
  },
  {
    id: 'gameplay-events',
    name: 'Server Events',
    description: 'Announce upcoming events or airdrops',
    category: 'gameplay',
    color: '#EB459E',
    text: 'Events are active on {server_name}! Check Discord for event schedules, prizes, and how to participate.',
    intervalMinutes: 45,
    startDelayMinutes: 10,
  },
  {
    id: 'gameplay-wipe',
    name: 'Wipe Schedule',
    description: 'Inform players about upcoming wipes',
    category: 'gameplay',
    color: '#ED4245',
    text: 'Next server wipe is scheduled for [DATE]. Build smart, stash valuables, and prepare! Check Discord for details.',
    intervalMinutes: 60,
    startDelayMinutes: 15,
  },
  {
    id: 'gameplay-population',
    name: 'Server Population',
    description: 'Display current server population using placeholders',
    category: 'gameplay',
    color: '#57F287',
    text: '{server_name} — {player_count}/{max_players} survivors online. The more the merrier!',
    intervalMinutes: 15,
    startDelayMinutes: 5,
  },
];

// ─── Template Picker Modal ──────────────────────────────────
function TemplatePicker({ onSelect, onClose }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? MESSENGER_TEMPLATES : MESSENGER_TEMPLATES.filter(t => t.category === filter);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wh-template-modal" onClick={e => e.stopPropagation()}>
        <div className="wh-template-header">
          <div className="wh-template-header-left">
            <div className="wh-discord-icon" style={{ background: 'var(--accent-blue)' }}>
              <MessageSquare size={20} color="white" />
            </div>
            <div>
              <div className="wh-template-title">Broadcast Message Templates</div>
              <div className="wh-template-subtitle">Choose a pre-built template to get started quickly</div>
            </div>
          </div>
          <button className="wh-template-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="wh-template-filters">
          {TEMPLATE_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              className={`wh-filter-btn ${filter === cat.id ? 'active' : ''}`}
              onClick={() => setFilter(cat.id)}
            >{cat.label}</button>
          ))}
        </div>

        <div className="wh-template-grid">
          {filtered.map(tpl => (
            <div key={tpl.id} className="wh-template-card" onClick={() => onSelect(tpl)}>
              <div className="wh-template-card-header">
                <span className="wh-template-dot" style={{ background: tpl.color }} />
                <span className="wh-template-name">{tpl.name}</span>
                <span className="wh-template-category-badge">{tpl.category.charAt(0).toUpperCase() + tpl.category.slice(1)}</span>
              </div>
              <div className="wh-template-desc">{tpl.description}</div>

              <div className="wh-template-preview-label">Preview</div>
              <div className="messenger-template-preview">
                <div className="messenger-template-preview-text">{tpl.text}</div>
              </div>

              <div className="messenger-template-meta">
                <span className="scheduler-meta-item"><Clock size={11} /> Every {tpl.intervalMinutes}m</span>
                <span className="scheduler-meta-item"><Send size={11} /> {tpl.startDelayMinutes > 0 ? `${tpl.startDelayMinutes}m delay` : 'No delay'}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="wh-template-footer">
          <span>Select a template to pre-fill the message form</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Server Multi-Select ─────────────────────────────────
function ServerSelect({ servers, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (id) => {
    const next = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id];
    onChange(next);
  };

  return (
    <div className="wh-event-filter-select" ref={ref}>
      <div className="wh-event-filter-trigger input" onClick={() => setOpen(!open)}>
        <span className="wh-event-filter-text">
          {selected.length === 0 ? 'Current server only' : `${selected.length} additional server${selected.length !== 1 ? 's' : ''}`}
        </span>
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>
      {open && (
        <div className="wh-event-filter-dropdown">
          <div className="wh-event-filter-list">
            {servers.map(srv => (
              <label key={srv.id} className="wh-event-filter-item" onClick={() => toggle(srv.id)}>
                <span className={`wh-event-filter-check ${selected.includes(srv.id) ? 'checked' : ''}`}>
                  {selected.includes(srv.id) && <Check size={10} />}
                </span>
                <span className="wh-event-filter-icon"><Server size={14} /></span>
                <span className="wh-event-filter-label">{srv.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
function MessageModal({ open, onClose, onSave, editingMsg, templateDefaults, servers, currentServerId }) {
  const isEdit = !!editingMsg;
  const [text, setText] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [startDelayMinutes, setStartDelayMinutes] = useState(0);
  const [additionalServerIds, setAdditionalServerIds] = useState([]);

  useEffect(() => {
    if (editingMsg) {
      setText(editingMsg.text || '');
      setIntervalMinutes(Math.floor((editingMsg.intervalSeconds || 300) / 60));
      setStartDelayMinutes(Math.floor((editingMsg.startDelaySeconds || 0) / 60));
    } else if (templateDefaults) {
      setText(templateDefaults.text || '');
      setIntervalMinutes(templateDefaults.intervalMinutes || 5);
      setStartDelayMinutes(templateDefaults.startDelayMinutes || 0);
    } else {
      setText('');
      setIntervalMinutes(5);
      setStartDelayMinutes(0);
    }
    setAdditionalServerIds([]);
  }, [editingMsg, templateDefaults, open]);

  const handleSave = () => {
    if (!text.trim()) { window.addToast?.('Message text is required', 'error'); return; }
    if (intervalMinutes < 1) { window.addToast?.('Interval must be at least 1 minute', 'error'); return; }
    onSave({
      ...(editingMsg ? { id: editingMsg.id } : {}),
      text: text.trim(),
      intervalSeconds: intervalMinutes * 60,
      startDelaySeconds: startDelayMinutes * 60,
      additionalServerIds,
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

        {!isEdit && servers && servers.length > 1 && (
          <FormField label="Also create on other servers">
            <ServerSelect
              servers={servers.filter(s => s.id !== currentServerId)}
              selected={additionalServerIds}
              onChange={setAdditionalServerIds}
            />
            <span className="form-hint">Optionally copy this message to additional servers</span>
          </FormField>
        )}

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
  const { servers } = useServers();
  const { confirm: confirmDialog, DialogComponent } = useConfirmDialog();
  const [messenger, setMessenger] = useState({ enabled: true, messages: [] });
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMsg, setEditingMsg] = useState(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateDefaults, setTemplateDefaults] = useState(null);

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
    if (!await confirmDialog({ title: 'Delete Message', message: 'Delete this broadcast message?', confirmLabel: 'Delete', variant: 'danger' })) return;
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
    setTemplateDefaults(null);
    setModalOpen(true);
  };

  const handleTemplateSelect = (tpl) => {
    setTemplatePickerOpen(false);
    setEditingMsg(null);
    setTemplateDefaults({
      text: tpl.text,
      intervalMinutes: tpl.intervalMinutes,
      startDelayMinutes: tpl.startDelayMinutes,
    });
    setModalOpen(true);
  };

  const handleSave = async (data) => {
    const { additionalServerIds, ...msgData } = data;
    try {
      if (msgData.id) {
        const updated = await API.put(`/api/servers/${serverId}/messenger/${msgData.id}`, msgData);
        setMessenger(prev => ({
          ...prev,
          messages: prev.messages.map(m => m.id === msgData.id ? updated : m),
        }));
        window.addToast?.('Message updated', 'success');
      } else {
        const created = await API.post(`/api/servers/${serverId}/messenger`, msgData);
        setMessenger(prev => ({
          ...prev,
          messages: [...prev.messages, created],
        }));

        // Copy to additional servers
        let copied = 0;
        for (const extraId of (additionalServerIds || [])) {
          try {
            await API.post(`/api/servers/${extraId}/messenger`, msgData);
            copied++;
          } catch { /* silent — some servers may not be available */ }
        }

        const msg = copied > 0 ? `Message created (+ copied to ${copied} server${copied !== 1 ? 's' : ''})` : 'Message created';
        window.addToast?.(msg, 'success');
      }
      setModalOpen(false);
      setEditingMsg(null);
    } catch { window.addToast?.('Failed to save message', 'error'); }
  };

  if (loading) return <PageLoader message="Loading messenger..." />;

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
          <Button variant="secondary" onClick={() => setTemplatePickerOpen(true)}><FileText size={14} /> Use Template</Button>
          <Button variant="primary" onClick={handleCreate}><Plus size={14} /> New Message</Button>
        </div>
      </div>

      {messenger.messages.length === 0 ? (
        <EmptyState icon={<Send size={48} />} title="No Broadcast Messages" description="Create automated messages to broadcast server rules, announcements, or welcome messages." action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => setTemplatePickerOpen(true)}><FileText size={14} /> Use Template</Button>
            <Button variant="primary" onClick={handleCreate}><Plus size={14} /> Create Message</Button>
          </div>
        } />
      ) : (
        <div className="messenger-list">
          {messenger.messages.map(msg => (
            <MessageCard key={msg.id} msg={msg} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {templatePickerOpen && (
        <TemplatePicker
          onSelect={handleTemplateSelect}
          onClose={() => setTemplatePickerOpen(false)}
        />
      )}

      <MessageModal open={modalOpen} onClose={() => { setModalOpen(false); setEditingMsg(null); setTemplateDefaults(null); }} onSave={handleSave} editingMsg={editingMsg} templateDefaults={templateDefaults} servers={servers} currentServerId={serverId} />

      {DialogComponent}
    </div>
  );
}
