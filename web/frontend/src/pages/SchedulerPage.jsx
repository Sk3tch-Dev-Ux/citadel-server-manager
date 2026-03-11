import { useState, useEffect, useCallback, useRef } from 'react';
import API from '../api';
import { useServers } from '../contexts/ServersContext';
import { Modal, Toggle, EmptyState, Button, Input, FormField } from '../components/ui';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import PageLoader from '../components/PageLoader';
import { Clock, Plus, Trash2, Edit, Check, X, AlertTriangle, Lock, Power, RotateCcw, Square, Play, Download, Save, Terminal, Webhook, Server, ChevronDown } from '../components/Icon';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_WARNINGS = [15, 10, 5, 1];

const ACTION_TYPES = [
  { value: 'restart',      label: 'Restart',      icon: RotateCcw, description: 'Restart the server via RCON' },
  { value: 'stop',         label: 'Stop',         icon: Square,    description: 'Stop the server (kill process)' },
  { value: 'start',        label: 'Start',        icon: Play,      description: 'Start the server if stopped' },
  { value: 'update',       label: 'Update',       icon: Download,  description: 'Trigger a game update' },
  { value: 'backup',       label: 'Backup',       icon: Save,      description: 'Create a server backup' },
  { value: 'rcon_command',  label: 'RCON Command', icon: Terminal,  description: 'Execute an RCON command' },
  { value: 'webhook',      label: 'Webhook',      icon: Webhook,   description: 'Fire a custom webhook event' },
];

function getActionMeta(action) {
  return ACTION_TYPES.find(a => a.value === action) || ACTION_TYPES[0];
}

function formatTime(hour, minute) {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return `${h}:${m}`;
}

function formatLastExec(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString();
}

// ─── Job Card ─────────────────────────────────────────────
function JobCard({ job, onToggle, onEdit, onDelete }) {
  const allDays = !job.daysOfWeek || job.daysOfWeek.length === 7;
  const actionMeta = getActionMeta(job.action || 'restart');
  const ActionIcon = actionMeta.icon;

  return (
    <div className={`scheduler-card ${!job.enabled ? 'scheduler-card--disabled' : ''}`}>
      <div className="scheduler-card-header">
        <div className="scheduler-card-title-row">
          <span className={`scheduler-status-dot ${job.enabled ? 'active' : ''}`} />
          <h3 className="scheduler-card-title">{job.title}</h3>
        </div>
        <div className="scheduler-card-actions">
          <button className="btn btn-icon btn-ghost" onClick={() => onEdit(job)} title="Edit"><Edit size={14} /></button>
          <button className="btn btn-icon btn-ghost btn-danger-ghost" onClick={() => onDelete(job)} title="Delete"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="scheduler-card-body">
        <div className="scheduler-card-time">
          <Clock size={16} />
          <span className="scheduler-time-value">{formatTime(job.hour, job.minute)}</span>
          {job.useUptime && <span className="scheduler-badge scheduler-badge--uptime">Uptime</span>}
          {!job.useUptime && <span className="scheduler-badge scheduler-badge--clock">Wall Clock</span>}
        </div>

        <div className="scheduler-day-chips">
          {DAYS.map((day, i) => (
            <span key={day} className={`scheduler-day-chip ${allDays || (job.daysOfWeek && job.daysOfWeek.includes(i)) ? 'active' : ''}`}>
              {day}
            </span>
          ))}
        </div>

        <div className="scheduler-card-meta">
          {job.warningMinutes && job.warningMinutes.length > 0 && (
            <span className="scheduler-meta-item" title="Warning broadcasts">
              <AlertTriangle size={12} />
              {job.warningMinutes.join(', ')}m
            </span>
          )}
          {job.lockServer && (
            <span className="scheduler-meta-item" title={`Lock ${job.lockMinutesBefore || 2}m before`}>
              <Lock size={12} />
              Lock {job.lockMinutesBefore || 2}m
            </span>
          )}
          {job.kickPlayers && (
            <span className="scheduler-meta-item" title={`Kick ${job.kickMinutesBefore || 1}m before`}>
              <Power size={12} />
              Kick {job.kickMinutesBefore || 1}m
            </span>
          )}
          {job.action === 'rcon_command' && job.rconCommand && (
            <span className="scheduler-meta-item" title={`RCON: ${job.rconCommand}`}>
              <Terminal size={12} />
              {job.rconCommand}
            </span>
          )}
          {job.action === 'webhook' && job.webhookEvent && (
            <span className="scheduler-meta-item" title={`Event: ${job.webhookEvent}`}>
              <Webhook size={12} />
              {job.webhookEvent}
            </span>
          )}
          <span className="scheduler-meta-item scheduler-meta-item--last">
            Last: {formatLastExec(job.lastExecutedAt)}
          </span>
        </div>
      </div>

      <div className="scheduler-card-footer">
        <span className="scheduler-action-badge" title={actionMeta.description}>
          <ActionIcon size={12} />
          {actionMeta.label}
        </span>
        <Toggle checked={job.enabled} onCheckedChange={() => onToggle(job)} />
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

// ─── Create/Edit Modal ───────────────────────────────────
function JobModal({ open, onClose, onSave, editingJob, servers, currentServerId }) {
  const isEdit = !!editingJob;
  const [title, setTitle] = useState('');
  const [hour, setHour] = useState(4);
  const [minute, setMinute] = useState(0);
  const [action, setAction] = useState('restart');
  const [rconCommand, setRconCommand] = useState('');
  const [webhookEvent, setWebhookEvent] = useState('');
  const [daysOfWeek, setDaysOfWeek] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [useUptime, setUseUptime] = useState(false);
  const [warningMinutes, setWarningMinutes] = useState([...DEFAULT_WARNINGS]);
  const [warningMessage, setWarningMessage] = useState('Server restart in {minutes} minute(s)!');
  const [lockServer, setLockServer] = useState(false);
  const [lockMinutesBefore, setLockMinutesBefore] = useState(2);
  const [kickPlayers, setKickPlayers] = useState(false);
  const [kickMinutesBefore, setKickMinutesBefore] = useState(1);
  const [warningInput, setWarningInput] = useState('');
  const [additionalServerIds, setAdditionalServerIds] = useState([]);

  useEffect(() => {
    if (editingJob) {
      setTitle(editingJob.title || '');
      setHour(editingJob.hour ?? 4);
      setMinute(editingJob.minute ?? 0);
      setAction(editingJob.action || 'restart');
      setRconCommand(editingJob.rconCommand || '');
      setWebhookEvent(editingJob.webhookEvent || '');
      setDaysOfWeek(editingJob.daysOfWeek || [0, 1, 2, 3, 4, 5, 6]);
      setUseUptime(!!editingJob.useUptime);
      setWarningMinutes(editingJob.warningMinutes || [...DEFAULT_WARNINGS]);
      setWarningMessage(editingJob.warningMessage || 'Server restart in {minutes} minute(s)!');
      setLockServer(!!editingJob.lockServer);
      setLockMinutesBefore(editingJob.lockMinutesBefore || 2);
      setKickPlayers(!!editingJob.kickPlayers);
      setKickMinutesBefore(editingJob.kickMinutesBefore || 1);
    } else {
      setTitle('');
      setHour(4);
      setMinute(0);
      setAction('restart');
      setRconCommand('');
      setWebhookEvent('');
      setDaysOfWeek([0, 1, 2, 3, 4, 5, 6]);
      setUseUptime(false);
      setWarningMinutes([...DEFAULT_WARNINGS]);
      setWarningMessage('Server restart in {minutes} minute(s)!');
      setLockServer(false);
      setLockMinutesBefore(2);
      setKickPlayers(false);
      setKickMinutesBefore(1);
    }
    setWarningInput('');
    setAdditionalServerIds([]);
  }, [editingJob, open]);

  const toggleDay = (dayIndex) => {
    setDaysOfWeek(prev =>
      prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex].sort()
    );
  };

  const addWarning = () => {
    const val = parseInt(warningInput, 10);
    if (val > 0 && !warningMinutes.includes(val)) {
      setWarningMinutes(prev => [...prev, val].sort((a, b) => b - a));
      setWarningInput('');
    }
  };

  const removeWarning = (val) => {
    setWarningMinutes(prev => prev.filter(m => m !== val));
  };

  const handleSave = () => {
    if (!title.trim()) { window.addToast?.('Title is required', 'error'); return; }
    if (action === 'rcon_command' && !rconCommand.trim()) { window.addToast?.('RCON command is required', 'error'); return; }
    onSave({
      ...(editingJob ? { id: editingJob.id } : {}),
      title: title.trim(), hour, minute, action, daysOfWeek, useUptime,
      warningMinutes, warningMessage, lockServer, lockMinutesBefore, kickPlayers, kickMinutesBefore,
      ...(action === 'rcon_command' ? { rconCommand: rconCommand.trim() } : {}),
      ...(action === 'webhook' ? { webhookEvent: webhookEvent.trim() } : {}),
      additionalServerIds,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Scheduled Job' : 'New Scheduled Job'}>
      <div className="scheduler-modal-form">
        <FormField label="Job Title">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Morning Restart" />
        </FormField>

        <div className="scheduler-modal-row">
          <FormField label="Hour (0-23)">
            <Input type="number" min={0} max={23} value={hour} onChange={e => setHour(parseInt(e.target.value, 10) || 0)} />
          </FormField>
          <FormField label="Minute (0-59)">
            <Input type="number" min={0} max={59} value={minute} onChange={e => setMinute(parseInt(e.target.value, 10) || 0)} />
          </FormField>
          <FormField label="Action">
            <select className="input" value={action} onChange={e => setAction(e.target.value)}>
              {ACTION_TYPES.map(at => (
                <option key={at.value} value={at.value}>{at.label}</option>
              ))}
            </select>
            <span className="form-hint">{getActionMeta(action).description}</span>
          </FormField>
        </div>

        {action === 'rcon_command' && (
          <FormField label="RCON Command">
            <Input value={rconCommand} onChange={e => setRconCommand(e.target.value)} placeholder="e.g. say -1 Server maintenance in progress" />
            <span className="form-hint">The raw RCON command to execute on the server</span>
          </FormField>
        )}

        {action === 'webhook' && (
          <FormField label="Webhook Event Name">
            <Input value={webhookEvent} onChange={e => setWebhookEvent(e.target.value)} placeholder="e.g. scheduler.custom" />
            <span className="form-hint">Custom event name fired to configured webhook endpoints (defaults to scheduler.custom)</span>
          </FormField>
        )}

        <FormField label="Days of Week">
          <div className="scheduler-day-chips scheduler-day-chips--edit">
            {DAYS.map((day, i) => (
              <button key={day} type="button" className={`scheduler-day-chip ${daysOfWeek.includes(i) ? 'active' : ''}`} onClick={() => toggleDay(i)}>
                {day}
              </button>
            ))}
          </div>
        </FormField>

        <div className="scheduler-modal-toggles">
          <div className="switch-row">
            <span>Use server uptime instead of wall clock</span>
            <Toggle checked={useUptime} onCheckedChange={setUseUptime} />
          </div>
          <div className="switch-row">
            <span>Lock server before restart</span>
            <Toggle checked={lockServer} onCheckedChange={setLockServer} />
          </div>
          {lockServer && (
            <FormField label="Lock minutes before">
              <Input type="number" min={1} max={30} value={lockMinutesBefore} onChange={e => setLockMinutesBefore(parseInt(e.target.value, 10) || 2)} />
            </FormField>
          )}
          <div className="switch-row">
            <span>Kick players before restart</span>
            <Toggle checked={kickPlayers} onCheckedChange={setKickPlayers} />
          </div>
          {kickPlayers && (
            <FormField label="Kick minutes before">
              <Input type="number" min={1} max={30} value={kickMinutesBefore} onChange={e => setKickMinutesBefore(parseInt(e.target.value, 10) || 1)} />
            </FormField>
          )}
        </div>

        <FormField label="Warning Broadcasts (minutes before)">
          <div className="scheduler-warning-chips">
            {warningMinutes.map(m => (
              <span key={m} className="chip">
                {m}m
                <button className="chip-remove" onClick={() => removeWarning(m)}><X size={10} /></button>
              </span>
            ))}
            <div className="scheduler-warning-add">
              <Input type="number" min={1} placeholder="min" value={warningInput} onChange={e => setWarningInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addWarning()} style={{ width: 70 }} />
              <button className="btn btn-sm btn-secondary" onClick={addWarning}><Plus size={12} /></button>
            </div>
          </div>
        </FormField>

        <FormField label="Warning Message">
          <Input value={warningMessage} onChange={e => setWarningMessage(e.target.value)} placeholder="Server restart in {minutes} minute(s)!" />
          <span className="form-hint">Use {'{minutes}'} as a placeholder</span>
        </FormField>

        {!isEdit && servers && servers.length > 1 && (
          <FormField label="Also create on other servers">
            <ServerSelect
              servers={servers.filter(s => s.id !== currentServerId)}
              selected={additionalServerIds}
              onChange={setAdditionalServerIds}
            />
            <span className="form-hint">Optionally copy this job to additional servers</span>
          </FormField>
        )}

        <div className="scheduler-modal-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>
            {isEdit ? <><Check size={14} /> Save Changes</> : <><Plus size={14} /> Create Job</>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────
export default function SchedulerPage({ serverId }) {
  const { servers } = useServers();
  const { confirm: confirmDialog, DialogComponent } = useConfirmDialog();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState(null);

  const loadJobs = useCallback(async () => {
    try {
      const data = await API.get(`/api/servers/${serverId}/scheduler`);
      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
    } catch { setJobs([]); }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const handleToggle = async (job) => {
    try {
      const updated = await API.patch(`/api/servers/${serverId}/scheduler/${job.id}/toggle`);
      setJobs(prev => prev.map(j => j.id === job.id ? updated : j));
    } catch { window.addToast?.('Failed to toggle job', 'error'); }
  };

  const handleDelete = async (job) => {
    if (!await confirmDialog({ title: 'Delete Job', message: `Delete "${job.title}"?`, confirmLabel: 'Delete', variant: 'danger' })) return;
    try {
      await API.del(`/api/servers/${serverId}/scheduler/${job.id}`);
      setJobs(prev => prev.filter(j => j.id !== job.id));
      window.addToast?.('Job deleted', 'success');
    } catch { window.addToast?.('Failed to delete job', 'error'); }
  };

  const handleEdit = (job) => {
    setEditingJob(job);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditingJob(null);
    setModalOpen(true);
  };

  const handleSave = async (data) => {
    const { additionalServerIds, ...jobData } = data;
    try {
      if (jobData.id) {
        const updated = await API.put(`/api/servers/${serverId}/scheduler/${jobData.id}`, jobData);
        setJobs(prev => prev.map(j => j.id === jobData.id ? updated : j));
        window.addToast?.('Job updated', 'success');
      } else {
        const created = await API.post(`/api/servers/${serverId}/scheduler`, jobData);
        setJobs(prev => [...prev, created]);

        // Copy to additional servers
        let copied = 0;
        for (const extraId of (additionalServerIds || [])) {
          try {
            await API.post(`/api/servers/${extraId}/scheduler`, jobData);
            copied++;
          } catch { /* silent — some servers may not be available */ }
        }

        const msg = copied > 0 ? `Job created (+ copied to ${copied} server${copied !== 1 ? 's' : ''})` : 'Job created';
        window.addToast?.(msg, 'success');
      }
      setModalOpen(false);
      setEditingJob(null);
    } catch { window.addToast?.('Failed to save job', 'error'); }
  };

  if (loading) return <PageLoader message="Loading scheduler..." />;

  return (
    <div className="scheduler-page">
      <div className="scheduler-header">
        <div>
          <p className="scheduler-description">
            Schedule automated server actions — restarts, stops, starts, updates, backups, RCON commands, and webhooks.
          </p>
        </div>
        <Button variant="primary" onClick={handleCreate}><Plus size={14} /> New Job</Button>
      </div>

      {jobs.length === 0 ? (
        <EmptyState icon={<Clock size={48} />} title="No Scheduled Jobs" description="Create your first scheduled job to automate server restarts, backups, updates, and more." action={<Button variant="primary" onClick={handleCreate}><Plus size={14} /> Create Job</Button>} />
      ) : (
        <div className="scheduler-grid">
          {jobs.map(job => (
            <JobCard key={job.id} job={job} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <JobModal open={modalOpen} onClose={() => { setModalOpen(false); setEditingJob(null); }} onSave={handleSave} editingJob={editingJob} servers={servers} currentServerId={serverId} />

      {DialogComponent}
    </div>
  );
}
