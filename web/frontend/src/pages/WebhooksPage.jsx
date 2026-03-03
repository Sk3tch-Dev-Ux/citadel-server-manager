import { useState, useEffect, useRef } from 'react';
import API from '../api';
import { useServers } from '../contexts/ServersContext';
import {
  CheckCircle, XCircle, AlertTriangle, RotateCcw, Activity, Ban, Shield, Package,
  Trash2, Webhook, Send, Plus, MoreVertical, Clock, Copy, ExternalLink, Eye, EyeOff,
  Power, Zap, Check, X, ChevronDown, Edit, RefreshCw, Play, Users, Globe, Server,
} from '../components/Icon';

/* ─── Template Definitions ─── */

const WEBHOOK_TEMPLATES = [
  /* ── Simple ── */
  {
    id: 'simple-text',
    name: 'Simple Text',
    description: 'Basic text notification for any event',
    category: 'simple',
    color: '#5865F2',
    events: ['server.started', 'server.stopped', 'server.crashed', 'server.restarted'],
    template: { content: '**{{event}}** — {{server}} at {{timestamp}}' },
  },
  {
    id: 'simple-status',
    name: 'Simple Status',
    description: 'Minimal embed with event and server info',
    category: 'simple',
    color: '#57F287',
    events: ['server.started', 'server.stopped', 'server.crashed', 'server.restarted', 'server.health'],
    template: {
      embeds: [{
        description: '**{{event}}** — {{server}}',
        color: 5763719,
        timestamp: '{{date_iso}}',
      }],
    },
  },
  /* ── Server ── */
  {
    id: 'server-started',
    name: 'Server Started',
    description: 'Rich embed for server start events',
    category: 'server',
    color: '#57F287',
    events: ['server.started'],
    template: {
      embeds: [{
        title: '\u{1F7E2} Server Started',
        description: 'Server **{{server}}** has started successfully',
        color: 5763719,
        fields: [
          { name: 'Server', value: '{{server}}', inline: true },
          { name: 'Timestamp', value: '{{timestamp}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  {
    id: 'server-stopped',
    name: 'Server Stopped',
    description: 'Rich embed for server stop events',
    category: 'server',
    color: '#ED4245',
    events: ['server.stopped'],
    template: {
      embeds: [{
        title: '\u{1F534} Server Stopped',
        description: 'Server **{{server}}** has stopped',
        color: 15548997,
        fields: [
          { name: 'Server', value: '{{server}}', inline: true },
          { name: 'Timestamp', value: '{{timestamp}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  {
    id: 'server-crashed',
    name: 'Server Crashed',
    description: 'Alert embed for unexpected server crashes',
    category: 'server',
    color: '#ED4245',
    events: ['server.crashed'],
    template: {
      embeds: [{
        title: '\u{1F4A5} Server Crashed',
        description: 'Server **{{server}}** has crashed unexpectedly',
        color: 15548997,
        fields: [
          { name: 'Server', value: '{{server}}', inline: true },
          { name: 'Reason', value: '{{reason}}', inline: true },
          { name: 'Timestamp', value: '{{timestamp}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  {
    id: 'server-restarted',
    name: 'Server Restarted',
    description: 'Notification for scheduled or manual restarts',
    category: 'server',
    color: '#5865F2',
    events: ['server.restarted'],
    template: {
      embeds: [{
        title: '\u{1F504} Server Restarted',
        description: 'Server **{{server}}** has been restarted',
        color: 5793266,
        fields: [
          { name: 'Server', value: '{{server}}', inline: true },
          { name: 'Timestamp', value: '{{timestamp}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  {
    id: 'server-health',
    name: 'Health Alert',
    description: 'Warning embed for server health issues',
    category: 'server',
    color: '#FEE75C',
    events: ['server.health'],
    template: {
      embeds: [{
        title: '\u26A0\uFE0F Health Alert',
        description: 'Server **{{server}}** has a health issue',
        color: 16705372,
        fields: [
          { name: 'Server', value: '{{server}}', inline: true },
          { name: 'Reason', value: '{{reason}}', inline: true },
          { name: 'Timestamp', value: '{{timestamp}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  {
    id: 'title-update',
    name: 'Title Update',
    description: 'Alert on game title changes',
    category: 'server',
    color: '#1ABC9C',
    events: ['server.updated_title'],
    template: {
      embeds: [{
        title: '\u{1F4DD} Title Update',
        description: 'Game title has been updated on **{{server}}**',
        color: 1752220,
        fields: [
          { name: 'Server', value: '{{server}}', inline: true },
          { name: 'Timestamp', value: '{{timestamp}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  {
    id: 'comprehensive-status',
    name: 'Comprehensive Status',
    description: 'Detailed server activity with all fields',
    category: 'server',
    color: '#5865F2',
    events: ['server.started', 'server.stopped', 'server.updated_title', 'server.updated_mod'],
    template: {
      content: '\u{1F3E2} **Server Update**',
      embeds: [{
        title: 'Server Activity Report',
        description: 'Detailed server status information',
        color: 5793266,
        fields: [
          { name: 'Event', value: '{{event}}', inline: true },
          { name: 'Server', value: '{{server}}', inline: true },
          { name: 'Server ID', value: '{{server_id}}', inline: true },
          { name: 'Timestamp', value: '{{timestamp}}', inline: false },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  /* ── User ── */
  {
    id: 'player-kicked',
    name: 'Player Kicked',
    description: 'Notification when a player is kicked',
    category: 'user',
    color: '#E67E22',
    events: ['player.kick'],
    template: {
      embeds: [{
        title: '\u{1F9B6} Player Kicked',
        description: 'A player has been kicked from **{{server}}**',
        color: 15105570,
        fields: [
          { name: 'Player', value: '{{player}}', inline: true },
          { name: 'Reason', value: '{{reason}}', inline: true },
          { name: 'Server', value: '{{server}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  {
    id: 'player-banned',
    name: 'Player Banned',
    description: 'Notification when a player is banned',
    category: 'user',
    color: '#ED4245',
    events: ['player.ban'],
    template: {
      embeds: [{
        title: '\u{1F528} Player Banned',
        description: 'A player has been banned from **{{server}}**',
        color: 15548997,
        fields: [
          { name: 'Player', value: '{{player}}', inline: true },
          { name: 'Reason', value: '{{reason}}', inline: true },
          { name: 'Server', value: '{{server}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  /* ── Mod ── */
  {
    id: 'mod-installed',
    name: 'Mod Installed',
    description: 'Notification when a new mod is installed',
    category: 'mod',
    color: '#57F287',
    events: ['mod.installed'],
    template: {
      embeds: [{
        title: '\u{1F4E6} Mod Installed',
        description: 'A new mod has been installed on **{{server}}**',
        color: 5763719,
        fields: [
          { name: 'Mod', value: '{{mod}}', inline: true },
          { name: 'Server', value: '{{server}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  {
    id: 'mod-removed',
    name: 'Mod Removed',
    description: 'Notification when a mod is removed',
    category: 'mod',
    color: '#ED4245',
    events: ['mod.removed'],
    template: {
      embeds: [{
        title: '\u{1F5D1}\uFE0F Mod Removed',
        description: 'A mod has been removed from **{{server}}**',
        color: 15548997,
        fields: [
          { name: 'Mod', value: '{{mod}}', inline: true },
          { name: 'Server', value: '{{server}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
  {
    id: 'mod-updated',
    name: 'Mod Updated',
    description: 'Alert when a server mod is updated',
    category: 'mod',
    color: '#5865F2',
    events: ['server.updated_mod', 'mod.installed'],
    template: {
      embeds: [{
        title: '\u{1F4E6} Mod Updated',
        description: 'A mod has been updated on **{{server}}**',
        color: 5793266,
        fields: [
          { name: 'Mod', value: '{{mod}}', inline: true },
          { name: 'Server', value: '{{server}}', inline: true },
          { name: 'Timestamp', value: '{{timestamp}}', inline: true },
        ],
        timestamp: '{{date_iso}}',
      }],
    },
  },
];

const TEMPLATE_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'simple', label: 'Simple' },
  { id: 'server', label: 'Server' },
  { id: 'user', label: 'User' },
  { id: 'mod', label: 'Mod' },
];

/* ─── Event Metadata ─── */

/** Fallback event list used before the API responds */
const FALLBACK_EVENTS = [
  'agent.ready', 'session.begin', 'session.ended',
  'server.started', 'server.stopped', 'server.crashed', 'server.restarted', 'server.health',
  'title.updated', 'mod.updated', 'mod.installed', 'mod.removed',
  'server.updated_title', 'server.updated_mod',
  'player.joined', 'player.left', 'player.kick', 'player.ban',
  'backup.created', 'backup.restored',
  'scheduler.executed',
];

const EVENT_ICONS = {
  'server.started': <CheckCircle size={14} />, 'server.stopped': <XCircle size={14} />,
  'server.crashed': <AlertTriangle size={14} />, 'server.restarted': <RotateCcw size={14} />,
  'server.health': <Activity size={14} />, 'server.updated_title': <Edit size={14} />,
  'server.updated_mod': <Package size={14} />,
  'player.kick': <Ban size={14} />, 'player.ban': <Shield size={14} />,
  'player.joined': <Users size={14} />, 'player.left': <Users size={14} />,
  'mod.installed': <Package size={14} />, 'mod.removed': <Trash2 size={14} />,
  'mod.updated': <Package size={14} />, 'title.updated': <Globe size={14} />,
  'agent.ready': <Power size={14} />, 'session.begin': <Users size={14} />,
  'session.ended': <Users size={14} />, 'backup.created': <CheckCircle size={14} />,
  'backup.restored': <RefreshCw size={14} />, 'scheduler.executed': <Clock size={14} />,
};

const EVENT_BADGE_CLASS = (e) => {
  if (e.includes('started')) return 'wh-badge-green';
  if (e.includes('stopped') || e.includes('crashed') || e.includes('banned') || e.includes('removed')) return 'wh-badge-red';
  if (e.includes('restarted') || e.includes('updated')) return 'wh-badge-blue';
  if (e.includes('health')) return 'wh-badge-yellow';
  return 'wh-badge-default';
};

/* ─── Helpers ─── */

function intToHex(color) {
  return '#' + color.toString(16).padStart(6, '0');
}

function truncateId(id) {
  if (!id) return '';
  // Obfuscate middle portion like the screenshot
  const start = id.substring(0, 8);
  const rest = id.substring(8, 20);
  return start + rest.replace(/[a-f0-9]/gi, c => Math.random() > 0.5 ? '*' : c);
}

/* ─── Mini Discord Embed Preview ─── */

function EmbedPreview({ template }) {
  if (!template) return null;
  const t = typeof template === 'string' ? (() => { try { return JSON.parse(template); } catch { return null; } })() : template;
  if (!t) return null;

  const embed = t.embeds?.[0];
  const borderColor = embed?.color ? intToHex(embed.color) : '#5865F2';

  return (
    <div className="wh-embed-preview">
      {t.content && <div className="wh-embed-content">{t.content}</div>}
      {embed && (
        <div className="wh-embed-card" style={{ borderLeftColor: borderColor }}>
          {embed.title && <div className="wh-embed-title">{embed.title}</div>}
          {embed.description && <div className="wh-embed-desc">{embed.description}</div>}
          {embed.fields && embed.fields.length > 0 && (
            <div className="wh-embed-fields">
              {embed.fields.slice(0, 3).map((f, i) => (
                <div key={i} className={`wh-embed-field ${f.inline ? 'inline' : ''}`}>
                  <div className="wh-embed-field-name">{f.name}</div>
                  <div className="wh-embed-field-value">{f.value}</div>
                </div>
              ))}
              {embed.fields.length > 3 && <div className="wh-embed-field-more">+{embed.fields.length - 3} more fields</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Template Picker Modal ─── */

function TemplatePicker({ onSelect, onClose }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? WEBHOOK_TEMPLATES : WEBHOOK_TEMPLATES.filter(t => t.category === filter);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wh-template-modal" onClick={e => e.stopPropagation()}>
        <div className="wh-template-header">
          <div className="wh-template-header-left">
            <div className="wh-discord-icon">
              <svg width="20" height="20" viewBox="0 0 71 55" fill="white"><path d="M60.1 4.9C55.6 2.8 50.7 1.3 45.7.4c-.1 0-.2 0-.2.1-.6 1.1-1.3 2.6-1.8 3.7-5.5-.8-10.9-.8-16.2 0-.5-1.2-1.2-2.6-1.8-3.7 0-.1-.1-.1-.2-.1C20.3 1.3 15.4 2.8 10.9 4.9c0 0-.1 0-.1.1C1.6 18.7-.9 32.1.3 45.4c0 .1 0 .1.1.2 6.1 4.5 12 7.2 17.7 9 .1 0 .2 0 .2-.1 1.4-1.9 2.6-3.8 3.6-5.9.1-.1 0-.3-.1-.3-2-.7-3.8-1.6-5.6-2.6-.1-.1-.1-.3 0-.4.4-.3.7-.6 1.1-.9.1-.1.1-.1.2 0 11.6 5.3 24.2 5.3 35.7 0h.2c.3.3.7.6 1.1.9.2.1.2.3 0 .4-1.8 1-3.6 1.9-5.6 2.6-.1.1-.2.2-.1.3 1.1 2.1 2.3 4 3.6 5.9.1.1.2.1.3.1 5.8-1.8 11.7-4.5 17.8-9 .1 0 .1-.1.1-.2 1.6-15.4-2.6-28.8-10.7-40.5 0 0 0 0-.1 0z"/></svg>
            </div>
            <div>
              <div className="wh-template-title">Discord Webhook Templates</div>
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
              <EmbedPreview template={tpl.template} />

              <div className="wh-template-events-label">Compatible Events</div>
              <div className="wh-template-events">
                {tpl.events.map(ev => (
                  <span key={ev} className={`wh-event-chip ${EVENT_BADGE_CLASS(ev)}`}>{ev}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="wh-template-footer">
          <span>Select a template to apply it to your webhook</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Event Filter Multi-Select ─── */

function EventFilterSelect({ allEvents, eventDescriptions, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (ev) => {
    const next = selected.includes(ev) ? selected.filter(e => e !== ev) : [...selected, ev];
    onChange(next);
  };

  const selectAll = () => onChange([...allEvents]);
  const clearAll = () => onChange([]);

  return (
    <div className="wh-event-filter-select" ref={ref}>
      <div className="wh-event-filter-trigger input" onClick={() => setOpen(!open)}>
        <span className="wh-event-filter-text">
          {selected.length === 0 ? 'All events (no filter)' : `${selected.length} event${selected.length !== 1 ? 's' : ''} selected`}
        </span>
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>
      {open && (
        <div className="wh-event-filter-dropdown">
          <div className="wh-event-filter-actions">
            <button className="btn btn-xs btn-secondary" onClick={selectAll}>Select All</button>
            <button className="btn btn-xs btn-secondary" onClick={clearAll}>Clear</button>
          </div>
          <div className="wh-event-filter-list">
            {allEvents.map(ev => (
              <label key={ev} className="wh-event-filter-item" onClick={() => toggle(ev)}>
                <span className={`wh-event-filter-check ${selected.includes(ev) ? 'checked' : ''}`}>
                  {selected.includes(ev) && <Check size={10} />}
                </span>
                <span className="wh-event-filter-icon">{EVENT_ICONS[ev] || null}</span>
                <span className="wh-event-filter-label">{ev}</span>
                {eventDescriptions[ev] && <span className="wh-event-filter-desc">{eventDescriptions[ev]}</span>}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Server Filter Multi-Select ─── */

function ServerFilterSelect({ servers, selected, onChange }) {
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

  const selectAll = () => onChange(servers.map(s => s.id));
  const clearAll = () => onChange([]);

  return (
    <div className="wh-event-filter-select" ref={ref}>
      <div className="wh-event-filter-trigger input" onClick={() => setOpen(!open)}>
        <span className="wh-event-filter-text">
          {selected.length === 0 ? 'All servers (no filter)' : `${selected.length} server${selected.length !== 1 ? 's' : ''} selected`}
        </span>
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>
      {open && (
        <div className="wh-event-filter-dropdown">
          <div className="wh-event-filter-actions">
            <button className="btn btn-xs btn-secondary" onClick={selectAll}>Select All</button>
            <button className="btn btn-xs btn-secondary" onClick={clearAll}>Clear</button>
          </div>
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

/* ─── Create / Edit Webhook Modal ─── */

function WebhookFormModal({ initial, events, eventDescriptions, servers, onSave, onClose, title }) {
  const [form, setForm] = useState(initial);
  const [jsonError, setJsonError] = useState('');

  const updateTemplate = (val) => {
    setForm(f => ({ ...f, template: val }));
    if (val.trim()) {
      try { JSON.parse(val); setJsonError(''); } catch (e) { setJsonError(e.message); }
    } else {
      setJsonError('');
    }
  };

  const handleSave = () => {
    if (!form.url) { window.addToast?.('Webhook URL is required', 'error'); return; }
    if (jsonError) { window.addToast?.('Fix the JSON error before saving', 'error'); return; }
    onSave(form);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg wh-form-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{title || 'Create Webhook'}</div>

        <div className="input-group">
          <label className="input-label">Primary Event</label>
          <select className="input" value={form.event} onChange={e => setForm(f => ({ ...f, event: e.target.value }))}>
            {events.map(ev => <option key={ev} value={ev}>{ev}{eventDescriptions[ev] ? ` — ${eventDescriptions[ev]}` : ''}</option>)}
          </select>
        </div>

        <div className="input-group">
          <label className="input-label">Event Filter <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>Leave empty to fire for all events</span></label>
          <EventFilterSelect
            allEvents={events}
            eventDescriptions={eventDescriptions}
            selected={form.events || []}
            onChange={(evts) => setForm(f => ({ ...f, events: evts }))}
          />
        </div>

        {servers && servers.length > 0 && (
          <div className="input-group">
            <label className="input-label">Server Filter <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>Leave empty to fire for all servers</span></label>
            <ServerFilterSelect
              servers={servers}
              selected={form.serverIds || []}
              onChange={(ids) => setForm(f => ({ ...f, serverIds: ids }))}
            />
          </div>
        )}

        <div className="input-group">
          <label className="input-label">Webhook URL</label>
          <input
            className="input"
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            placeholder="https://discord.com/api/webhooks/..."
          />
        </div>

        <div className="input-group">
          <label className="input-label">
            Template (JSON body)
            {form.template && !jsonError && <span style={{ color: 'var(--accent-green)', marginLeft: 8, fontSize: 11 }}><Check size={12} /> Valid JSON</span>}
            {jsonError && <span style={{ color: 'var(--accent-red)', marginLeft: 8, fontSize: 11 }}>Invalid JSON</span>}
          </label>
          <textarea
            className="input wh-template-textarea"
            value={form.template}
            onChange={e => updateTemplate(e.target.value)}
            placeholder={'{\n  "embeds": [{\n    "title": "Event Title",\n    "description": "Server **{{server}}** ...",\n    "color": 5763719,\n    "timestamp": "{{date_iso}}"\n  }]\n}'}
            rows={12}
            spellCheck={false}
          />
          {jsonError && <div className="wh-json-error">{jsonError}</div>}
          <div className="wh-variables-hint">
            Variables: <code>{'{{server}}'}</code> <code>{'{{server_id}}'}</code> <code>{'{{timestamp}}'}</code> <code>{'{{date_iso}}'}</code> <code>{'{{event}}'}</code> <code>{'{{reason}}'}</code> <code>{'{{player}}'}</code> <code>{'{{player_name}}'}</code> <code>{'{{player_id}}'}</code> <code>{'{{mod}}'}</code> <code>{'{{mod_id}}'}</code> <code>{'{{build}}'}</code> <code>{'{{action}}'}</code> <code>{'{{job}}'}</code>
          </div>
        </div>

        {form.template && !jsonError && (
          <div className="wh-form-preview">
            <div className="wh-form-preview-label">Preview</div>
            <EmbedPreview template={form.template} />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div className={`toggle ${form.retryEnabled ? 'on' : ''}`} onClick={() => setForm(f => ({ ...f, retryEnabled: !f.retryEnabled }))}><div className="toggle-knob" /></div>
          <span style={{ fontSize: 13 }}>Enable retry on failure</span>
        </div>

        {form.retryEnabled && (
          <div className="input-group" style={{ marginBottom: 16 }}>
            <label className="input-label">Retry Count <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>1-10 attempts</span></label>
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={form.retryCount || 3}
              onChange={e => setForm(f => ({ ...f, retryCount: Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 10) }))}
              style={{ width: 80 }}
            />
          </div>
        )}

        <div className="btn-group">
          <button className="btn btn-primary" onClick={handleSave}>{title === 'Edit Webhook' ? 'Save Changes' : 'Create Webhook'}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */

export default function WebhooksPage() {
  const { servers } = useServers();
  const [webhooks, setWebhooks] = useState([]);
  const [tab, setTab] = useState('webhooks');
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editingWh, setEditingWh] = useState(null);
  const [selectedWh, setSelectedWh] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [openMenu, setOpenMenu] = useState(null);
  const [createDefaults, setCreateDefaults] = useState({ event: 'server.started', url: '', template: '', retryEnabled: true, retryCount: 3, events: [], serverIds: [] });
  const [eventTypes, setEventTypes] = useState({});
  const menuRef = useRef(null);

  // Derive event list from API response or fallback
  const allEvents = Object.keys(eventTypes).length > 0 ? Object.keys(eventTypes) : FALLBACK_EVENTS;

  useEffect(() => {
    API.get('/api/webhooks').then(d => setWebhooks(Array.isArray(d) ? d : []));
    API.get('/api/webhooks/events').then(d => { if (d && typeof d === 'object' && !d.error) setEventTypes(d); });
  }, []);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (openMenu && menuRef.current && !menuRef.current.contains(e.target)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  /* ── Actions ── */

  const addWebhook = async (data) => {
    const wh = await API.post('/api/webhooks', data);
    if (wh.error) { window.addToast?.(wh.error, 'error'); return; }
    setWebhooks(ws => [...ws, wh]);
    setShowCreate(false);
    window.addToast?.('Webhook created', 'success');
  };

  const updateWebhook = async (data) => {
    const wh = await API.patch(`/api/webhooks/${editingWh.id}`, data);
    if (wh.error) { window.addToast?.(wh.error, 'error'); return; }
    setWebhooks(ws => ws.map(w => w.id === editingWh.id ? wh : w));
    setEditingWh(null);
    window.addToast?.('Webhook updated', 'success');
  };

  const deleteWebhook = async (id) => {
    await API.del(`/api/webhooks/${id}`);
    setWebhooks(ws => ws.filter(w => w.id !== id));
    window.addToast?.('Webhook deleted', 'success');
  };

  const testWebhook = async (id) => {
    const r = await API.post(`/api/webhooks/${id}/test`);
    window.addToast?.(r.message || 'Test sent', 'success');
  };

  const toggleWebhook = async (id, enabled) => {
    await API.patch(`/api/webhooks/${id}`, { enabled: !enabled });
    setWebhooks(ws => ws.map(w => w.id === id ? { ...w, enabled: !enabled } : w));
  };

  const viewDeliveries = async (wh) => {
    setSelectedWh(wh);
    const d = await API.get(`/api/webhooks/${wh.id}/deliveries`);
    setDeliveries(Array.isArray(d) ? d : []);
    setTab('deliveries');
  };

  const handleTemplateSelect = (tpl) => {
    setShowTemplates(false);
    setCreateDefaults({
      event: tpl.events[0] || 'server.started',
      url: '',
      template: JSON.stringify(tpl.template, null, 2),
      retryEnabled: true,
      retryCount: 3,
      events: tpl.events || [],
      serverIds: [],
    });
    setShowCreate(true);
  };

  const handleOpenCreate = () => {
    setCreateDefaults({ event: 'server.started', url: '', template: '', retryEnabled: true, retryCount: 3, events: [], serverIds: [] });
    setShowCreate(true);
  };

  const handleEdit = (wh) => {
    setEditingWh(wh);
    setOpenMenu(null);
  };

  /* ── Render ── */

  return (
    <div className="webhooks-page">
      <div className="tabs">
        <div className={`tab ${tab === 'webhooks' ? 'active' : ''}`} onClick={() => setTab('webhooks')}>WebHooks</div>
        <div className={`tab ${tab === 'deliveries' ? 'active' : ''}`} onClick={() => setTab('deliveries')}>Deliveries{selectedWh ? ` (${selectedWh.event})` : ''}</div>
      </div>

      {tab === 'webhooks' && (
        <div>
          <div className="wh-page-header">
            <h2 className="wh-page-title">WebHooks</h2>
            <div className="wh-page-actions">
              <button className="btn btn-primary wh-btn-template" onClick={() => setShowTemplates(true)}>
                <Zap size={14} /> Use Template
              </button>
              <button className="btn btn-secondary" onClick={handleOpenCreate}>Create new WebHook</button>
            </div>
          </div>

          {webhooks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Webhook size={48} /></div>
              <div className="empty-title">No Webhooks</div>
              <p>Add webhooks to receive notifications for server events.</p>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowTemplates(true)}>
                <Zap size={14} /> Get Started with a Template
              </button>
            </div>
          ) : (
            <div className="wh-list">
              {webhooks.map(wh => (
                <div key={wh.id} className={`wh-card ${!wh.enabled ? 'wh-card-disabled' : ''}`}>
                  <div className="wh-card-body">
                    <div className="wh-card-top">
                      <span className="wh-card-event">{wh.event}</span>
                      {wh.isDiscord && (
                        <span className="wh-badge wh-badge-discord">
                          <svg width="12" height="12" viewBox="0 0 71 55" fill="white"><path d="M60.1 4.9C55.6 2.8 50.7 1.3 45.7.4c-.1 0-.2 0-.2.1-.6 1.1-1.3 2.6-1.8 3.7-5.5-.8-10.9-.8-16.2 0-.5-1.2-1.2-2.6-1.8-3.7 0-.1-.1-.1-.2-.1C20.3 1.3 15.4 2.8 10.9 4.9c0 0-.1 0-.1.1C1.6 18.7-.9 32.1.3 45.4c0 .1 0 .1.1.2 6.1 4.5 12 7.2 17.7 9 .1 0 .2 0 .2-.1 1.4-1.9 2.6-3.8 3.6-5.9.1-.1 0-.3-.1-.3-2-.7-3.8-1.6-5.6-2.6-.1-.1-.1-.3 0-.4.4-.3.7-.6 1.1-.9.1-.1.1-.1.2 0 11.6 5.3 24.2 5.3 35.7 0h.2c.3.3.7.6 1.1.9.2.1.2.3 0 .4-1.8 1-3.6 1.9-5.6 2.6-.1.1-.2.2-.1.3 1.1 2.1 2.3 4 3.6 5.9.1.1.2.1.3.1 5.8-1.8 11.7-4.5 17.8-9 .1 0 .1-.1.1-.2 1.6-15.4-2.6-28.8-10.7-40.5 0 0 0 0-.1 0z"/></svg>
                          discord.com
                        </span>
                      )}
                      {wh.isValidJson && (
                        <span className="wh-badge wh-badge-valid"><CheckCircle size={11} /> Valid JSON</span>
                      )}
                      {!wh.enabled && <span className="wh-badge wh-badge-disabled">Disabled</span>}
                    </div>
                    {Array.isArray(wh.events) && wh.events.length > 0 && (
                      <div className="wh-card-events">
                        {wh.events.slice(0, 5).map(ev => (
                          <span key={ev} className={`wh-event-chip wh-event-chip-sm ${EVENT_BADGE_CLASS(ev)}`}>{ev}</span>
                        ))}
                        {wh.events.length > 5 && <span className="wh-event-chip wh-event-chip-sm wh-badge-default">+{wh.events.length - 5} more</span>}
                      </div>
                    )}
                    {Array.isArray(wh.serverIds) && wh.serverIds.length > 0 && (
                      <div className="wh-card-events">
                        {wh.serverIds.map(sid => {
                          const srv = servers.find(s => s.id === sid);
                          return <span key={sid} className="wh-event-chip wh-event-chip-sm wh-badge-server">{srv?.name || sid}</span>;
                        })}
                      </div>
                    )}
                    <div className="wh-card-meta">
                      ID: {truncateId(wh.id)} &bull; Timeout {(wh.timeout || 60000) / 1000}s &bull; <span style={{ color: wh.retryEnabled ? 'var(--accent-green)' : 'var(--text-muted)' }}>{wh.retryEnabled ? `Retry ${wh.retryCount || 3}x` : 'No retry'}</span>
                    </div>
                  </div>
                  <div className="wh-card-actions" ref={openMenu === wh.id ? menuRef : null}>
                    <button className="wh-menu-btn" onClick={() => setOpenMenu(openMenu === wh.id ? null : wh.id)}>
                      <MoreVertical size={18} />
                    </button>
                    {openMenu === wh.id && (
                      <div className="wh-dropdown">
                        <div className="wh-dropdown-item" onClick={() => { testWebhook(wh.id); setOpenMenu(null); }}><Send size={13} /> Test</div>
                        <div className="wh-dropdown-item" onClick={() => handleEdit(wh)}><Edit size={13} /> Edit</div>
                        <div className="wh-dropdown-item" onClick={() => { viewDeliveries(wh); setOpenMenu(null); }}><Clock size={13} /> History</div>
                        <div className="wh-dropdown-item" onClick={() => { toggleWebhook(wh.id, wh.enabled); setOpenMenu(null); }}>
                          {wh.enabled ? <><EyeOff size={13} /> Disable</> : <><Eye size={13} /> Enable</>}
                        </div>
                        <div className="wh-dropdown-sep" />
                        <div className="wh-dropdown-item wh-dropdown-danger" onClick={() => { deleteWebhook(wh.id); setOpenMenu(null); }}>
                          <Trash2 size={13} /> Delete
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Template Picker */}
          {showTemplates && <TemplatePicker onSelect={handleTemplateSelect} onClose={() => setShowTemplates(false)} />}

          {/* Create Webhook */}
          {showCreate && (
            <WebhookFormModal
              initial={createDefaults}
              events={allEvents}
              eventDescriptions={eventTypes}
              servers={servers}
              onSave={addWebhook}
              onClose={() => setShowCreate(false)}
              title="Create Webhook"
            />
          )}

          {/* Edit Webhook */}
          {editingWh && (
            <WebhookFormModal
              initial={{
                event: editingWh.event,
                url: editingWh.url,
                template: editingWh.template || '',
                retryEnabled: editingWh.retryEnabled,
                retryCount: editingWh.retryCount || 3,
                events: editingWh.events || [],
                serverIds: editingWh.serverIds || [],
              }}
              events={allEvents}
              eventDescriptions={eventTypes}
              servers={servers}
              onSave={updateWebhook}
              onClose={() => setEditingWh(null)}
              title="Edit Webhook"
            />
          )}
        </div>
      )}

      {tab === 'deliveries' && (
        <div>
          {selectedWh && (
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => setTab('webhooks')}>&larr; Back</button>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Deliveries for <strong>{selectedWh.event}</strong></span>
            </div>
          )}
          {deliveries.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Send size={48} /></div>
              <div className="empty-title">No Deliveries Yet</div>
              <p>Test your webhook to see delivery history here.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Time</th><th>Event</th><th>Status</th><th>Attempt</th><th>Idempotence</th><th>Error</th></tr>
                </thead>
                <tbody>
                  {deliveries.map((d, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(d.timestamp).toLocaleString()}</td>
                      <td><span className={`wh-event-chip ${EVENT_BADGE_CLASS(d.event)}`}>{d.event}</span></td>
                      <td>
                        <span className={`status-badge ${d.status === 'success' ? 'status-running' : 'status-crashed'}`}>
                          <span className="status-dot" />{d.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{d.attempt || '\u2014'}</td>
                      <td style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.idempotenceToken || ''}>{d.idempotenceToken ? d.idempotenceToken.substring(0, 8) + '...' : '\u2014'}</td>
                      <td style={{ fontSize: 12, color: 'var(--accent-red)' }}>{d.error || '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
