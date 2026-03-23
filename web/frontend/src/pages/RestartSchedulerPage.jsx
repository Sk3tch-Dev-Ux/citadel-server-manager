import { useState, useEffect, useRef, useCallback } from 'react';
import API from '../api';
import { Clock, Play, Square, RefreshCw, Plus, Trash2, X, Check, AlertTriangle, Calendar, Zap } from '../components/Icon';

const INTERVAL_OPTIONS = [
  { value: 0.5, label: '30 Minutes' },
  { value: 1, label: '1 Hour' },
  { value: 2, label: '2 Hours' },
  { value: 3, label: '3 Hours' },
  { value: 4, label: '4 Hours' },
  { value: 6, label: '6 Hours' },
  { value: 8, label: '8 Hours' },
  { value: 12, label: '12 Hours' },
  { value: 24, label: '24 Hours' },
];

const DEFAULT_WARNINGS = [
  { minutesBefore: 30, message: 'SERVER RESTART IN {time}! Please find a safe location.' },
  { minutesBefore: 15, message: 'SERVER RESTART IN {time}! Find safety now!' },
  { minutesBefore: 5,  message: 'RESTART IN {time}! Get to safety!' },
  { minutesBefore: 1,  message: 'RESTARTING IN 1 MINUTE! Find cover immediately!' },
];

function formatCountdown(seconds) {
  if (seconds == null || seconds <= 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDateTime(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString();
}

function timeAgo(iso) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function RestartSchedulerPage({ serverId }) {
  const [schedule, setSchedule] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const countdownRef = useRef(null);

  // Form state
  const [formType, setFormType] = useState('interval');
  const [formInterval, setFormInterval] = useState(4);
  const [formDailyTimes, setFormDailyTimes] = useState(['00:00', '06:00', '12:00', '18:00']);
  const [formOneTimeDate, setFormOneTimeDate] = useState('');
  const [formWarnings, setFormWarnings] = useState(DEFAULT_WARNINGS);
  const [formEnabled, setFormEnabled] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  // New warning input
  const [newWarningMinutes, setNewWarningMinutes] = useState(10);
  const [newWarningMsg, setNewWarningMsg] = useState('Server restart in {time}!');

  // Trigger restart modal
  const [showTriggerModal, setShowTriggerModal] = useState(false);
  const [triggerDelay, setTriggerDelay] = useState(5);

  const loadData = useCallback(async () => {
    try {
      const [scheduleRes, statusRes] = await Promise.all([
        API.get(`/api/servers/${serverId}/restart-schedule`),
        API.get(`/api/servers/${serverId}/restart-schedule/status`),
      ]);

      if (scheduleRes.schedule) {
        const s = scheduleRes.schedule;
        setSchedule(s);
        setFormType(s.type || 'interval');
        setFormInterval(s.intervalHours || 4);
        setFormDailyTimes(s.dailyTimes || ['00:00', '06:00', '12:00', '18:00']);
        setFormOneTimeDate(s.oneTimeDate ? new Date(s.oneTimeDate).toISOString().slice(0, 16) : '');
        setFormWarnings(s.warnings || DEFAULT_WARNINGS);
        setFormEnabled(s.enabled);
      }

      setStatus(statusRes);
      if (statusRes.countdown != null && statusRes.countdown > 0) {
        setCountdown(statusRes.countdown);
      }
    } catch (err) {
      // Server may not have a schedule yet
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Live countdown timer
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (countdown != null && countdown > 0) {
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev == null || prev <= 1) {
            clearInterval(countdownRef.current);
            // Refresh data after restart
            setTimeout(loadData, 3000);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [countdown, loadData]);

  // Poll status every 30s
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const statusRes = await API.get(`/api/servers/${serverId}/restart-schedule/status`);
        setStatus(statusRes);
        if (statusRes.countdown != null && statusRes.countdown > 0) {
          setCountdown(statusRes.countdown);
        }
      } catch { /* ignore */ }
    }, 30000);
    return () => clearInterval(poll);
  }, [serverId]);

  // ─── Handlers ─────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        type: formType,
        enabled: formEnabled,
        warnings: formWarnings,
      };

      if (formType === 'interval') {
        payload.intervalHours = Number(formInterval);
      } else if (formType === 'daily') {
        payload.dailyTimes = formDailyTimes.filter(Boolean);
      } else if (formType === 'onetime') {
        if (!formOneTimeDate) {
          window.addToast('Please select a date and time for the one-time restart', 'error');
          setSaving(false);
          return;
        }
        payload.oneTimeDate = new Date(formOneTimeDate).toISOString();
      }

      const result = await API.put(`/api/servers/${serverId}/restart-schedule`, payload);
      if (result.error) {
        window.addToast(result.error, 'error');
      } else {
        window.addToast('Restart schedule saved', 'success');
        setSchedule(result.schedule);
        setHasChanges(false);
        loadData();
      }
    } catch (err) {
      window.addToast('Failed to save schedule', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    try {
      const result = await API.post(`/api/servers/${serverId}/restart-schedule/toggle`);
      if (result.error) {
        window.addToast(result.error, 'error');
      } else {
        const enabled = result.schedule?.enabled;
        window.addToast(`Scheduler ${enabled ? 'enabled' : 'disabled'}`, 'success');
        setFormEnabled(enabled);
        loadData();
      }
    } catch (err) {
      window.addToast('Failed to toggle schedule', 'error');
    }
  };

  const handleSkip = async () => {
    try {
      const result = await API.post(`/api/servers/${serverId}/restart-schedule/skip`);
      if (result.error) {
        window.addToast(result.error, 'error');
      } else {
        window.addToast('Next restart skipped', 'success');
        loadData();
      }
    } catch (err) {
      window.addToast('Failed to skip restart', 'error');
    }
  };

  const handleTrigger = async (delay) => {
    try {
      const result = await API.post(`/api/servers/${serverId}/restart-schedule/trigger`, {
        delayMinutes: delay,
      });
      if (result.error) {
        window.addToast(result.error, 'error');
      } else {
        window.addToast(result.message || 'Restart triggered', 'success');
        setShowTriggerModal(false);
        loadData();
      }
    } catch (err) {
      window.addToast('Failed to trigger restart', 'error');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete the restart schedule for this server?')) return;
    try {
      const result = await API.del(`/api/servers/${serverId}/restart-schedule`);
      if (result.error) {
        window.addToast(result.error, 'error');
      } else {
        window.addToast('Schedule deleted', 'success');
        setSchedule(null);
        setStatus(null);
        setCountdown(null);
        setFormType('interval');
        setFormInterval(4);
        setFormDailyTimes(['00:00', '06:00', '12:00', '18:00']);
        setFormOneTimeDate('');
        setFormWarnings(DEFAULT_WARNINGS);
        setFormEnabled(true);
        setHasChanges(false);
      }
    } catch (err) {
      window.addToast('Failed to delete schedule', 'error');
    }
  };

  // ─── Warning management ───────────────────────────────

  const addWarning = () => {
    if (formWarnings.some(w => w.minutesBefore === newWarningMinutes)) {
      window.addToast(`Warning at ${newWarningMinutes} minutes already exists`, 'error');
      return;
    }
    const updated = [...formWarnings, { minutesBefore: newWarningMinutes, message: newWarningMsg }]
      .sort((a, b) => b.minutesBefore - a.minutesBefore);
    setFormWarnings(updated);
    setHasChanges(true);
    setNewWarningMinutes(10);
    setNewWarningMsg('Server restart in {time}!');
  };

  const removeWarning = (idx) => {
    setFormWarnings(formWarnings.filter((_, i) => i !== idx));
    setHasChanges(true);
  };

  // ─── Daily time management ────────────────────────────

  const addDailyTime = () => {
    setFormDailyTimes([...formDailyTimes, '12:00']);
    setHasChanges(true);
  };

  const removeDailyTime = (idx) => {
    setFormDailyTimes(formDailyTimes.filter((_, i) => i !== idx));
    setHasChanges(true);
  };

  const updateDailyTime = (idx, val) => {
    const updated = [...formDailyTimes];
    updated[idx] = val;
    setFormDailyTimes(updated);
    setHasChanges(true);
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading scheduler...</div>;
  }

  const isActive = schedule?.enabled && status?.active;
  const history = status?.history || [];

  return (
    <div style={{ padding: '0 0 40px', maxWidth: 900 }}>
      {/* ─── Status Card ──────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Clock size={20} style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }} />
            <h3 style={{ margin: 0, fontSize: 16 }}>Restart Scheduler</h3>
            <span className={`status-badge status-${isActive ? 'running' : 'stopped'}`} style={{ fontSize: 11 }}>
              <span className="status-dot" />
              {isActive ? 'Active' : schedule ? 'Paused' : 'Not Configured'}
            </span>
          </div>
          {schedule && (
            <button
              className={`btn btn-sm ${isActive ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleToggle}
              style={{ minWidth: 80 }}
            >
              {isActive ? <><Square size={12} /> Disable</> : <><Play size={12} /> Enable</>}
            </button>
          )}
        </div>

        {/* Countdown display */}
        {isActive && countdown != null && countdown > 0 && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '16px 20px',
            textAlign: 'center',
            marginBottom: 12,
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Next Restart In
            </div>
            <div style={{
              fontFamily: 'monospace',
              fontSize: 36,
              fontWeight: 700,
              color: countdown < 300 ? '#ef4444' : countdown < 1800 ? '#f59e0b' : 'var(--accent)',
              lineHeight: 1,
            }}>
              {formatCountdown(countdown)}
            </div>
            {status?.nextRestart && (
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
                {formatDateTime(status.nextRestart)}
              </div>
            )}
          </div>
        )}

        {/* Quick stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 2 }}>Schedule Type</div>
            <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{schedule?.type || 'None'}</div>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 2 }}>Last Restart</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{schedule?.lastRestart ? timeAgo(schedule.lastRestart) : 'Never'}</div>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 2 }}>Warnings Sent</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{status?.warningsSent?.length || 0}</div>
          </div>
        </div>
      </div>

      {/* ─── Quick Actions ────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-muted)' }}>Quick Actions</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleSkip}
            disabled={!isActive}
            title="Skip the next scheduled restart"
          >
            <RefreshCw size={13} /> Skip Next
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowTriggerModal(true)}
            title="Restart with warning countdown"
          >
            <Zap size={13} /> Restart With Warnings
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => handleTrigger(0)}
            title="Restart immediately, no warnings"
          >
            <AlertTriangle size={13} /> Restart Now
          </button>
          {schedule && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleDelete}
              style={{ marginLeft: 'auto', color: '#ef4444' }}
            >
              <Trash2 size={13} /> Delete Schedule
            </button>
          )}
        </div>
      </div>

      {/* ─── Schedule Configuration ───────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Schedule Configuration</h3>

        {/* Type selector */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>Schedule Type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { value: 'interval', label: 'Interval', icon: <RefreshCw size={14} /> },
              { value: 'daily', label: 'Daily Times', icon: <Clock size={14} /> },
              { value: 'onetime', label: 'One-Time', icon: <Calendar size={14} /> },
            ].map(opt => (
              <button
                key={opt.value}
                className={`btn btn-sm ${formType === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setFormType(opt.value); setHasChanges(true); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Interval config */}
        {formType === 'interval' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>
              Restart Every
            </label>
            <select
              className="input"
              value={formInterval}
              onChange={e => { setFormInterval(Number(e.target.value)); setHasChanges(true); }}
              style={{ width: 200 }}
            >
              {INTERVAL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Daily times config */}
        {formType === 'daily' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>
              Restart Times (local time)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {formDailyTimes.map((time, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="time"
                    className="input"
                    value={time}
                    onChange={e => updateDailyTime(idx, e.target.value)}
                    style={{ width: 140 }}
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => removeDailyTime(idx)}
                    disabled={formDailyTimes.length <= 1}
                    style={{ padding: '4px 8px' }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button className="btn btn-secondary btn-sm" onClick={addDailyTime} style={{ width: 'fit-content' }}>
                <Plus size={12} /> Add Time
              </button>
            </div>
          </div>
        )}

        {/* One-time config */}
        {formType === 'onetime' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>
              Restart Date & Time
            </label>
            <input
              type="datetime-local"
              className="input"
              value={formOneTimeDate}
              onChange={e => { setFormOneTimeDate(e.target.value); setHasChanges(true); }}
              style={{ width: 260 }}
            />
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: 8 }}
        >
          {saving ? 'Saving...' : schedule ? 'Update Schedule' : 'Create Schedule'}
        </button>
      </div>

      {/* ─── Warning Messages ─────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Warning Messages</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 14px' }}>
          Messages sent to players via RCON before each restart. Use <code style={{ background: 'var(--bg-card)', padding: '1px 4px', borderRadius: 3 }}>{'{time}'}</code> for
          countdown and <code style={{ background: 'var(--bg-card)', padding: '1px 4px', borderRadius: 3 }}>{'{server_name}'}</code> for server name.
        </p>

        {/* Existing warnings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {formWarnings.map((w, idx) => (
            <div key={idx} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '8px 12px',
            }}>
              <div style={{
                background: 'var(--bg-main)', borderRadius: 4, padding: '2px 8px',
                fontWeight: 600, fontSize: 12, minWidth: 50, textAlign: 'center',
                color: w.minutesBefore <= 5 ? '#ef4444' : w.minutesBefore <= 15 ? '#f59e0b' : 'var(--accent)',
              }}>
                {w.minutesBefore}m
              </div>
              <div style={{ flex: 1, fontSize: 13 }}>{w.message}</div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => removeWarning(idx)}
                style={{ padding: '3px 6px' }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* Add new warning */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }}>Minutes Before</label>
            <input
              type="number"
              className="input"
              value={newWarningMinutes}
              onChange={e => setNewWarningMinutes(Number(e.target.value))}
              min={1}
              max={120}
              style={{ width: 80 }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }}>Message</label>
            <input
              type="text"
              className="input"
              value={newWarningMsg}
              onChange={e => setNewWarningMsg(e.target.value)}
              placeholder="Server restart in {time}!"
              style={{ width: '100%' }}
            />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={addWarning} style={{ marginBottom: 1 }}>
            <Plus size={12} /> Add
          </button>
        </div>

        {hasChanges && (
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {/* ─── Restart History ──────────────────────────────── */}
      <div className="card">
        <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Restart History</h3>
        {history.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
            No restart history yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.slice(0, 10).map((entry, idx) => (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '8px 12px', fontSize: 13,
              }}>
                <RefreshCw size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ color: 'var(--text-muted)', minWidth: 120 }}>
                  {formatDateTime(entry.timestamp)}
                </span>
                <span style={{
                  background: 'var(--bg-main)', borderRadius: 4, padding: '1px 6px',
                  fontSize: 11, textTransform: 'capitalize',
                }}>
                  {entry.type}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {entry.triggeredBy}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Trigger Modal ────────────────────────────────── */}
      {showTriggerModal && (
        <div className="modal-overlay" onClick={() => setShowTriggerModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: 16 }}>Restart With Warnings</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowTriggerModal(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>
              <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>
                Delay before restart (minutes)
              </label>
              <input
                type="number"
                className="input"
                value={triggerDelay}
                onChange={e => setTriggerDelay(Number(e.target.value))}
                min={1}
                max={120}
                style={{ width: '100%', marginBottom: 12 }}
              />
              <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 16px' }}>
                Warning messages will be sent to players at configured intervals before the restart.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowTriggerModal(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleTrigger(triggerDelay)}
                >
                  <Play size={12} /> Start Countdown
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
