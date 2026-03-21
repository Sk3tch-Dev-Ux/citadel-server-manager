import { useState, useEffect, useCallback } from 'react';
import API from '../api';

// ─── Constants ──────────────────────────────────────────────

const TABS = [
  { key: 'fresh', label: 'Fresh Spawns', desc: 'New character spawns (first spawn or after death)' },
  { key: 'hop', label: 'Hop Spawns', desc: 'Server hop spawns (when switching servers)' },
  { key: 'travel', label: 'Travel Spawns', desc: 'Travel spawns (when moving between servers)' },
];

const DEFAULT_POINT = { x: 0.0, z: 0.0 };

// ─── Main Component ─────────────────────────────────────────

export default function SpawnPointsEditorPage({ serverId }) {
  const [data, setData] = useState({ fresh: [], hop: [], travel: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('fresh');
  const [modified, setModified] = useState(false);

  // ─── Data Loading ───────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(`/api/servers/${serverId}/spawnpoints`);
      if (res.error) {
        window.addToast?.(res.error, 'error');
      } else {
        setData({
          fresh: res.fresh || [],
          hop: res.hop || [],
          travel: res.travel || [],
        });
        setModified(false);
      }
    } catch {
      window.addToast?.('Failed to load spawn points', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Keyboard Shortcut (Ctrl+S) ────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (modified && !saving) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // ─── Save ──────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await API.put(`/api/servers/${serverId}/spawnpoints`, data);
      if (res.error) {
        window.addToast?.(res.error, 'error');
      } else {
        window.addToast?.(`Saved ${res.totalCount} spawn points`, 'success');
        setModified(false);
      }
    } catch {
      window.addToast?.('Failed to save spawn points', 'error');
    }
    setSaving(false);
  };

  // ─── Point Editing ─────────────────────────────────────

  const updatePoint = (group, index, field, value) => {
    setData(prev => {
      const updated = { ...prev };
      updated[group] = [...prev[group]];
      updated[group][index] = { ...updated[group][index], [field]: parseFloat(value) || 0 };
      return updated;
    });
    setModified(true);
  };

  const addPoint = (group) => {
    setData(prev => ({
      ...prev,
      [group]: [...prev[group], { ...DEFAULT_POINT }],
    }));
    setModified(true);
  };

  const removePoint = (group, index) => {
    setData(prev => ({
      ...prev,
      [group]: prev[group].filter((_, i) => i !== index),
    }));
    setModified(true);
  };

  const copyFreshTo = (target) => {
    if (data.fresh.length === 0) {
      window.addToast?.('No fresh spawn points to copy', 'warning');
      return;
    }
    setData(prev => ({
      ...prev,
      [target]: prev.fresh.map(pt => ({ ...pt })),
    }));
    setModified(true);
    window.addToast?.(`Copied ${data.fresh.length} points from Fresh to ${target === 'hop' ? 'Hop' : 'Travel'}`, 'info');
  };

  // ─── Render ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading spawn points...
      </div>
    );
  }

  const activePoints = data[activeTab] || [];
  const activeTabInfo = TABS.find(t => t.key === activeTab);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div className="card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Player Spawn Points</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            cfgplayerspawnpoints.xml — {data.fresh.length + data.hop.length + data.travel.length} total points
            {modified && <span style={{ color: 'var(--warning)', marginLeft: 8 }}>(unsaved changes)</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={loadData} disabled={saving}>
            Reload
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !modified}>
            {saving ? 'Saving...' : 'Save'} (Ctrl+S)
          </button>
        </div>
      </div>

      {/* Tab Buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`btn btn-sm ${activeTab === tab.key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(tab.key)}
            style={{ minWidth: 120 }}
          >
            {tab.label} ({(data[tab.key] || []).length})
          </button>
        ))}
      </div>

      {/* Active Tab Content */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{activeTabInfo.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{activeTabInfo.desc}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeTab !== 'fresh' && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => copyFreshTo(activeTab)}
                title="Replace this list with a copy of all Fresh spawn points"
              >
                Copy from Fresh
              </button>
            )}
            {activeTab === 'fresh' && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => copyFreshTo('hop')}>
                  Copy to Hop
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => copyFreshTo('travel')}>
                  Copy to Travel
                </button>
              </>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => addPoint(activeTab)}>
              + Add Point
            </button>
          </div>
        </div>

        {activePoints.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
            No spawn points defined. Click "Add Point" to create one.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th>X Coordinate</th>
                  <th>Z Coordinate</th>
                  <th style={{ width: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activePoints.map((pt, idx) => (
                  <tr key={idx}>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{idx + 1}</td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={pt.x}
                        onChange={(e) => updatePoint(activeTab, idx, 'x', e.target.value)}
                        style={{ width: '100%', maxWidth: 200 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={pt.z}
                        onChange={(e) => updatePoint(activeTab, idx, 'z', e.target.value)}
                        style={{ width: '100%', maxWidth: 200 }}
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => removePoint(activeTab, idx)}
                        title="Remove this spawn point"
                        style={{ padding: '2px 8px', fontSize: 12 }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          {activePoints.length} spawn point{activePoints.length !== 1 ? 's' : ''} in {activeTabInfo.label}
        </div>
      </div>
    </div>
  );
}
