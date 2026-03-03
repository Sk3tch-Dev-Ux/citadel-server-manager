import { useState, useEffect, useCallback } from 'react';
import API from '../api';
import { Shield, AlertTriangle, Loader, CheckCircle, Gamepad2, Settings, Save, Eye, EyeOff, Lock, Info } from '../components/Icon';

// ─── Section labels for display ───────────────────────────
const SECTION_LABELS = {
  server: 'Server',
  auth: 'Authentication',
  steam: 'Steam',
  directories: 'Directories',
  logging: 'Logging',
  backups: 'Backups',
  polling: 'Polling Intervals',
};

// Section icons mapping
const SECTION_ICONS = {
  server: Settings,
  auth: Shield,
  steam: Gamepad2,
  directories: Settings,
  logging: Settings,
  backups: Settings,
  polling: Settings,
};

// ─── ConfigField Component ────────────────────────────────
function ConfigField({ section, fieldKey, def, value, envLocked, onChange }) {
  const [showPassword, setShowPassword] = useState(false);
  const isSensitive = def.sensitive;
  const isRedacted = isSensitive && value === '********';
  const fieldId = `${section}-${fieldKey}`;

  const renderInput = () => {
    if (def.type === 'boolean') {
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: envLocked ? 'not-allowed' : 'pointer' }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={e => onChange(e.target.checked)}
            disabled={envLocked || isRedacted}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{value ? 'Enabled' : 'Disabled'}</span>
        </label>
      );
    }

    if (def.enum) {
      return (
        <select
          className="input"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          disabled={envLocked || isRedacted}
          style={{ opacity: envLocked ? 0.6 : 1 }}
        >
          {def.enum.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }

    if (def.type === 'array') {
      return (
        <input
          className="input"
          value={Array.isArray(value) ? value.join(', ') : (value || '')}
          onChange={e => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          disabled={envLocked || isRedacted}
          placeholder={def.description || ''}
          style={{ opacity: envLocked ? 0.6 : 1 }}
        />
      );
    }

    if (isSensitive) {
      return (
        <div style={{ position: 'relative' }}>
          <input
            className="input"
            type={showPassword ? 'text' : 'password'}
            value={isRedacted ? '********' : (value || '')}
            disabled={true}
            style={{ opacity: 0.6, paddingRight: 36 }}
          />
          {!isRedacted && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
        </div>
      );
    }

    return (
      <input
        id={fieldId}
        className="input"
        type={def.type === 'number' ? 'number' : 'text'}
        value={value !== null && value !== undefined ? value : ''}
        onChange={e => {
          const v = def.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
          onChange(v);
        }}
        disabled={envLocked || isRedacted}
        placeholder={def.description || ''}
        min={def.min}
        max={def.max}
        style={{ opacity: envLocked ? 0.6 : 1 }}
      />
    );
  };

  return (
    <div className="input-group" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <label className="input-label" htmlFor={fieldId} style={{ margin: 0 }}>
          {fieldKey}
        </label>
        {envLocked && (
          <span title="This value is set via .env and cannot be changed here" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 4, padding: '1px 6px' }}>
            <Lock size={10} /> .env
          </span>
        )}
        {isSensitive && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>
            <Shield size={10} /> sensitive
          </span>
        )}
      </div>
      {renderInput()}
      {def.description && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Info size={10} style={{ flexShrink: 0 }} /> {def.description}
          {def.min !== undefined && def.max !== undefined && ` (${def.min}–${def.max})`}
        </div>
      )}
    </div>
  );
}

// ─── SystemConfigSection Component ────────────────────────
function SystemConfigSection() {
  const [config, setConfig] = useState(null);
  const [schema, setSchema] = useState(null);
  const [envOverrides, setEnvOverrides] = useState({});
  const [configFileLoaded, setConfigFileLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState({});
  const [editedConfig, setEditedConfig] = useState(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await API.get('/api/system/config');
      if (result.error) throw new Error(result.error);
      setConfig(result.config);
      setSchema(result.schema);
      setEnvOverrides(result.envOverrides || {});
      setConfigFileLoaded(result.configFileLoaded || false);
      setEditedConfig(JSON.parse(JSON.stringify(result.config)));
      setDirty({});
    } catch (err) {
      setError(err.message || 'Failed to load configuration');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const handleFieldChange = (section, key, value) => {
    setEditedConfig(prev => {
      const next = { ...prev, [section]: { ...prev[section], [key]: value } };
      return next;
    });
    setDirty(prev => ({ ...prev, [`${section}.${key}`]: true }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Build a partial update with only changed fields
      const updates = {};
      for (const key of Object.keys(dirty)) {
        const [section, field] = key.split('.');
        if (!updates[section]) updates[section] = {};
        updates[section][field] = editedConfig[section][field];
      }

      const result = await API.patch('/api/system/config', updates);
      if (result.error) throw new Error(result.error);

      if (result.needsRestart?.length > 0) {
        window.addToast?.(`Configuration saved. Restart required for: ${result.needsRestart.join(', ')}`, 'warning');
      } else {
        window.addToast?.('Configuration saved successfully', 'success');
      }

      // Refresh config from server
      await fetchConfig();
    } catch (err) {
      setError(err.message || 'Failed to save configuration');
    }
    setSaving(false);
  };

  const hasDirtyFields = Object.keys(dirty).length > 0;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
        <Loader size={24} /> Loading configuration...
      </div>
    );
  }

  if (error && !config) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 13, color: '#ef4444' }}>
        <AlertTriangle size={14} /> {error}
      </div>
    );
  }

  return (
    <div>
      {/* Header with save button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            {configFileLoaded ? (
              <span style={{ color: 'var(--accent-green)' }}>citadel.config.json loaded</span>
            ) : (
              <span>Using defaults (no citadel.config.json)</span>
            )}
          </div>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={!hasDirtyFields || saving}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Save size={14} />
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, marginBottom: 16, fontSize: 13, color: '#ef4444' }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Config sections */}
      {schema && Object.entries(schema).map(([section, fields]) => {
        const SectionIcon = SECTION_ICONS[section] || Settings;
        return (
          <div key={section} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <SectionIcon size={18} style={{ color: 'var(--accent-purple)' }} />
              <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, textTransform: 'capitalize' }}>
                {SECTION_LABELS[section] || section}
              </h4>
            </div>

            {Object.entries(fields).map(([fieldKey, def]) => (
              <ConfigField
                key={fieldKey}
                section={section}
                fieldKey={fieldKey}
                def={def}
                value={editedConfig?.[section]?.[fieldKey]}
                envLocked={!!envOverrides[section]?.[fieldKey]}
                onChange={value => handleFieldChange(section, fieldKey, value)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main SettingsPage Component ──────────────────────────
export default function SettingsPage() {
  // Steam state
  const [steamStatus, setSteamStatus] = useState(null);
  const [steamLoading, setSteamLoading] = useState(true);
  const [steamUsername, setSteamUsername] = useState('');
  const [steamPassword, setSteamPassword] = useState('');
  const [steamGuardCode, setSteamGuardCode] = useState('');
  const [steamError, setSteamError] = useState('');
  const [steamNeedsGuard, setSteamNeedsGuard] = useState(false);
  const [steamValidating, setSteamValidating] = useState(false);
  const [editing, setEditing] = useState(false);

  const fetchSteamStatus = useCallback(async () => {
    setSteamLoading(true);
    setSteamError('');
    try {
      const result = await API.get('/api/steam/status');
      setSteamStatus(result);
      if (result.username) setSteamUsername(result.username);
    } catch {
      setSteamStatus({ steamCmdReady: false, username: '', hasPassword: false, loginValidated: false });
    }
    setSteamLoading(false);
  }, []);

  useEffect(() => { fetchSteamStatus(); }, [fetchSteamStatus]);

  const validateSteamCredentials = async () => {
    if (!steamUsername || !steamPassword) {
      setSteamError('Username and password are required');
      return;
    }
    setSteamValidating(true);
    setSteamError('');
    try {
      const payload = { username: steamUsername, password: steamPassword };
      if (steamGuardCode) payload.guardCode = steamGuardCode;
      const result = await API.post('/api/steam/credentials', payload);
      if (result.success) {
        setSteamStatus(prev => ({ ...prev, username: steamUsername, hasPassword: true, loginValidated: true }));
        setSteamNeedsGuard(false);
        setSteamError('');
        setEditing(false);
        window.addToast(`Steam logged in as ${steamUsername}`, 'success');
      } else if (result.needsGuard) {
        setSteamNeedsGuard(true);
        setSteamError('Steam Guard code required — check your email or authenticator app.');
      } else {
        setSteamError(result.message || 'Login failed');
      }
    } catch (err) {
      setSteamError(err.message || 'Failed to validate credentials');
    }
    setSteamValidating(false);
  };

  const steamVerified = steamStatus?.loginValidated === true;

  return (
    <div style={{ maxWidth: 640 }}>
      {/* ─── Steam Section ─── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Gamepad2 size={20} style={{ color: 'var(--accent-purple)' }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Steam</h3>
        </div>

        <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Tip:</strong> For the smoothest experience, we recommend using a dedicated Steam account for server management with Steam Guard set to <strong>Email</strong> (not Mobile Authenticator). After your first login, SteamCMD caches the session so you won&apos;t need to re-enter a guard code each time.
        </div>

        {steamLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            <Loader size={24} /> Checking Steam status...
          </div>
        ) : steamVerified && !editing ? (
          /* Verified — show green status */
          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Shield size={28} style={{ color: 'var(--text-success, #22c55e)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Steam Connected</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Logged in as <strong>{steamStatus?.username}</strong></div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              <CheckCircle size={14} style={{ color: 'var(--accent-green)' }} />
              SteamCMD session cached — deployments and mod downloads will use this account automatically.
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(true); setSteamPassword(''); setSteamGuardCode(''); setSteamNeedsGuard(false); setSteamError(''); }}>
              Change Account
            </button>
          </div>
        ) : (
          /* Credential form */
          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
            {!steamStatus?.steamCmdReady && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(239,168,68,0.1)', border: '1px solid rgba(239,168,68,0.3)', borderRadius: 6, marginBottom: 16, fontSize: 13, color: '#f59e0b' }}>
                <AlertTriangle size={14} /> SteamCMD not found. Run the setup wizard first or configure it manually.
              </div>
            )}

            <div className="input-group">
              <label className="input-label">Steam Username</label>
              <input className="input" value={steamUsername} onChange={e => setSteamUsername(e.target.value)} placeholder="your_steam_username" autoComplete="off" />
            </div>
            <div className="input-group">
              <label className="input-label">Steam Password</label>
              <input className="input" type="password" value={steamPassword} onChange={e => setSteamPassword(e.target.value)} placeholder="your_steam_password" autoComplete="off" />
            </div>

            {steamNeedsGuard && (
              <div className="input-group">
                <label className="input-label">Steam Guard Code</label>
                <input className="input" value={steamGuardCode} onChange={e => setSteamGuardCode(e.target.value)} placeholder="XXXXX" maxLength={5} style={{ letterSpacing: '0.2em', textAlign: 'center', maxWidth: 140 }} autoComplete="off" />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Check your email or Steam mobile app for the code</div>
              </div>
            )}

            {steamError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, marginBottom: 12, fontSize: 13, color: '#ef4444' }}>
                <AlertTriangle size={14} /> {steamError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {editing && (
                <button className="btn btn-secondary" onClick={() => { setEditing(false); setSteamError(''); }}>
                  Cancel
                </button>
              )}
              <button className="btn btn-primary" onClick={validateSteamCredentials} disabled={steamValidating || !steamUsername || !steamPassword} style={{ flex: 1, justifyContent: 'center' }}>
                {steamValidating ? 'Verifying...' : (steamNeedsGuard ? 'Submit Guard Code' : 'Verify Steam Login')}
              </button>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
              Your credentials are stored locally and used only for SteamCMD operations. They are never sent to any third party.
            </div>
          </div>
        )}
      </div>

      {/* ─── System Configuration Section ─── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Settings size={20} style={{ color: 'var(--accent-purple)' }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>System Configuration</h3>
        </div>

        <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Note:</strong> Settings marked with <Lock size={10} style={{ verticalAlign: 'middle', margin: '0 2px' }} /> <strong>.env</strong> are controlled by environment variables and cannot be changed from this panel. Edit your <code>.env</code> file and restart to change them.
          Sensitive values (passwords, secrets) are redacted and must be configured via <code>.env</code>.
        </div>

        <SystemConfigSection />
      </div>
    </div>
  );
}
