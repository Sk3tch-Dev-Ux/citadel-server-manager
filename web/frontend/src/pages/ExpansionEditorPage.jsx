import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import { ArrowLeft, Save, ChevronRight, Plus, X, Puzzle } from '../components/Icon';

// Lazy-load InteractiveMap to avoid loading leaflet on initial render
const InteractiveMap = lazy(() => import('../components/InteractiveMap'));

// ─── Category definitions mapping config fileNames to sidebar items ───

const CATEGORIES = [
  { id: 'general', label: 'General', fileKey: 'GeneralSettings.json', color: 'var(--accent-blue)' },
  { id: 'notifications', label: 'Notifications', fileKey: 'NotificationSettings.json', color: 'var(--accent-orange, #f59e0b)' },
  { id: 'party', label: 'Party', fileKey: 'PartySettings.json', color: 'var(--accent-green)' },
  { id: 'territory', label: 'Territories', fileKey: 'TerritorySettings.json', color: 'var(--accent-purple, #a78bfa)' },
  { id: 'nametags', label: 'Name Tags', fileKey: 'NameTagsSettings.json', color: 'var(--accent-blue)' },
  { id: 'logs', label: 'Logs', fileKey: 'LogsSettings.json', color: 'var(--text-muted)' },
  { id: 'raiding', label: 'Raiding', fileKey: 'RaidSettings.json', color: 'var(--accent-red)' },
  { id: 'core', label: 'Core', fileKey: 'CoreSettings.json', color: 'var(--accent-blue)' },
  { id: 'playerlist', label: 'Player List', fileKey: 'PlayerListSettings.json', color: 'var(--accent-green)' },
  { id: 'damage', label: 'Damage System', fileKey: 'DamageSystemSettings.json', color: 'var(--accent-red)' },
  { id: 'social', label: 'Social Media', fileKey: 'SocialMediaSettings.json', color: 'var(--accent-orange, #f59e0b)' },
  { id: 'chat', label: 'Chat', fileKey: 'ChatSettings.json', color: 'var(--accent-blue)' },
  { id: 'questsettings', label: 'Quest Settings', fileKey: 'QuestSettings.json', color: 'var(--accent-orange, #f59e0b)' },
  { id: 'garage', label: 'Garage', fileKey: 'GarageSettings.json', color: 'var(--accent-green)' },
  { id: 'airdrops', label: 'Airdrops', fileKey: 'AirdropSettings.json', color: 'var(--accent-blue)' },
  { id: 'quests', label: 'Quests', fileKey: null, color: 'var(--accent-orange, #f59e0b)' },
  // Mission-folder configs
  { id: 'map', label: 'Map', fileKey: 'MapSettings.json', color: 'var(--accent-blue)', section: 'Mission' },
  { id: 'basebuilding', label: 'Base Building', fileKey: 'BaseBuildingSettings.json', color: 'var(--accent-green)', section: 'Mission' },
  { id: 'safezones', label: 'Safe Zones', fileKey: 'SafeZoneSettings.json', color: 'var(--accent-green)', section: 'Mission' },
  { id: 'hardline', label: 'Hardline', fileKey: 'HardlineSettings.json', color: 'var(--accent-purple, #a78bfa)', section: 'Mission' },
  { id: 'market', label: 'Market', fileKey: 'MarketSettings.json', color: 'var(--accent-orange, #f59e0b)', section: 'Mission' },
];

// Helper: find the full fileName key in configs that ends with the given fileKey
function resolveFileKey(configs, fileKey) {
  return Object.keys(configs).find(k => k.endsWith(fileKey)) || null;
}

// ─── Helper Components ──────────────────────────────────────────────

function SettingsTable({ title, color, fields, data, onChange }) {
  if (!data) return null;
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div style={{
        padding: '10px 16px',
        fontWeight: 700,
        fontSize: 14,
        borderBottom: '1px solid var(--border)',
        borderLeft: `3px solid ${color}`,
        background: 'var(--bg-surface, var(--bg-deep))',
      }}>
        {title}
      </div>
      <table className="table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: '28%', padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Setting</th>
            <th style={{ width: '18%', padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Value</th>
            <th style={{ padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(f => {
            let val = data[f.key];
            // Safety: skip rendering if value is an object/array (nested data)
            if (val !== null && val !== undefined && typeof val === 'object') {
              val = JSON.stringify(val);
            }
            return (
              <tr key={f.key}>
                <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono, monospace)', fontSize: 13, fontWeight: 500 }}>
                  {f.key}
                </td>
                <td style={{ padding: '8px 16px' }}>
                  {f.type === 'toggle' ? (
                    <button
                      onClick={() => onChange(f.key, val ? 0 : 1)}
                      style={{
                        padding: '4px 14px',
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 4,
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                        background: val ? 'var(--accent-green)' : 'var(--bg-elevated, var(--bg-card))',
                        color: val ? '#fff' : 'var(--text-muted)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {val ? 'ON' : 'OFF'}
                    </button>
                  ) : f.type === 'select' ? (
                    <select
                      className="input"
                      value={val ?? ''}
                      onChange={e => onChange(f.key, isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))}
                      style={{ width: '100%', maxWidth: 200, fontSize: 13 }}
                    >
                      {(f.options || []).map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : f.type === 'color' ? (
                    <input
                      className="input"
                      type="text"
                      value={val ?? ''}
                      onChange={e => onChange(f.key, e.target.value)}
                      style={{ width: '100%', maxWidth: 140, fontSize: 13, fontFamily: 'var(--font-mono, monospace)' }}
                      placeholder="AARRGGBB"
                    />
                  ) : (
                    <input
                      className="input"
                      type={f.type === 'number' ? 'number' : 'text'}
                      value={val ?? ''}
                      onChange={e => onChange(f.key, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
                      style={{ width: '100%', maxWidth: 160, fontSize: 13 }}
                      min={f.min}
                      max={f.max}
                    />
                  )}
                </td>
                <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                  {f.description}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ARGB hex color input — shows swatch + text input
function ColorInput({ value, onChange }) {
  // ARGB hex string like "FFFFFFFF" or "DC0000FF" → CSS rgba
  const argbToCSS = (hex) => {
    if (!hex || hex.length < 8) return '#888';
    const a = parseInt(hex.substring(0, 2), 16) / 255;
    const r = parseInt(hex.substring(2, 4), 16);
    const g = parseInt(hex.substring(4, 6), 16);
    const b = parseInt(hex.substring(6, 8), 16);
    return `rgba(${r},${g},${b},${a.toFixed(2)})`;
  };
  // CSS hex (#RRGGBB from color picker) → ARGB hex string
  const cssToARGB = (cssHex) => {
    const r = cssHex.substring(1, 3).toUpperCase();
    const g = cssHex.substring(3, 5).toUpperCase();
    const b = cssHex.substring(5, 7).toUpperCase();
    // Preserve existing alpha or default to FF
    const existingAlpha = (value && value.length >= 8) ? value.substring(0, 2) : 'FF';
    return `${existingAlpha}${r}${g}${b}`;
  };
  // Convert ARGB to #RRGGBB for the color picker
  const toPickerValue = (hex) => {
    if (!hex || hex.length < 8) return '#ffffff';
    return `#${hex.substring(2, 8)}`;
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input type="color" value={toPickerValue(value)} style={{ width: 32, height: 24, padding: 0, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: 'none' }}
        onChange={e => onChange(cssToARGB(e.target.value))} />
      <div style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid var(--border)', background: argbToCSS(value) }} />
      <input className="input" value={value || ''} style={{ width: 100, fontSize: 11, fontFamily: 'var(--font-mono, monospace)', padding: '2px 6px' }}
        onChange={e => onChange(e.target.value.toUpperCase())} />
    </div>
  );
}

// Color table for nested color objects (HUDColors, ChatColors)
function ColorTable({ title, color, colorData, onChange, descriptions }) {
  if (!colorData || typeof colorData !== 'object') return null;
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div style={{
        padding: '10px 16px', fontWeight: 700, fontSize: 14,
        borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${color}`,
        background: 'var(--bg-surface, var(--bg-deep))',
      }}>
        {title}
      </div>
      <table className="table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: '30%', padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Color</th>
            <th style={{ width: '30%', padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Value</th>
            <th style={{ padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(colorData).map(([key, val]) => (
            <tr key={key}>
              <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </td>
              <td style={{ padding: '6px 16px' }}>
                <ColorInput value={val} onChange={v => onChange({ ...colorData, [key]: v })} />
              </td>
              <td style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                {descriptions?.[key] || key.replace(/([A-Z])/g, ' $1').trim()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToggleGrid({ title, color, items, data, onChange }) {
  if (!data) return null;
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div style={{
        padding: '10px 16px',
        fontWeight: 700,
        fontSize: 14,
        borderBottom: '1px solid var(--border)',
        borderLeft: `3px solid ${color || 'var(--accent-blue)'}`,
        background: 'var(--bg-surface, var(--bg-deep))',
      }}>
        {title}
      </div>
      <div style={{
        padding: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 8,
      }}>
        {items.map(item => {
          const key = typeof item === 'string' ? item : item.key;
          const label = typeof item === 'string' ? item : (item.label || item.key);
          const val = data[key];
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                borderRadius: 6,
                background: 'var(--bg-deep)',
                border: '1px solid var(--border)',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {label}
              </span>
              <button
                onClick={() => onChange(key, val ? 0 : 1)}
                style={{
                  padding: '2px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 3,
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: val ? 'var(--accent-green)' : 'var(--bg-elevated, var(--bg-card))',
                  color: val ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                {val ? 'ON' : 'OFF'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StringListEditor({ items, onChange, placeholder }) {
  const [newItem, setNewItem] = useState('');
  const list = Array.isArray(items) ? items : [];

  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    onChange([...list, trimmed]);
    setNewItem('');
  };

  const handleRemove = (idx) => {
    onChange(list.filter((_, i) => i !== idx));
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {list.map((item, idx) => (
          <div key={idx} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            borderRadius: 4,
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
          }}>
            <span style={{ flex: 1, fontSize: 13, fontFamily: 'var(--font-mono, monospace)' }}>{item}</span>
            <button
              onClick={() => handleRemove(idx)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)',
                padding: 2, display: 'flex', alignItems: 'center',
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          className="input"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder || 'Add item...'}
          style={{ flex: 1, fontSize: 13 }}
        />
        <button
          className="btn btn-secondary"
          onClick={handleAdd}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 13 }}
        >
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}

// ─── Category Section Renderers ─────────────────────────────────────

function GeneralSection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  return (
    <>
      <SettingsTable title="Gravecross" color="var(--accent-blue)" data={data} onChange={upd} fields={[
        { key: 'DisableShootToUnlock', type: 'toggle', description: 'Disable shooting to unlock items' },
        { key: 'EnableGravecross', type: 'toggle', description: 'Enable grave markers on player death' },
        { key: 'EnableAIGravecross', type: 'toggle', description: 'Enable grave markers on AI death' },
        { key: 'GravecrossDeleteBody', type: 'toggle', description: 'Delete body when gravecross spawns' },
        { key: 'GravecrossTimeThreshold', type: 'number', description: 'Time threshold in seconds for gravecross' },
        { key: 'GravecrossSpawnTimeDelay', type: 'number', description: 'Delay before gravecross spawns (seconds)' },
      ]} />
      <SettingsTable title="Lighting" color="var(--accent-purple, #a78bfa)" data={data} onChange={upd} fields={[
        { key: 'EnableLamps', type: 'select', description: 'Lamp mode (0=off, 1=night, 2=always, 3=dark only)', options: [
          { value: 0, label: '0 - Off' }, { value: 1, label: '1 - Night' }, { value: 2, label: '2 - Always' }, { value: 3, label: '3 - Dark Only' },
        ]},
        { key: 'LampAmount_OneInX', type: 'number', description: 'Spawn 1 in X lamps (lower = more lamps)' },
        { key: 'LampSelectionMode', type: 'select', description: 'How lamps are selected for spawning', options: [
          { value: 'RANDOM', label: 'RANDOM' }, { value: 'FARTHEST', label: 'FARTHEST' }, { value: 'FARTHEST_RANDOM', label: 'FARTHEST_RANDOM' },
        ]},
        { key: 'EnableGenerators', type: 'toggle', description: 'Enable generator-powered lights' },
        { key: 'EnableLighthouses', type: 'toggle', description: 'Enable lighthouse lights' },
      ]} />
      <SettingsTable title="HUD & Visuals" color="var(--accent-green)" data={data} onChange={upd} fields={[
        { key: 'EnableHUDNightvisionOverlay', type: 'toggle', description: 'Show nightvision overlay on HUD' },
        { key: 'DisableMagicCrosshair', type: 'toggle', description: 'Disable the magic crosshair' },
        { key: 'EnableAutoRun', type: 'toggle', description: 'Enable the auto-run feature' },
        { key: 'UseDeathScreen', type: 'toggle', description: 'Show death screen on player death' },
        { key: 'UseDeathScreenStatistics', type: 'toggle', description: 'Show statistics on death screen' },
        { key: 'EnableEarPlugs', type: 'toggle', description: 'Enable ear plugs feature' },
      ]} />
      <SettingsTable title="Menu" color="var(--accent-orange, #f59e0b)" data={data} onChange={upd} fields={[
        { key: 'UseExpansionMainMenuLogo', type: 'toggle', description: 'Use Expansion logo in main menu' },
        { key: 'UseExpansionMainMenuIcons', type: 'toggle', description: 'Use Expansion icons in main menu' },
        { key: 'UseExpansionMainMenuIntroScene', type: 'toggle', description: 'Use Expansion intro scene' },
        { key: 'UseNewsFeedInGameMenu', type: 'toggle', description: 'Show news feed in game menu' },
      ]} />
      <SettingsTable title="Airdrop" color="var(--accent-red)" data={data} onChange={upd} fields={[
        { key: 'EnableAirdrop', type: 'toggle', description: 'Enable airdrops' },
      ]} />

      {/* HUD Colors section */}
      {data.UseHUDColors !== undefined && (
        <>
          <SettingsTable title="HUD Colors" color="var(--accent-purple, #a78bfa)" data={data} onChange={upd} fields={[
            { key: 'UseHUDColors', type: 'toggle', description: 'Enable custom HUD colors' },
          ]} />
          {data.UseHUDColors && data.HUDColors ? (
            <ColorTable title="HUD Color Values" color="var(--accent-purple, #a78bfa)"
              colorData={data.HUDColors}
              onChange={newColors => upd('HUDColors', newColors)}
              descriptions={{
                StaminaBarColor: 'Stamina bar color',
                StaminaBarColorHalf: 'Stamina bar half color',
                StaminaBarColorLow: 'Stamina bar low color',
                NotifierDividerColor: 'Notifier divider line',
                TemperatureBurningColor: 'Burning temperature',
                TemperatureHotColor: 'Hot temperature',
                TemperatureIdealColor: 'Ideal temperature',
                TemperatureColdColor: 'Cold temperature',
                TemperatureFreezingColor: 'Freezing temperature',
                NotifiersIdealColor: 'Notifier ideal state',
                NotifiersHalfColor: 'Notifier half state',
                NotifiersLowColor: 'Notifier low/critical state',
                ReputationBaseColor: 'Reputation base color',
                ReputationMedColor: 'Reputation medium color',
                ReputationHighColor: 'Reputation high color',
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function NotificationsSection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  return (
    <>
      <SettingsTable title="General Notifications" color="var(--accent-orange, #f59e0b)" data={data} onChange={upd} fields={[
        { key: 'EnableNotification', type: 'toggle', description: 'Master toggle for notifications' },
        { key: 'ShowPlayerJoinServer', type: 'toggle', description: 'Show notification when player joins' },
        { key: 'JoinMessageType', type: 'number', description: 'Join message type (0=chat, 1=notification, 2=both)' },
        { key: 'ShowPlayerLeftServer', type: 'toggle', description: 'Show notification when player leaves' },
        { key: 'LeftMessageType', type: 'number', description: 'Leave message type (0=chat, 1=notification, 2=both)' },
        { key: 'ShowTerritoryNotifications', type: 'toggle', description: 'Show territory-related notifications' },
      ]} />
      <SettingsTable title="Airdrop Notifications" color="var(--accent-blue)" data={data} onChange={upd} fields={[
        { key: 'ShowAirdropStarted', type: 'toggle', description: 'Notify when server airdrop starts' },
        { key: 'ShowAirdropClosingOn', type: 'toggle', description: 'Notify when airdrop is closing' },
        { key: 'ShowAirdropDropped', type: 'toggle', description: 'Notify when airdrop has dropped' },
        { key: 'ShowAirdropEnded', type: 'toggle', description: 'Notify when airdrop has ended' },
        { key: 'ShowPlayerAirdropStarted', type: 'toggle', description: 'Notify when player airdrop starts' },
        { key: 'ShowPlayerAirdropClosingOn', type: 'toggle', description: 'Notify when player airdrop closing' },
        { key: 'ShowPlayerAirdropDropped', type: 'toggle', description: 'Notify when player airdrop dropped' },
      ]} />
      <SettingsTable title="Kill Feed" color="var(--accent-red)" data={data} onChange={upd} fields={[
        { key: 'EnableKillFeed', type: 'toggle', description: 'Master toggle for kill feed' },
        { key: 'KillFeedMessageType', type: 'number', description: 'Kill feed message type (0=chat, 1=notification, 2=both)' },
      ]} />
      <ToggleGrid title="Kill Feed - Vehicle" color="var(--accent-blue)" data={data} onChange={upd} items={[
        'KillFeedCarHitDriver', 'KillFeedCarHitNoDriver', 'KillFeedCarCrash', 'KillFeedCarCrashCrew',
        'KillFeedHeliHitDriver', 'KillFeedHeliHitNoDriver', 'KillFeedHeliCrash', 'KillFeedHeliCrashCrew',
        'KillFeedBoatHitDriver', 'KillFeedBoatHitNoDriver', 'KillFeedBoatCrash', 'KillFeedBoatCrashCrew',
      ]} />
      <ToggleGrid title="Kill Feed - Combat" color="var(--accent-red)" data={data} onChange={upd} items={[
        'KillFeedWeapon', 'KillFeedMeleeWeapon', 'KillFeedBarehands', 'KillFeedWeaponExplosion', 'KillFeedBarbedWire',
      ]} />
      <ToggleGrid title="Kill Feed - Environmental" color="var(--accent-green)" data={data} onChange={upd} items={[
        'KillFeedFall', 'KillFeedFire', 'KillFeedDehydration', 'KillFeedStarvation',
        'KillFeedBleeding', 'KillFeedStatusEffects', 'KillFeedDrowned',
      ]} />
      <ToggleGrid title="Kill Feed - Other" color="var(--accent-orange, #f59e0b)" data={data} onChange={upd} items={[
        'KillFeedSuicide', 'KillFeedInfected', 'KillFeedAnimal', 'KillFeedAI',
        'KillFeedKilledUnknown', 'KillFeedDiedUnknown',
      ]} />
    </>
  );
}

function PartySection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  return (
    <>
      <SettingsTable title="Core" color="var(--accent-green)" data={data} onChange={upd} fields={[
        { key: 'EnableParties', type: 'toggle', description: 'Enable party system' },
        { key: 'MaxMembersInParty', type: 'number', description: 'Maximum members per party' },
        { key: 'UseWholeMapForInviteList', type: 'toggle', description: 'Allow inviting from anywhere on map' },
        { key: 'ForcePartyToHaveTags', type: 'toggle', description: 'Require party tags' },
        { key: 'InviteCooldown', type: 'number', description: 'Cooldown between invites (seconds)' },
        { key: 'DisplayPartyTag', type: 'toggle', description: 'Display party tag next to names' },
      ]} />
      <SettingsTable title="Markers" color="var(--accent-blue)" data={data} onChange={upd} fields={[
        { key: 'ShowPartyMember3DMarkers', type: 'toggle', description: 'Show 3D markers on party members' },
        { key: 'ShowDistanceUnderPartyMembersMarkers', type: 'toggle', description: 'Show distance under party markers' },
        { key: 'ShowNameOnPartyMembersMarkers', type: 'toggle', description: 'Show names on party markers' },
        { key: 'EnableQuickMarker', type: 'toggle', description: 'Enable quick marker feature' },
        { key: 'ShowDistanceUnderQuickMarkers', type: 'toggle', description: 'Show distance under quick markers' },
        { key: 'ShowNameOnQuickMarkers', type: 'toggle', description: 'Show name on quick markers' },
        { key: 'CanCreatePartyMarkers', type: 'toggle', description: 'Allow creating party map markers' },
        { key: 'ShowPartyMemberMapMarkers', type: 'toggle', description: 'Show party members on map' },
      ]} />
      <SettingsTable title="HUD" color="var(--accent-purple, #a78bfa)" data={data} onChange={upd} fields={[
        { key: 'ShowPartyMemberHUD', type: 'toggle', description: 'Show party members on HUD' },
        { key: 'ShowHUDMemberBlood', type: 'toggle', description: 'Show member blood on HUD' },
        { key: 'ShowHUDMemberStates', type: 'toggle', description: 'Show member states on HUD' },
        { key: 'ShowHUDMemberStance', type: 'toggle', description: 'Show member stance on HUD' },
        { key: 'ShowHUDMemberDistance', type: 'toggle', description: 'Show member distance on HUD' },
      ]} />
    </>
  );
}

function TerritorySection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  return (
    <SettingsTable title="Territory Settings" color="var(--accent-purple, #a78bfa)" data={data} onChange={upd} fields={[
      { key: 'EnableTerritories', type: 'toggle', description: 'Enable territory system' },
      { key: 'UseWholeMapForInviteList', type: 'toggle', description: 'Allow inviting from anywhere on map' },
      { key: 'TerritorySize', type: 'number', description: 'Territory radius in meters' },
      { key: 'TerritoryPerimeterSize', type: 'number', description: 'Perimeter buffer size in meters' },
      { key: 'MaxMembersInTerritory', type: 'number', description: 'Maximum members per territory' },
      { key: 'MaxTerritoryPerPlayer', type: 'number', description: 'Max territories a player can own' },
      { key: 'TerritoryInviteAcceptRadius', type: 'number', description: 'Radius to accept territory invite (meters)' },
      { key: 'AuthenticateCodeLockIfTerritoryMember', type: 'toggle', description: 'Auto-authenticate code locks for territory members' },
      { key: 'InviteCooldown', type: 'number', description: 'Cooldown between invites (seconds)' },
      { key: 'OnlyInviteGroupMember', type: 'toggle', description: 'Only allow inviting group members' },
      { key: 'MaxCodeLocksOnBBPerTerritory', type: 'number', description: 'Max code locks on base building per territory' },
      { key: 'MaxCodeLocksOnItemsPerTerritory', type: 'number', description: 'Max code locks on items per territory' },
    ]} />
  );
}

function NameTagsSection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  return (
    <SettingsTable title="Name Tags Settings" color="var(--accent-blue)" data={data} onChange={upd} fields={[
      { key: 'EnablePlayerTags', type: 'toggle', description: 'Enable player name tags' },
      { key: 'PlayerTagViewRange', type: 'number', description: 'View range for player tags (meters)' },
      { key: 'PlayerTagsIcon', type: 'toggle', description: 'Show icon on player tags' },
      { key: 'PlayerTagsColor', type: 'color', description: 'Player tag color (ARGB hex)' },
      { key: 'PlayerNameColor', type: 'color', description: 'Player name color (ARGB hex)' },
      { key: 'OnlyInSafeZones', type: 'toggle', description: 'Only show tags in safe zones' },
      { key: 'OnlyInTerritories', type: 'toggle', description: 'Only show tags in territories' },
      { key: 'ShowPlayerItemInHands', type: 'toggle', description: 'Show item in hands on tag' },
      { key: 'ShowNPCTags', type: 'toggle', description: 'Show name tags on NPCs' },
      { key: 'ShowPlayerFaction', type: 'toggle', description: 'Show player faction on tag' },
      { key: 'UseRarityColorForItemInHands', type: 'toggle', description: 'Use rarity color for held item display' },
    ]} />
  );
}

function LogsSection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  return (
    <>
      <ToggleGrid title="Server" color="var(--accent-blue)" data={data} onChange={upd} items={[
        'AdminTools', 'Safezone', 'SpawnSelection', 'Chat',
      ]} />
      <ToggleGrid title="Vehicles" color="var(--accent-orange, #f59e0b)" data={data} onChange={upd} items={[
        'VehicleCarKey', 'VehicleTowing', 'VehicleLockPicking', 'VehicleDestroyed',
        'VehicleAttachments', 'VehicleEnter', 'VehicleLeave', 'VehicleDeleted',
        'VehicleEngine', 'VehicleCover',
      ]} />
      <ToggleGrid title="Base" color="var(--accent-green)" data={data} onChange={upd} items={[
        'BaseBuildingRaiding', 'CodeLockRaiding', 'Territory', 'EntityStorage',
      ]} />
      <ToggleGrid title="Combat & AI" color="var(--accent-red)" data={data} onChange={upd} items={[
        'Killfeed', 'ExplosionDamageSystem', 'AIGeneral', 'AIPatrol', 'AIObjectPatrol',
      ]} />
      <ToggleGrid title="Features" color="var(--accent-purple, #a78bfa)" data={data} onChange={upd} items={[
        'Party', 'MissionAirdrop', 'Market', 'ATM', 'Hardline', 'Garage', 'Quests',
      ]} />
      <ToggleGrid title="Output" color="var(--text-muted)" data={data} onChange={upd} items={[
        'LogToScripts', 'LogToADM',
      ]} />
    </>
  );
}

function RaidingSection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  const raidModeOptions = [
    { value: -1, label: '-1 - Disabled' },
    { value: 0, label: '0 - All' },
    { value: 1, label: '1 - Doors & Gates' },
    { value: 2, label: '2 - Doors, Gates & Windows' },
  ];

  return (
    <>
      <SettingsTable title="General Raid" color="var(--accent-red)" data={data} onChange={upd} fields={[
        { key: 'BaseBuildingRaidMode', type: 'select', description: 'Base raid mode', options: raidModeOptions },
        { key: 'ExplosionTime', type: 'number', description: 'Explosion timer in seconds' },
        { key: 'ExplosionDamageMultiplier', type: 'number', description: 'Explosion damage multiplier' },
        { key: 'ProjectileDamageMultiplier', type: 'number', description: 'Projectile damage multiplier' },
        { key: 'EnableExplosiveWhitelist', type: 'toggle', description: 'Only whitelisted explosives can raid' },
      ]} />

      {/* Explosive Whitelist */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent-red)',
          background: 'var(--bg-surface, var(--bg-deep))',
        }}>
          Explosive Whitelist
        </div>
        <div style={{ padding: 16 }}>
          <StringListEditor
            items={data.ExplosiveDamageWhitelist}
            onChange={val => upd('ExplosiveDamageWhitelist', val)}
            placeholder="Add explosive class name..."
          />
        </div>
      </div>

      <SettingsTable title="Safe Raiding" color="var(--accent-orange, #f59e0b)" data={data} onChange={upd} fields={[
        { key: 'CanRaidSafes', type: 'toggle', description: 'Allow raiding safes' },
        { key: 'SafeRaidUseSchedule', type: 'toggle', description: 'Use raid schedule for safes' },
        { key: 'SafeExplosionDamageMultiplier', type: 'number', description: 'Safe explosion damage multiplier' },
        { key: 'SafeProjectileDamageMultiplier', type: 'number', description: 'Safe projectile damage multiplier' },
        { key: 'SafeRaidToolTimeSeconds', type: 'number', description: 'Time per raid tool cycle on safes (seconds)' },
        { key: 'SafeRaidToolCycles', type: 'number', description: 'Number of tool cycles to open safe' },
        { key: 'SafeRaidToolDamagePercent', type: 'number', description: 'Tool damage percent per cycle' },
      ]} />

      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent-orange, #f59e0b)',
          background: 'var(--bg-surface, var(--bg-deep))',
        }}>
          Safe Raid Tools
        </div>
        <div style={{ padding: 16 }}>
          <StringListEditor
            items={data.SafeRaidTools}
            onChange={val => upd('SafeRaidTools', val)}
            placeholder="Add tool class name..."
          />
        </div>
      </div>

      <SettingsTable title="Barbed Wire Raiding" color="var(--accent-purple, #a78bfa)" data={data} onChange={upd} fields={[
        { key: 'CanRaidBarbedWire', type: 'toggle', description: 'Allow raiding barbed wire' },
        { key: 'BarbedWireRaidToolTimeSeconds', type: 'number', description: 'Time per tool cycle on barbed wire (seconds)' },
        { key: 'BarbedWireRaidToolCycles', type: 'number', description: 'Number of tool cycles for barbed wire' },
        { key: 'BarbedWireRaidToolDamagePercent', type: 'number', description: 'Tool damage percent per cycle' },
      ]} />

      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent-purple, #a78bfa)',
          background: 'var(--bg-surface, var(--bg-deep))',
        }}>
          Barbed Wire Raid Tools
        </div>
        <div style={{ padding: 16 }}>
          <StringListEditor
            items={data.BarbedWireRaidTools}
            onChange={val => upd('BarbedWireRaidTools', val)}
            placeholder="Add tool class name..."
          />
        </div>
      </div>

      <SettingsTable title="Lock Raiding" color="var(--accent-blue)" data={data} onChange={upd} fields={[
        { key: 'CanRaidLocksOnWalls', type: 'toggle', description: 'Allow raiding locks on walls' },
        { key: 'CanRaidLocksOnFences', type: 'toggle', description: 'Allow raiding locks on fences' },
        { key: 'CanRaidLocksOnTents', type: 'toggle', description: 'Allow raiding locks on tents' },
        { key: 'CanRaidLocksOnContainers', type: 'toggle', description: 'Allow raiding locks on containers' },
        { key: 'LockRaidToolTimeSeconds', type: 'number', description: 'Time per tool cycle on locks (seconds)' },
        { key: 'LockRaidToolCycles', type: 'number', description: 'Number of tool cycles for lock' },
        { key: 'LockRaidToolDamagePercent', type: 'number', description: 'Tool damage percent per cycle' },
      ]} />

      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent-blue)',
          background: 'var(--bg-surface, var(--bg-deep))',
        }}>
          Lock Raid Tools
        </div>
        <div style={{ padding: 16 }}>
          <StringListEditor
            items={data.LockRaidTools}
            onChange={val => upd('LockRaidTools', val)}
            placeholder="Add tool class name..."
          />
        </div>
      </div>

      {/* Raid Schedule */}
      <RaidScheduleEditor schedule={data.Schedule} onChange={val => upd('Schedule', val)} />
    </>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function RaidScheduleEditor({ schedule, onChange }) {
  const list = Array.isArray(schedule) ? schedule : [];

  const updateEntry = (idx, field, val) => {
    const updated = list.map((entry, i) => i === idx ? { ...entry, [field]: val } : entry);
    onChange(updated);
  };

  const addEntry = () => {
    onChange([...list, { Weekday: 0, StartHour: 18, StartMinute: 0, DurationMinutes: 360 }]);
  };

  const removeEntry = (idx) => {
    onChange(list.filter((_, i) => i !== idx));
  };

  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div style={{
        padding: '10px 16px', fontWeight: 700, fontSize: 14,
        borderBottom: '1px solid var(--border)',
        borderLeft: '3px solid var(--accent-green)',
        background: 'var(--bg-surface, var(--bg-deep))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>Raid Schedule</span>
        <button
          className="btn btn-secondary"
          onClick={addEntry}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12 }}
        >
          <Plus size={12} /> Add Day
        </button>
      </div>
      {list.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No schedule entries. Add days to define raid windows.
        </div>
      ) : (
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Weekday</th>
              <th style={{ padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Start Hour</th>
              <th style={{ padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Start Minute</th>
              <th style={{ padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Duration (min)</th>
              <th style={{ padding: '8px 16px', width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((entry, idx) => (
              <tr key={idx}>
                <td style={{ padding: '8px 16px' }}>
                  <select
                    className="input"
                    value={entry.Weekday ?? 0}
                    onChange={e => updateEntry(idx, 'Weekday', Number(e.target.value))}
                    style={{ fontSize: 13 }}
                  >
                    {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </td>
                <td style={{ padding: '8px 16px' }}>
                  <input className="input" type="number" min={0} max={23} value={entry.StartHour ?? 0}
                    onChange={e => updateEntry(idx, 'StartHour', Number(e.target.value))} style={{ width: 80, fontSize: 13 }} />
                </td>
                <td style={{ padding: '8px 16px' }}>
                  <input className="input" type="number" min={0} max={59} value={entry.StartMinute ?? 0}
                    onChange={e => updateEntry(idx, 'StartMinute', Number(e.target.value))} style={{ width: 80, fontSize: 13 }} />
                </td>
                <td style={{ padding: '8px 16px' }}>
                  <input className="input" type="number" min={0} value={entry.DurationMinutes ?? 0}
                    onChange={e => updateEntry(idx, 'DurationMinutes', Number(e.target.value))} style={{ width: 100, fontSize: 13 }} />
                </td>
                <td style={{ padding: '8px 16px' }}>
                  <button
                    onClick={() => removeEntry(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4, display: 'flex' }}
                  >
                    <X size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CoreSection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  return (
    <SettingsTable title="Core Settings" color="var(--accent-blue)" data={data} onChange={upd} fields={[
      { key: 'ServerUpdateRateLimit', type: 'number', description: 'Server update rate limit' },
      { key: 'ForceExactCEItemLifetime', type: 'toggle', description: 'Force exact CE item lifetime' },
      { key: 'EnableInventoryCargoTidy', type: 'toggle', description: 'Enable auto-tidy for inventory cargo' },
    ]} />
  );
}

function PlayerListSection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  return (
    <SettingsTable title="Player List Settings" color="var(--accent-green)" data={data} onChange={upd} fields={[
      { key: 'EnablePlayerList', type: 'toggle', description: 'Enable the in-game player list' },
      { key: 'EnableTooltip', type: 'toggle', description: 'Enable tooltip on player list' },
    ]} />
  );
}

function DamageSystemSection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  return (
    <>
      <SettingsTable title="Damage System" color="var(--accent-red)" data={data} onChange={upd} fields={[
        { key: 'Enabled', type: 'toggle', description: 'Enable custom damage system' },
        { key: 'CheckForBlockingObjects', type: 'toggle', description: 'Check for blocking objects before damage' },
      ]} />

      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent-red)',
          background: 'var(--bg-surface, var(--bg-deep))',
        }}>
          Explosion Targets
        </div>
        <div style={{ padding: 16 }}>
          <StringListEditor
            items={data.ExplosionTargets}
            onChange={val => upd('ExplosionTargets', val)}
            placeholder="Add target class name..."
          />
        </div>
      </div>

      {/* Explosive Projectiles — key-value pairs */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent-orange, #f59e0b)',
          background: 'var(--bg-surface, var(--bg-deep))',
        }}>
          Explosive Projectiles
        </div>
        <div style={{ padding: 16 }}>
          <KeyValueEditor
            data={data.ExplosiveProjectiles}
            onChange={val => upd('ExplosiveProjectiles', val)}
            keyPlaceholder="Projectile class name"
            valuePlaceholder="Damage value"
          />
        </div>
      </div>
    </>
  );
}

function KeyValueEditor({ data, onChange, keyPlaceholder, valuePlaceholder }) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const entries = data && typeof data === 'object' ? Object.entries(data) : [];

  const handleAdd = () => {
    const k = newKey.trim();
    if (!k) return;
    const val = isNaN(Number(newVal)) ? newVal : Number(newVal);
    onChange({ ...data, [k]: val });
    setNewKey('');
    setNewVal('');
  };

  const handleRemove = (key) => {
    const copy = { ...data };
    delete copy[key];
    onChange(copy);
  };

  const handleValueChange = (key, val) => {
    const parsed = isNaN(Number(val)) ? val : Number(val);
    onChange({ ...data, [key]: parsed });
  };

  return (
    <div>
      {entries.map(([k, v]) => (
        <div key={k} style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
          padding: '4px 10px', borderRadius: 4,
          background: 'var(--bg-deep)', border: '1px solid var(--border)',
        }}>
          <span style={{ flex: 1, fontSize: 13, fontFamily: 'var(--font-mono, monospace)' }}>{k}</span>
          <input
            className="input"
            type="text"
            value={v}
            onChange={e => handleValueChange(k, e.target.value)}
            style={{ width: 120, fontSize: 13 }}
          />
          <button onClick={() => handleRemove(k)} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2, display: 'flex',
          }}>
            <X size={14} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input className="input" value={newKey} onChange={e => setNewKey(e.target.value)}
          placeholder={keyPlaceholder || 'Key'} style={{ flex: 1, fontSize: 13 }} />
        <input className="input" value={newVal} onChange={e => setNewVal(e.target.value)}
          placeholder={valuePlaceholder || 'Value'} style={{ width: 120, fontSize: 13 }}
          onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        <button className="btn btn-secondary" onClick={handleAdd}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 13 }}>
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}

function SocialMediaSection({ data, onChange }) {
  if (!data) return <NoData />;
  const upd = (key, val) => onChange({ ...data, [key]: val });

  return (
    <>
      {/* NewsFeedTexts */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent-orange, #f59e0b)',
          background: 'var(--bg-surface, var(--bg-deep))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>News Feed Texts</span>
          <button className="btn btn-secondary" onClick={() => {
            const list = Array.isArray(data.NewsFeedTexts) ? data.NewsFeedTexts : [];
            upd('NewsFeedTexts', [...list, { m_Title: '', m_Text: '' }]);
          }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12 }}>
            <Plus size={12} /> Add
          </button>
        </div>
        <div style={{ padding: 16 }}>
          {(!Array.isArray(data.NewsFeedTexts) || data.NewsFeedTexts.length === 0) ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No news feed texts configured.</div>
          ) : data.NewsFeedTexts.map((item, idx) => (
            <div key={idx} style={{
              padding: 12, marginBottom: 8, borderRadius: 6,
              background: 'var(--bg-deep)', border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Entry {idx + 1}</span>
                <button onClick={() => {
                  upd('NewsFeedTexts', data.NewsFeedTexts.filter((_, i) => i !== idx));
                }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2, display: 'flex' }}>
                  <X size={14} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input className="input" placeholder="Title" value={item.m_Title || ''}
                  onChange={e => {
                    const updated = [...data.NewsFeedTexts];
                    updated[idx] = { ...updated[idx], m_Title: e.target.value };
                    upd('NewsFeedTexts', updated);
                  }} style={{ fontSize: 13 }} />
                <textarea className="input" placeholder="Text content" value={item.m_Text || ''}
                  onChange={e => {
                    const updated = [...data.NewsFeedTexts];
                    updated[idx] = { ...updated[idx], m_Text: e.target.value };
                    upd('NewsFeedTexts', updated);
                  }} rows={3} style={{ fontSize: 13, resize: 'vertical' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* NewsFeedLinks */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent-blue)',
          background: 'var(--bg-surface, var(--bg-deep))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>News Feed Links</span>
          <button className="btn btn-secondary" onClick={() => {
            const list = Array.isArray(data.NewsFeedLinks) ? data.NewsFeedLinks : [];
            upd('NewsFeedLinks', [...list, { m_Label: '', m_Icon: '', m_URL: '' }]);
          }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12 }}>
            <Plus size={12} /> Add
          </button>
        </div>
        <div style={{ padding: 16 }}>
          {(!Array.isArray(data.NewsFeedLinks) || data.NewsFeedLinks.length === 0) ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No news feed links configured.</div>
          ) : data.NewsFeedLinks.map((item, idx) => (
            <div key={idx} style={{
              padding: 12, marginBottom: 8, borderRadius: 6,
              background: 'var(--bg-deep)', border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Link {idx + 1}</span>
                <button onClick={() => {
                  upd('NewsFeedLinks', data.NewsFeedLinks.filter((_, i) => i !== idx));
                }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2, display: 'flex' }}>
                  <X size={14} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="Label" value={item.m_Label || ''}
                  onChange={e => {
                    const updated = [...data.NewsFeedLinks];
                    updated[idx] = { ...updated[idx], m_Label: e.target.value };
                    upd('NewsFeedLinks', updated);
                  }} style={{ flex: 1, fontSize: 13 }} />
                <input className="input" placeholder="Icon" value={item.m_Icon || ''}
                  onChange={e => {
                    const updated = [...data.NewsFeedLinks];
                    updated[idx] = { ...updated[idx], m_Icon: e.target.value };
                    upd('NewsFeedLinks', updated);
                  }} style={{ width: 120, fontSize: 13 }} />
                <input className="input" placeholder="URL" value={item.m_URL || ''}
                  onChange={e => {
                    const updated = [...data.NewsFeedLinks];
                    updated[idx] = { ...updated[idx], m_URL: e.target.value };
                    upd('NewsFeedLinks', updated);
                  }} style={{ flex: 2, fontSize: 13 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function NoData() {
  return (
    <div className="card" style={{ padding: 32, textAlign: 'center' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
        Config file not found on disk. It may need to be created by running the mod first.
      </p>
    </div>
  );
}

// ─── Chat section ────────────────────────────────────────────────────

function ChatSection({ data, onChange }) {
  if (!data) return <NoData />;
  const update = (key, val) => onChange({ ...data, [key]: val });
  return (
    <>
      <SettingsTable title="Chat Channels" color="var(--accent-blue)" data={data} onChange={update} fields={[
        { key: 'EnableGlobalChat', type: 'toggle', description: 'Enable global chat channel' },
        { key: 'EnablePartyChat', type: 'toggle', description: 'Enable party/group chat channel' },
        { key: 'EnableTransportChat', type: 'toggle', description: 'Enable transport chat channel' },
        { key: 'EnableExpansionChat', type: 'toggle', description: 'Enable Expansion chat system' },
      ]} />
      {data.ChatColors && (
        <ColorTable title="Chat Colors" color="var(--accent-blue)"
          colorData={data.ChatColors}
          onChange={newColors => update('ChatColors', newColors)}
          descriptions={{
            SystemChatColor: 'System messages',
            AdminChatColor: 'Admin messages',
            GlobalChatColor: 'Global chat messages',
            DirectChatColor: 'Direct/proximity chat',
            TransportChatColor: 'Transport chat',
            PartyChatColor: 'Party/group chat',
            TransmitterChatColor: 'Radio transmitter chat',
            StatusMessageColor: 'Status messages',
            ActionMessageColor: 'Action messages',
            FriendlyMessageColor: 'Friendly messages',
            ImportantMessageColor: 'Important messages',
            DefaultMessageColor: 'Default message color',
          }}
        />
      )}
      <StringListEditor items={data.BlacklistedWords || []} placeholder="Add blacklisted word..."
        onChange={v => update('BlacklistedWords', v)} />
    </>
  );
}

// ─── Quests section ──────────────────────────────────────────────────

function QuestSettingsSection({ data, onChange }) {
  if (!data) return <NoData />;
  const update = (key, val) => onChange({ ...data, [key]: val });
  return (
    <>
      <SettingsTable title="Quest System" color="var(--accent-orange, #f59e0b)" data={data} onChange={update} fields={[
        { key: 'EnableQuests', type: 'toggle', description: 'Enable the quest system' },
        { key: 'EnableQuestLogTab', type: 'toggle', description: 'Show quest log tab in menu' },
        { key: 'CreateQuestNPCMarkers', type: 'toggle', description: 'Create map markers for quest NPCs' },
        { key: 'UseQuestNPCIndicators', type: 'toggle', description: 'Show indicators above quest NPCs' },
        { key: 'UseUTCTime', type: 'toggle', description: 'Use UTC time for resets (0 = server local time)' },
        { key: 'MaxActiveQuests', type: 'number', description: 'Maximum active quests per player (-1 = unlimited)' },
        { key: 'GroupQuestMode', type: 'select', description: 'Group quest behavior', options: [
          { value: 0, label: '0 - Only group owners accept/turn-in' },
          { value: 1, label: '1 - Owner turn-in, all accept' },
          { value: 2, label: '2 - All members accept/turn-in' },
        ]},
      ]} />
      <SettingsTable title="Reset Schedule" color="var(--accent-purple, #a78bfa)" data={data} onChange={update} fields={[
        { key: 'WeeklyResetDay', type: 'select', description: 'Day of the week for weekly quest reset', options: [
          { value: 'Sunday', label: 'Sunday' }, { value: 'Monday', label: 'Monday' },
          { value: 'Tuesday', label: 'Tuesday' }, { value: 'Wednesday', label: 'Wednesday' },
          { value: 'Thursday', label: 'Thursday' }, { value: 'Friday', label: 'Friday' },
          { value: 'Saturday', label: 'Saturday' },
        ]},
        { key: 'WeeklyResetHour', type: 'number', description: 'Hour for weekly reset (0-23)' },
        { key: 'WeeklyResetMinute', type: 'number', description: 'Minute for weekly reset (0-59)' },
        { key: 'DailyResetHour', type: 'number', description: 'Hour for daily quest reset (0-23)' },
        { key: 'DailyResetMinute', type: 'number', description: 'Minute for daily reset (0-59)' },
      ]} />
      <SettingsTable title="Quest Messages" color="var(--text-muted)" data={data} onChange={update} fields={[
        { key: 'QuestAcceptedTitle', type: 'text', description: 'Title shown when quest accepted' },
        { key: 'QuestAcceptedText', type: 'text', description: 'Text shown when quest accepted (%1 = quest name)' },
        { key: 'QuestCompletedTitle', type: 'text', description: 'Title when all objectives completed' },
        { key: 'QuestCompletedText', type: 'text', description: 'Text when all objectives completed' },
        { key: 'QuestFailedTitle', type: 'text', description: 'Title when quest failed' },
        { key: 'QuestFailedText', type: 'text', description: 'Text when quest failed' },
        { key: 'QuestCanceledTitle', type: 'text', description: 'Title when quest canceled' },
        { key: 'QuestCanceledText', type: 'text', description: 'Text when quest canceled' },
        { key: 'QuestTurnInTitle', type: 'text', description: 'Title when quest turned in' },
        { key: 'QuestTurnInText', type: 'text', description: 'Text when quest turned in' },
        { key: 'QuestObjectiveCompletedTitle', type: 'text', description: 'Title when objective completed' },
        { key: 'QuestObjectiveCompletedText', type: 'text', description: 'Text when objective completed (%1=obj, %2=quest)' },
        { key: 'QuestCooldownTitle', type: 'text', description: 'Title when quest on cooldown' },
        { key: 'QuestCooldownText', type: 'text', description: 'Text when quest on cooldown (%1=time)' },
        { key: 'QuestNotInGroupTitle', type: 'text', description: 'Title for group quest requirement' },
        { key: 'QuestNotInGroupText', type: 'text', description: 'Text for group quest requirement' },
        { key: 'QuestNotGroupOwnerTitle', type: 'text', description: 'Title for group owner requirement' },
        { key: 'QuestNotGroupOwnerText', type: 'text', description: 'Text for group owner requirement' },
        { key: 'AchievementCompletedTitle', type: 'text', description: 'Title when achievement completed (%1=name)' },
        { key: 'AchievementCompletedText', type: 'text', description: 'Text when achievement completed' },
      ]} />
    </>
  );
}

// ─── Garage section ──────────────────────────────────────────────────

function GarageSection({ data, onChange }) {
  if (!data) return <NoData />;
  const update = (key, val) => onChange({ ...data, [key]: val });
  return (
    <>
      <SettingsTable title="Garage General" color="var(--accent-green)" data={data} onChange={update} fields={[
        { key: 'Enabled', type: 'toggle', description: 'Enable the vehicle garage system' },
        { key: 'GarageMode', type: 'number', description: 'Garage mode (0=default)' },
        { key: 'GarageStoreMode', type: 'number', description: 'Store mode (0=default)' },
        { key: 'GarageRetrieveMode', type: 'number', description: 'Retrieve mode (0=default)' },
        { key: 'MaxStorableVehicles', type: 'number', description: 'Max vehicles per player in garage' },
        { key: 'VehicleSearchRadius', type: 'number', description: 'Search radius for storing vehicles (meters)' },
        { key: 'MaxDistanceFromStoredPosition', type: 'number', description: 'Max distance from stored position to retrieve (meters)' },
        { key: 'CanStoreWithCargo', type: 'toggle', description: 'Allow storing vehicles with cargo inside' },
        { key: 'UseVirtualStorageForCargo', type: 'toggle', description: 'Use virtual storage for vehicle cargo' },
        { key: 'NeedKeyToStore', type: 'toggle', description: 'Require vehicle key to store' },
        { key: 'AllowStoringDEVehicles', type: 'toggle', description: 'Allow storing DE (vanilla) vehicles' },
      ]} />
      <SettingsTable title="Group & Market Features" color="var(--accent-blue)" data={data} onChange={update} fields={[
        { key: 'EnableGroupFeatures', type: 'toggle', description: 'Enable group garage features' },
        { key: 'GroupStoreMode', type: 'number', description: 'Group store mode (0=disabled, 1=owner, 2=all members)' },
        { key: 'EnableMarketFeatures', type: 'toggle', description: 'Enable market integration for garage' },
        { key: 'StorePricePercent', type: 'number', description: 'Store price as % of vehicle value' },
        { key: 'StaticStorePrice', type: 'number', description: 'Static store price (0=use percent)' },
      ]} />
      <SettingsTable title="Tier Limits" color="var(--accent-purple, #a78bfa)" data={data} onChange={update} fields={[
        { key: 'MaxStorableTier1', type: 'number', description: 'Max storable vehicles for Tier 1' },
        { key: 'MaxStorableTier2', type: 'number', description: 'Max storable vehicles for Tier 2' },
        { key: 'MaxStorableTier3', type: 'number', description: 'Max storable vehicles for Tier 3' },
        { key: 'MaxRangeTier1', type: 'number', description: 'Max search range for Tier 1 (meters)' },
        { key: 'MaxRangeTier2', type: 'number', description: 'Max search range for Tier 2 (meters)' },
        { key: 'MaxRangeTier3', type: 'number', description: 'Max search range for Tier 3 (meters)' },
        { key: 'ParkingMeterEnableFlavor', type: 'toggle', description: 'Enable parking meter flavor text' },
      ]} />
      <StringListEditor items={data.EntityWhitelist || []} placeholder="Add whitelisted entity..."
        onChange={v => update('EntityWhitelist', v)} />
    </>
  );
}

// ─── Airdrop section ─────────────────────────────────────────────────

function AirdropSection({ data, onChange }) {
  if (!data) return <NoData />;
  const [expandedContainer, setExpandedContainer] = useState(null);
  const [expandedLoot, setExpandedLoot] = useState(null);
  const [searchText, setSearchText] = useState('');
  const update = (key, val) => onChange({ ...data, [key]: val });

  const updateContainer = (idx, key, val) => {
    const containers = [...data.Containers];
    containers[idx] = { ...containers[idx], [key]: val };
    update('Containers', containers);
  };

  const updateLootItem = (containerIdx, lootIdx, key, val) => {
    const containers = [...data.Containers];
    const loot = [...containers[containerIdx].Loot];
    loot[lootIdx] = { ...loot[lootIdx], [key]: val };
    containers[containerIdx] = { ...containers[containerIdx], Loot: loot };
    update('Containers', containers);
  };

  const addLootItem = (containerIdx) => {
    const containers = [...data.Containers];
    const loot = [...(containers[containerIdx].Loot || [])];
    loot.push({ Name: 'NewItem', Chance: 0.5, Attachments: [], QuantityPercent: -1, Max: -1, Min: 0, Variants: [] });
    containers[containerIdx] = { ...containers[containerIdx], Loot: loot };
    update('Containers', containers);
  };

  const removeLootItem = (containerIdx, lootIdx) => {
    const containers = [...data.Containers];
    const loot = [...containers[containerIdx].Loot];
    loot.splice(lootIdx, 1);
    containers[containerIdx] = { ...containers[containerIdx], Loot: loot };
    update('Containers', containers);
  };

  const addAttachment = (containerIdx, lootIdx) => {
    const containers = [...data.Containers];
    const loot = [...containers[containerIdx].Loot];
    const attachments = [...(loot[lootIdx].Attachments || [])];
    attachments.push({ Name: 'NewAttachment', Chance: 1.0, Attachments: [] });
    loot[lootIdx] = { ...loot[lootIdx], Attachments: attachments };
    containers[containerIdx] = { ...containers[containerIdx], Loot: loot };
    update('Containers', containers);
  };

  const removeAttachment = (containerIdx, lootIdx, attachIdx) => {
    const containers = [...data.Containers];
    const loot = [...containers[containerIdx].Loot];
    const attachments = [...loot[lootIdx].Attachments];
    attachments.splice(attachIdx, 1);
    loot[lootIdx] = { ...loot[lootIdx], Attachments: attachments };
    containers[containerIdx] = { ...containers[containerIdx], Loot: loot };
    update('Containers', containers);
  };

  const addVariant = (containerIdx, lootIdx) => {
    const containers = [...data.Containers];
    const loot = [...containers[containerIdx].Loot];
    const variants = [...(loot[lootIdx].Variants || [])];
    variants.push({ Name: loot[lootIdx].Name || 'Variant', Chance: 0.5, Attachments: [] });
    loot[lootIdx] = { ...loot[lootIdx], Variants: variants };
    containers[containerIdx] = { ...containers[containerIdx], Loot: loot };
    update('Containers', containers);
  };

  const removeVariant = (containerIdx, lootIdx, varIdx) => {
    const containers = [...data.Containers];
    const loot = [...containers[containerIdx].Loot];
    const variants = [...loot[lootIdx].Variants];
    variants.splice(varIdx, 1);
    loot[lootIdx] = { ...loot[lootIdx], Variants: variants };
    containers[containerIdx] = { ...containers[containerIdx], Loot: loot };
    update('Containers', containers);
  };

  return (
    <>
      {/* Global airdrop settings */}
      <SettingsTable title="Airdrop Flight Settings" color="var(--accent-blue)" data={data} onChange={update} fields={[
        { key: 'ServerMarkerOnDropLocation', type: 'toggle', description: 'Show map marker on drop location' },
        { key: 'Server3DMarkerOnDropLocation', type: 'toggle', description: 'Show 3D marker on drop location' },
        { key: 'ShowAirdropTypeOnMarker', type: 'toggle', description: 'Show container type on marker' },
        { key: 'HideCargoWhileParachuteIsDeployed', type: 'toggle', description: 'Hide cargo while parachute is open' },
        { key: 'HeightIsRelativeToGroundLevel', type: 'toggle', description: 'Height is relative to ground (not sea level)' },
        { key: 'Height', type: 'number', description: 'Flight altitude (meters)' },
        { key: 'DropZoneHeight', type: 'number', description: 'Drop zone altitude (meters)' },
        { key: 'FollowTerrainFraction', type: 'number', description: 'Terrain following (0=none, 1=full)' },
        { key: 'Speed', type: 'number', description: 'Flight speed' },
        { key: 'DropZoneSpeed', type: 'number', description: 'Drop zone speed' },
        { key: 'Radius', type: 'number', description: 'Drop radius' },
        { key: 'InfectedSpawnRadius', type: 'number', description: 'Infected spawn radius around drop (meters)' },
        { key: 'InfectedSpawnInterval', type: 'number', description: 'Infected spawn interval (ms)' },
        { key: 'ItemCount', type: 'number', description: 'Default item count per container' },
        { key: 'DropZoneProximityDistance', type: 'number', description: 'Drop zone proximity distance (meters)' },
        { key: 'ExplodeAirVehiclesOnCollision', type: 'toggle', description: 'Explode air vehicles on collision with airdrop plane' },
        { key: 'AirdropPlaneClassName', type: 'text', description: 'Custom plane class name (empty = default)' },
      ]} />

      {/* Containers */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Airdrop Containers ({(data.Containers || []).length})</h3>
          <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }}
            onClick={() => {
              const containers = [...(data.Containers || [])];
              containers.push({ Container: 'ExpansionAirdropContainer', FallSpeed: 4.5, Usage: 0, Weight: 1.0, ItemCount: 25, InfectedCount: 10, SpawnInfectedForPlayerCalledDrops: 0, ExplodeAirVehiclesOnCollision: 0, Infected: [], Loot: [] });
              update('Containers', containers);
            }}>
            <Plus size={12} /> Add Container
          </button>
        </div>

        {(data.Containers || []).map((container, cIdx) => {
          const isExpanded = expandedContainer === cIdx;
          const lootCount = container.Loot?.length || 0;
          const infectedCount = container.Infected?.length || 0;

          return (
            <div key={cIdx} className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
              {/* Container header */}
              <div
                onClick={() => setExpandedContainer(isExpanded ? null : cIdx)}
                style={{
                  padding: '12px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  cursor: 'pointer',
                  borderBottom: isExpanded ? '1px solid var(--border)' : 'none',
                  background: 'var(--bg-surface, var(--bg-deep))',
                }}
              >
                <ChevronRight size={14} style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', color: 'var(--text-muted)' }} />
                <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{container.Container}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lootCount} items</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{infectedCount} infected</span>
                <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={e => { e.stopPropagation(); const c = [...data.Containers]; c.splice(cIdx, 1); update('Containers', c); }}>
                  <X size={12} />
                </button>
              </div>

              {isExpanded && (
                <div style={{ padding: 16 }}>
                  {/* Container settings */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                    {[
                      { key: 'Container', label: 'Class Name', type: 'text' },
                      { key: 'FallSpeed', label: 'Fall Speed', type: 'number' },
                      { key: 'Usage', label: 'Usage', type: 'number' },
                      { key: 'Weight', label: 'Weight', type: 'number' },
                      { key: 'ItemCount', label: 'Item Count', type: 'number' },
                      { key: 'InfectedCount', label: 'Infected Count', type: 'number' },
                    ].map(f => (
                      <div key={f.key}>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                        <input className="input" type={f.type === 'number' ? 'number' : 'text'}
                          value={container[f.key] ?? ''} style={{ width: '100%', fontSize: 13 }}
                          onChange={e => updateContainer(cIdx, f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)} />
                      </div>
                    ))}
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Spawn Infected (Player Drops)</label>
                      <button onClick={() => updateContainer(cIdx, 'SpawnInfectedForPlayerCalledDrops', container.SpawnInfectedForPlayerCalledDrops ? 0 : 1)}
                        style={{ padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer',
                          background: container.SpawnInfectedForPlayerCalledDrops ? 'var(--accent-green)' : 'var(--bg-elevated, var(--bg-card))',
                          color: container.SpawnInfectedForPlayerCalledDrops ? '#fff' : 'var(--text-muted)' }}>
                        {container.SpawnInfectedForPlayerCalledDrops ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>

                  {/* Loot table */}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: 14 }}>Loot Table ({lootCount} items)</h4>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="input" placeholder="Search items..." value={searchText}
                          onChange={e => setSearchText(e.target.value)}
                          style={{ width: 180, fontSize: 12, padding: '4px 8px' }} />
                        <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 11 }}
                          onClick={() => addLootItem(cIdx)}>
                          <Plus size={12} /> Add Item
                        </button>
                      </div>
                    </div>

                    <table className="table" style={{ width: '100%', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '6px 10px', width: 30 }}></th>
                          <th style={{ padding: '6px 10px' }}>Item Name</th>
                          <th style={{ padding: '6px 10px', width: 80 }}>Chance</th>
                          <th style={{ padding: '6px 10px', width: 60 }}>Qty%</th>
                          <th style={{ padding: '6px 10px', width: 50 }}>Min</th>
                          <th style={{ padding: '6px 10px', width: 50 }}>Max</th>
                          <th style={{ padding: '6px 10px', width: 40 }}>Att</th>
                          <th style={{ padding: '6px 10px', width: 40 }}>Var</th>
                          <th style={{ padding: '6px 10px', width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(container.Loot || [])
                          .map((item, lIdx) => ({ item, lIdx }))
                          .filter(({ item }) => !searchText || item.Name?.toLowerCase().includes(searchText.toLowerCase()))
                          .map(({ item, lIdx }) => {
                            const lootKey = `${cIdx}-${lIdx}`;
                            const isLootExpanded = expandedLoot === lootKey;
                            const hasAttach = item.Attachments?.length > 0;
                            const hasVariants = item.Variants?.length > 0;

                            return (
                              <React.Fragment key={lIdx}>
                                <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedLoot(isLootExpanded ? null : lootKey)}>
                                  <td style={{ padding: '4px 10px' }}>
                                    <ChevronRight size={11} style={{ transform: isLootExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', color: 'var(--text-muted)' }} />
                                  </td>
                                  <td style={{ padding: '4px 10px' }}>
                                    <input className="input" value={item.Name || ''} style={{ width: '100%', fontSize: 12, padding: '2px 6px' }}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => updateLootItem(cIdx, lIdx, 'Name', e.target.value)} />
                                  </td>
                                  <td style={{ padding: '4px 10px' }}>
                                    <input className="input" type="number" step="0.01" min="0" max="1" value={item.Chance ?? 0.5}
                                      style={{ width: 70, fontSize: 12, padding: '2px 6px' }}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => updateLootItem(cIdx, lIdx, 'Chance', Number(e.target.value))} />
                                  </td>
                                  <td style={{ padding: '4px 10px' }}>
                                    <input className="input" type="number" value={item.QuantityPercent ?? -1}
                                      style={{ width: 50, fontSize: 12, padding: '2px 6px' }}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => updateLootItem(cIdx, lIdx, 'QuantityPercent', Number(e.target.value))} />
                                  </td>
                                  <td style={{ padding: '4px 10px' }}>
                                    <input className="input" type="number" value={item.Min ?? 0}
                                      style={{ width: 40, fontSize: 12, padding: '2px 6px' }}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => updateLootItem(cIdx, lIdx, 'Min', Number(e.target.value))} />
                                  </td>
                                  <td style={{ padding: '4px 10px' }}>
                                    <input className="input" type="number" value={item.Max ?? -1}
                                      style={{ width: 40, fontSize: 12, padding: '2px 6px' }}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => updateLootItem(cIdx, lIdx, 'Max', Number(e.target.value))} />
                                  </td>
                                  <td style={{ padding: '4px 10px', textAlign: 'center', color: hasAttach ? 'var(--accent-blue)' : 'var(--text-muted)', fontSize: 11 }}>
                                    {item.Attachments?.length || 0}
                                  </td>
                                  <td style={{ padding: '4px 10px', textAlign: 'center', color: hasVariants ? 'var(--accent-purple, #a78bfa)' : 'var(--text-muted)', fontSize: 11 }}>
                                    {item.Variants?.length || 0}
                                  </td>
                                  <td style={{ padding: '4px 10px' }}>
                                    <button className="btn btn-danger" style={{ padding: '1px 6px', fontSize: 10 }}
                                      onClick={e => { e.stopPropagation(); removeLootItem(cIdx, lIdx); }}>
                                      <X size={10} />
                                    </button>
                                  </td>
                                </tr>

                                {isLootExpanded && (
                                  <tr>
                                    <td colSpan={9} style={{ padding: 0 }}>
                                      <div style={{ padding: '12px 16px 12px 40px', background: 'var(--bg-deep, var(--bg-surface))', borderTop: '1px solid var(--border)' }}>
                                        {/* Attachments */}
                                        <div style={{ marginBottom: 12 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-blue)' }}>Attachments ({item.Attachments?.length || 0})</span>
                                            <button className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 10 }}
                                              onClick={() => addAttachment(cIdx, lIdx)}>
                                              <Plus size={10} /> Add
                                            </button>
                                          </div>
                                          {(item.Attachments || []).map((att, aIdx) => (
                                            <div key={aIdx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                                              <input className="input" value={att.Name || ''} placeholder="Attachment name"
                                                style={{ flex: 1, fontSize: 12, padding: '2px 6px' }}
                                                onChange={e => {
                                                  const containers = [...data.Containers];
                                                  const loot = [...containers[cIdx].Loot];
                                                  const attachments = [...loot[lIdx].Attachments];
                                                  attachments[aIdx] = { ...attachments[aIdx], Name: e.target.value };
                                                  loot[lIdx] = { ...loot[lIdx], Attachments: attachments };
                                                  containers[cIdx] = { ...containers[cIdx], Loot: loot };
                                                  update('Containers', containers);
                                                }} />
                                              <input className="input" type="number" step="0.01" min="0" max="1" value={att.Chance ?? 1}
                                                style={{ width: 60, fontSize: 12, padding: '2px 6px' }}
                                                onChange={e => {
                                                  const containers = [...data.Containers];
                                                  const loot = [...containers[cIdx].Loot];
                                                  const attachments = [...loot[lIdx].Attachments];
                                                  attachments[aIdx] = { ...attachments[aIdx], Chance: Number(e.target.value) };
                                                  loot[lIdx] = { ...loot[lIdx], Attachments: attachments };
                                                  containers[cIdx] = { ...containers[cIdx], Loot: loot };
                                                  update('Containers', containers);
                                                }} />
                                              <button className="btn btn-danger" style={{ padding: '1px 6px', fontSize: 10 }}
                                                onClick={() => removeAttachment(cIdx, lIdx, aIdx)}>
                                                <X size={10} />
                                              </button>
                                            </div>
                                          ))}
                                        </div>

                                        {/* Variants */}
                                        <div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-purple, #a78bfa)' }}>Variants ({item.Variants?.length || 0})</span>
                                            <button className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 10 }}
                                              onClick={() => addVariant(cIdx, lIdx)}>
                                              <Plus size={10} /> Add
                                            </button>
                                          </div>
                                          {(item.Variants || []).map((vari, vIdx) => (
                                            <div key={vIdx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid var(--accent-purple, #a78bfa)' }}>
                                              <input className="input" value={vari.Name || ''} placeholder="Variant name"
                                                style={{ flex: 1, fontSize: 12, padding: '2px 6px' }}
                                                onChange={e => {
                                                  const containers = [...data.Containers];
                                                  const loot = [...containers[cIdx].Loot];
                                                  const variants = [...loot[lIdx].Variants];
                                                  variants[vIdx] = { ...variants[vIdx], Name: e.target.value };
                                                  loot[lIdx] = { ...loot[lIdx], Variants: variants };
                                                  containers[cIdx] = { ...containers[cIdx], Loot: loot };
                                                  update('Containers', containers);
                                                }} />
                                              <input className="input" type="number" step="0.01" min="0" max="1" value={vari.Chance ?? 0.5}
                                                style={{ width: 60, fontSize: 12, padding: '2px 6px' }}
                                                onChange={e => {
                                                  const containers = [...data.Containers];
                                                  const loot = [...containers[cIdx].Loot];
                                                  const variants = [...loot[lIdx].Variants];
                                                  variants[vIdx] = { ...variants[vIdx], Chance: Number(e.target.value) };
                                                  loot[lIdx] = { ...loot[lIdx], Variants: variants };
                                                  containers[cIdx] = { ...containers[cIdx], Loot: loot };
                                                  update('Containers', containers);
                                                }} />
                                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{vari.Attachments?.length || 0} att</span>
                                              <button className="btn btn-danger" style={{ padding: '1px 6px', fontSize: 10 }}
                                                onClick={() => removeVariant(cIdx, lIdx, vIdx)}>
                                                <X size={10} />
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>

                  {/* Infected list */}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: 14 }}>Infected Types ({infectedCount})</h4>
                      <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 11 }}
                        onClick={() => updateContainer(cIdx, 'Infected', [...(container.Infected || []), 'ZmbM_CitizenASkinny'])}>
                        <Plus size={12} /> Add
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(container.Infected || []).map((inf, iIdx) => (
                        <div key={iIdx} style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '3px 8px', borderRadius: 4, fontSize: 11,
                          background: 'var(--bg-elevated, var(--bg-card))', border: '1px solid var(--border)',
                        }}>
                          <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{inf}</span>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0, lineHeight: 1 }}
                            onClick={() => {
                              const infected = [...container.Infected];
                              infected.splice(iIdx, 1);
                              updateContainer(cIdx, 'Infected', infected);
                            }}>
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Mission-folder section renderers ────────────────────────────────

function MapSection({ data, onChange }) {
  if (!data) return <NoData />;
  const update = (key, val) => onChange({ ...data, [key]: val });
  const [mapMode, setMapMode] = useState('view');
  const [selectedMarker, setSelectedMarker] = useState(null);

  const addMarkerAtPos = (x, z) => {
    const markers = [...(data.ServerMarkers || [])];
    const newMarker = {
      m_UID: 'Marker_' + Date.now(),
      m_Visibility: 6, m_Is3D: 1,
      m_Text: 'New Marker',
      m_IconName: 'Trader',
      m_Color: -13710223,
      m_Position: [Math.round(x), 0, Math.round(z)],
      m_Locked: 0, m_Persist: 1,
    };
    markers.push(newMarker);
    update('ServerMarkers', markers);
    setMapMode('view');
  };

  const deleteMarker = (id) => {
    const markers = (data.ServerMarkers || []).filter(m => (m.m_UID || '') !== id);
    update('ServerMarkers', markers);
    setSelectedMarker(null);
  };

  return (
    <>
      <SettingsTable title="Map General" color="var(--accent-blue)" data={data} onChange={update} fields={[
        { key: 'EnableMap', type: 'toggle', description: 'Enable Expansion colored map (0 = vanilla white map)' },
        { key: 'UseMapOnMapItem', type: 'toggle', description: 'Use Expansion map UI for map items' },
        { key: 'ShowPlayerPosition', type: 'number', description: 'Show player position (0=hidden, 1=always, 2=compass only)' },
        { key: 'ShowMapStats', type: 'toggle', description: 'Show XYZ coordinates on map' },
        { key: 'CanOpenMapWithKeyBinding', type: 'toggle', description: 'Allow M key to open map' },
        { key: 'NeedMapItemForKeyBinding', type: 'toggle', description: 'Require physical map item for keybind' },
        { key: 'CreateDeathMarker', type: 'toggle', description: 'Auto-mark death location on map' },
        { key: 'PlayerLocationNotifier', type: 'toggle', description: 'Show town name/time notifications' },
      ]} />
      <SettingsTable title="Markers" color="var(--accent-green)" data={data} onChange={update} fields={[
        { key: 'CanCreateMarker', type: 'toggle', description: 'Allow players to create markers' },
        { key: 'CanCreate3DMarker', type: 'toggle', description: 'Allow 3D markers visible in-world' },
        { key: 'NeedPenItemForCreateMarker', type: 'toggle', description: 'Require pen item to create markers' },
        { key: 'NeedGPSItemForCreateMarker', type: 'toggle', description: 'Require GPS item to create markers' },
        { key: 'ShowDistanceOnPersonalMarkers', type: 'toggle', description: 'Show distance to personal markers' },
        { key: 'EnableServerMarkers', type: 'toggle', description: 'Enable server-defined markers' },
        { key: 'ShowNameOnServerMarkers', type: 'toggle', description: 'Show names on server markers' },
        { key: 'ShowDistanceOnServerMarkers', type: 'toggle', description: 'Show distance on server markers' },
      ]} />
      <SettingsTable title="GPS & Compass" color="var(--accent-purple, #a78bfa)" data={data} onChange={update} fields={[
        { key: 'EnableHUDGPS', type: 'toggle', description: 'Enable GPS HUD (N key)' },
        { key: 'NeedGPSItemForKeyBinding', type: 'toggle', description: 'Require GPS item for HUD GPS' },
        { key: 'EnableHUDCompass', type: 'toggle', description: 'Enable compass at top of screen' },
        { key: 'NeedCompassItemForHUDCompass', type: 'toggle', description: 'Require compass item for HUD compass' },
        { key: 'NeedGPSItemForHUDCompass', type: 'toggle', description: 'Require GPS item for HUD compass' },
      ]} />

      {/* Interactive Server Markers Map */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-orange, #f59e0b)',
          background: 'var(--bg-surface, var(--bg-deep))',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Server Markers ({(data.ServerMarkers || []).length})</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn ${mapMode === 'addMarker' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '3px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => setMapMode(mapMode === 'addMarker' ? 'view' : 'addMarker')}>
              <Plus size={12} /> {mapMode === 'addMarker' ? 'Cancel' : 'Click to Place'}
            </button>
            <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 11 }}
              onClick={() => {
                const markers = [...(data.ServerMarkers || [])];
                markers.push({ m_UID: 'Marker_' + Date.now(), m_Visibility: 6, m_Is3D: 1, m_Text: 'New Marker', m_IconName: 'Trader', m_Color: -13710223, m_Position: [7500, 0, 7500], m_Locked: 0, m_Persist: 1 });
                update('ServerMarkers', markers);
              }}>
              <Plus size={12} /> Add at Center
            </button>
          </div>
        </div>
        <div style={{ padding: 8 }}>
          <Suspense fallback={<div style={{padding:20,textAlign:'center',color:'var(--text-muted)'}}>Loading map...</div>}>
            <InteractiveMap
              mapName="chernarusplus"
              height={500}
              markers={(data.ServerMarkers || []).map((m, i) => ({
                id: m.m_UID || `marker-${i}`,
                x: m.m_Position?.[0] || 0,
                z: m.m_Position?.[2] || 0,
                label: m.m_Text || m.m_UID,
                color: '#3b82f6',
                draggable: true,
              }))}
              selectedId={selectedMarker}
              onSelect={setSelectedMarker}
              onMarkerMove={(id, x, z) => {
                const markers = [...(data.ServerMarkers || [])];
                const idx = markers.findIndex(m => (m.m_UID || '') === id);
                if (idx >= 0) {
                  markers[idx] = { ...markers[idx], m_Position: [Math.round(x), markers[idx].m_Position?.[1] || 0, Math.round(z)] };
                  update('ServerMarkers', markers);
                }
              }}
              onMarkerAdd={addMarkerAtPos}
              onMarkerDelete={deleteMarker}
              mode={mapMode}
            />
          </Suspense>
        </div>
        {mapMode === 'addMarker' && (
          <div style={{ padding: '8px 16px', background: 'rgba(59,130,246,0.1)', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--accent-blue)' }}>
            Click anywhere on the map to place a new marker. Right-click a marker to delete it. Drag markers to reposition.
          </div>
        )}
      </div>

      {/* Marker Detail Table */}
      {(data.ServerMarkers || []).length > 0 && (
        <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
          <div style={{
            padding: '10px 16px', fontWeight: 700, fontSize: 14,
            borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-orange, #f59e0b)',
            background: 'var(--bg-surface, var(--bg-deep))',
          }}>
            Marker Details
          </div>
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 12px' }}>Name</th>
                <th style={{ padding: '8px 12px' }}>Display Text</th>
                <th style={{ padding: '8px 12px' }}>Icon</th>
                <th style={{ padding: '8px 12px' }}>X</th>
                <th style={{ padding: '8px 12px' }}>Z</th>
                <th style={{ padding: '8px 12px' }}>3D</th>
                <th style={{ padding: '8px 12px', width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {(data.ServerMarkers || []).map((marker, idx) => (
                <tr key={idx} style={{
                  background: selectedMarker === (marker.m_UID || `marker-${idx}`) ? 'rgba(59,130,246,0.1)' : undefined,
                  cursor: 'pointer',
                }} onClick={() => setSelectedMarker(marker.m_UID || `marker-${idx}`)}>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" value={marker.m_UID || ''} style={{ width: '100%', fontSize: 12 }}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_UID: e.target.value }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" value={marker.m_Text || ''} style={{ width: '100%', fontSize: 12 }}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_Text: e.target.value }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" value={marker.m_IconName || ''} style={{ width: 80, fontSize: 12 }}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_IconName: e.target.value }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" type="number" value={marker.m_Position?.[0] ?? 0} style={{ width: 80, fontSize: 12 }}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_Position: [Number(e.target.value), marker.m_Position?.[1] ?? 0, marker.m_Position?.[2] ?? 0] }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" type="number" value={marker.m_Position?.[2] ?? 0} style={{ width: 80, fontSize: 12 }}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_Position: [marker.m_Position?.[0] ?? 0, marker.m_Position?.[1] ?? 0, Number(e.target.value)] }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                    <button onClick={(e) => { e.stopPropagation(); const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_Is3D: m[idx].m_Is3D ? 0 : 1 }; update('ServerMarkers', m); }}
                      style={{ padding: '2px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer',
                        background: marker.m_Is3D ? 'var(--accent-green)' : 'var(--bg-elevated, var(--bg-card))', color: marker.m_Is3D ? '#fff' : 'var(--text-muted)' }}>
                      {marker.m_Is3D ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={(e) => { e.stopPropagation(); deleteMarker(marker.m_UID || `marker-${idx}`); }}>
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function BaseBuildingSection({ data, onChange }) {
  if (!data) return <NoData />;
  const update = (key, val) => onChange({ ...data, [key]: val });
  return (
    <>
      <SettingsTable title="Build Permissions" color="var(--accent-green)" data={data} onChange={update} fields={[
        { key: 'CanBuildAnywhere', type: 'toggle', description: 'Allow building anywhere on the map' },
        { key: 'AllowBuildingWithoutATerritory', type: 'toggle', description: 'Allow building without a territory flag' },
        { key: 'CanCraftVanillaBasebuilding', type: 'toggle', description: 'Allow crafting vanilla base building items' },
        { key: 'CanCraftExpansionBasebuilding', type: 'toggle', description: 'Allow crafting Expansion base building items' },
        { key: 'CanCraftTerritoryFlagKit', type: 'toggle', description: 'Allow crafting territory flag kits' },
      ]} />
      <SettingsTable title="Territory Flags" color="var(--accent-purple, #a78bfa)" data={data} onChange={update} fields={[
        { key: 'SimpleTerritory', type: 'toggle', description: 'Use simplified territory system' },
        { key: 'AutomaticFlagOnCreation', type: 'toggle', description: 'Auto-place flag when creating territory' },
        { key: 'GetTerritoryFlagKitAfterBuild', type: 'toggle', description: 'Return flag kit after building' },
        { key: 'DestroyFlagOnDismantle', type: 'toggle', description: 'Destroy flag when dismantled' },
        { key: 'DismantleFlagMode', type: 'number', description: 'Flag dismantle mode (1=enabled)' },
        { key: 'FlagMenuMode', type: 'number', description: 'Flag menu mode (1=enabled)' },
      ]} />
      <SettingsTable title="Dismantling & Code Locks" color="var(--accent-orange, #f59e0b)" data={data} onChange={update} fields={[
        { key: 'DismantleOutsideTerritory', type: 'toggle', description: 'Allow dismantling outside territories' },
        { key: 'DismantleInsideTerritory', type: 'toggle', description: 'Allow dismantling inside territories' },
        { key: 'DismantleAnywhere', type: 'toggle', description: 'Allow dismantling anywhere' },
        { key: 'CodelockActionsAnywhere', type: 'toggle', description: 'Allow code lock actions anywhere' },
        { key: 'CodelockAttachMode', type: 'number', description: 'Code lock attachment mode (0=all, 1=fences)' },
        { key: 'CodeLockLength', type: 'number', description: 'Code lock PIN length (4 or 6 digits)' },
        { key: 'DoDamageWhenEnterWrongCodeLock', type: 'toggle', description: 'Deal damage on wrong code entry' },
        { key: 'DamageWhenEnterWrongCodeLock', type: 'number', description: 'Damage dealt per wrong code (HP)' },
        { key: 'RememberCode', type: 'toggle', description: 'Remember entered code for the session' },
      ]} />
      <SettingsTable title="Virtual Storage & Misc" color="var(--text-muted)" data={data} onChange={update} fields={[
        { key: 'ZonesAreNoBuildZones', type: 'toggle', description: 'Defined zones are no-build zones' },
        { key: 'PreventItemAccessThroughObstructingItems', type: 'toggle', description: 'Block item access through walls/objects' },
        { key: 'EnableVirtualStorage', type: 'toggle', description: 'Enable virtual storage system' },
        { key: 'BuildZoneRequiredCustomMessage', type: 'text', description: 'Custom message when building in restricted zone' },
      ]} />
      <StringListEditor items={data.DeployableOutsideATerritory || []} placeholder="Add classname..."
        onChange={v => update('DeployableOutsideATerritory', v)} />
      <StringListEditor items={data.DeployableInsideAEnemyTerritory || []} placeholder="Add classname..."
        onChange={v => update('DeployableInsideAEnemyTerritory', v)} />
    </>
  );
}

function SafeZonesSection({ data, onChange }) {
  if (!data) return <NoData />;
  const update = (key, val) => onChange({ ...data, [key]: val });
  const [mapMode, setMapMode] = useState('view');
  const [selectedZone, setSelectedZone] = useState(null);

  const addZoneAtPos = (x, z) => {
    const zones = [...(data.CircleZones || [])];
    zones.push({ Center: [Math.round(x), 0, Math.round(z)], Radius: 500 });
    update('CircleZones', zones);
    setMapMode('view');
  };

  const deleteZone = (id) => {
    const idx = parseInt(id.split('-')[1]);
    if (id.startsWith('circle-')) {
      const zones = [...(data.CircleZones || [])];
      zones.splice(idx, 1);
      update('CircleZones', zones);
    }
    setSelectedZone(null);
  };

  return (
    <>
      <SettingsTable title="Safe Zone General" color="var(--accent-green)" data={data} onChange={update} fields={[
        { key: 'Enabled', type: 'toggle', description: 'Enable the safe zone system' },
        { key: 'FrameRateCheckSafeZoneInMs', type: 'number', description: 'Frame rate check interval (0 = default)' },
        { key: 'ActorsPerTick', type: 'number', description: 'Actors processed per server tick' },
        { key: 'DisablePlayerCollision', type: 'toggle', description: 'Disable player collision in safe zones' },
        { key: 'DisableVehicleDamageInSafeZone', type: 'toggle', description: 'Prevent vehicle damage in safe zones' },
        { key: 'EnableForceSZCleanup', type: 'toggle', description: 'Auto-cleanup items in safe zones' },
        { key: 'ItemLifetimeInSafeZone', type: 'number', description: 'Item cleanup lifetime in safe zones (seconds)' },
        { key: 'EnableForceSZCleanupVehicles', type: 'toggle', description: 'Auto-cleanup vehicles in safe zones' },
        { key: 'VehicleLifetimeInSafeZone', type: 'number', description: 'Vehicle cleanup lifetime in safe zones (seconds)' },
      ]} />

      {/* Interactive Safe Zones Map */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-green)',
          background: 'var(--bg-surface, var(--bg-deep))',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Safe Zones — Interactive Map</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn ${mapMode === 'addCircle' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '3px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => setMapMode(mapMode === 'addCircle' ? 'view' : 'addCircle')}>
              <Plus size={12} /> {mapMode === 'addCircle' ? 'Cancel' : 'Click to Place Zone'}
            </button>
            <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 11 }}
              onClick={() => {
                const zones = [...(data.CircleZones || [])];
                zones.push({ Center: [7500, 0, 7500], Radius: 500 });
                update('CircleZones', zones);
              }}>
              <Plus size={12} /> Add at Center
            </button>
          </div>
        </div>
        <div style={{ padding: 8 }}>
          <Suspense fallback={<div style={{padding:20,textAlign:'center',color:'var(--text-muted)'}}>Loading map...</div>}>
            <InteractiveMap
              mapName="chernarusplus"
              height={500}
              circles={(data.CircleZones || []).map((z, i) => ({
                id: `circle-${i}`,
                x: z.Center?.[0] || 0,
                z: z.Center?.[2] || 0,
                radius: z.Radius || 500,
                color: '#22c55e',
                label: `Zone ${i + 1} (r=${z.Radius || 500}m)`,
                draggable: true,
              }))}
              polygons={(data.PolygonZones || []).map((p, i) => ({
                id: `polygon-${i}`,
                positions: (p.Positions || []).map(pos => [pos[0], pos[2]]),
                color: '#a78bfa',
                label: `Polygon ${i + 1}`,
              }))}
              selectedId={selectedZone}
              onSelect={setSelectedZone}
              onCircleMove={(id, x, z) => {
                const idx = parseInt(id.split('-')[1]);
                const zones = [...(data.CircleZones || [])];
                if (zones[idx]) {
                  zones[idx] = { ...zones[idx], Center: [Math.round(x), zones[idx].Center?.[1] || 0, Math.round(z)] };
                  update('CircleZones', zones);
                }
              }}
              onMarkerAdd={addZoneAtPos}
              onMarkerDelete={deleteZone}
              mode={mapMode}
            />
          </Suspense>
        </div>
        {mapMode === 'addCircle' && (
          <div style={{ padding: '8px 16px', background: 'rgba(34,197,94,0.1)', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--accent-green)' }}>
            Click anywhere on the map to place a new safe zone (default 500m radius). Right-click a zone to delete it. Drag zone centers to reposition.
          </div>
        )}
      </div>

      {/* Circle Zones Detail Table */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-blue)',
          background: 'var(--bg-surface, var(--bg-deep))',
        }}>
          Circle Zones ({(data.CircleZones || []).length})
        </div>
        {(data.CircleZones || []).length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No circle zones defined. Use the map above to place zones.
          </div>
        ) : (
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead><tr>
              <th style={{ padding: '8px 12px' }}>#</th>
              <th style={{ padding: '8px 12px' }}>X</th>
              <th style={{ padding: '8px 12px' }}>Y</th>
              <th style={{ padding: '8px 12px' }}>Z</th>
              <th style={{ padding: '8px 12px' }}>Radius (m)</th>
              <th style={{ padding: '8px 12px', width: 50 }}></th>
            </tr></thead>
            <tbody>
              {(data.CircleZones || []).map((zone, idx) => (
                <tr key={idx} style={{
                  background: selectedZone === `circle-${idx}` ? 'rgba(34,197,94,0.1)' : undefined,
                  cursor: 'pointer',
                }} onClick={() => setSelectedZone(`circle-${idx}`)}>
                  <td style={{ padding: '6px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>{idx + 1}</td>
                  {[0, 1, 2].map(i => (
                    <td key={i} style={{ padding: '6px 12px' }}>
                      <input className="input" type="number" step="0.1" value={zone.Center?.[i] ?? 0} style={{ width: 100, fontSize: 12 }}
                        onClick={e => e.stopPropagation()}
                        onChange={e => { const z = [...data.CircleZones]; const c = [...(z[idx].Center || [0, 0, 0])]; c[i] = Number(e.target.value); z[idx] = { ...z[idx], Center: c }; update('CircleZones', z); }} />
                    </td>
                  ))}
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" type="number" value={zone.Radius ?? 500} style={{ width: 80, fontSize: 12 }}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { const z = [...data.CircleZones]; z[idx] = { ...z[idx], Radius: Number(e.target.value) }; update('CircleZones', z); }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={(e) => { e.stopPropagation(); deleteZone(`circle-${idx}`); }}>
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Polygon Zones */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-purple, #a78bfa)',
          background: 'var(--bg-surface, var(--bg-deep))',
        }}>
          Polygon Zones ({(data.PolygonZones || []).length})
        </div>
        <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
          {(data.PolygonZones || []).length === 0
            ? 'No polygon zones defined. Polygons are shown on the map above in purple.'
            : `${data.PolygonZones.length} polygon zone(s) with ${data.PolygonZones.reduce((sum, z) => sum + (z.Positions?.length || 0), 0)} total vertices displayed on the map above.`
          }
        </div>
      </div>
    </>
  );
}

function HardlineSection({ data, onChange }) {
  if (!data) return <NoData />;
  const update = (key, val) => onChange({ ...data, [key]: val });
  return (
    <SettingsTable title="Hardline / Reputation" color="var(--accent-purple, #a78bfa)" data={data} onChange={update} fields={
      Object.keys(data).filter(k => k !== 'm_Version').map(key => ({
        key,
        type: typeof data[key] === 'number' && (data[key] === 0 || data[key] === 1) && !key.includes('Reputation') && !key.includes('Max') && !key.includes('Default') ? 'toggle' : 'number',
        description: key.replace(/([A-Z])/g, ' $1').trim(),
      }))
    } />
  );
}

function MarketSection({ data, onChange }) {
  if (!data) return <NoData />;
  const update = (key, val) => onChange({ ...data, [key]: val });
  return (
    <>
      <SettingsTable title="Market General" color="var(--accent-orange, #f59e0b)" data={data} onChange={update} fields={[
        { key: 'MarketSystemEnabled', type: 'toggle', description: 'Enable the market/trader system' },
        { key: 'CurrencyIcon', type: 'text', description: 'Currency icon path (.edds file)' },
        { key: 'SellPricePercent', type: 'number', description: 'Default sell price as % of buy price' },
        { key: 'NetworkBatchSize', type: 'number', description: 'Items sent per network batch' },
        { key: 'MaxVehicleDistanceToTrader', type: 'number', description: 'Max vehicle distance to trader (meters)' },
        { key: 'MaxLargeVehicleDistanceToTrader', type: 'number', description: 'Max large vehicle distance to trader (meters)' },
      ]} />
      <SettingsTable title="ATM / Banking" color="var(--accent-blue)" data={data} onChange={update} fields={[
        { key: 'ATMSystemEnabled', type: 'toggle', description: 'Enable ATM machines' },
        { key: 'MaxDepositMoney', type: 'number', description: 'Maximum deposit amount per transaction' },
        { key: 'DefaultDepositMoney', type: 'number', description: 'Default deposit amount in ATM UI' },
        { key: 'ATMPlayerTransferEnabled', type: 'toggle', description: 'Allow player-to-player money transfers' },
        { key: 'ATMPartyLockerEnabled', type: 'toggle', description: 'Enable party locker in ATM' },
        { key: 'MaxPartyDepositMoney', type: 'number', description: 'Maximum party locker deposit' },
        { key: 'UseWholeMapForATMPlayerList', type: 'toggle', description: 'Show all players in ATM transfer list' },
      ]} />
    </>
  );
}

// ─── Quest Creator Section ──────────────────────────────────────────

const QUEST_TYPES = [
  { value: 0, label: 'Normal', color: 'var(--accent-blue)' },
  { value: 1, label: 'Daily', color: 'var(--accent-green)' },
  { value: 2, label: 'Weekly', color: 'var(--accent-purple, #a78bfa)' },
  { value: 3, label: 'Achievement', color: 'var(--accent-orange, #f59e0b)' },
];

const OBJECTIVE_TYPES = [
  { value: 2, label: 'Target/Kill' },
  { value: 3, label: 'Travel' },
  { value: 4, label: 'Collection' },
  { value: 5, label: 'Delivery' },
  { value: 6, label: 'Treasure Hunt' },
  { value: 7, label: 'AI Patrol' },
  { value: 8, label: 'AI Camp' },
  { value: 9, label: 'AI VIP' },
  { value: 10, label: 'Action' },
  { value: 11, label: 'Crafting' },
];

function QuestTypeBadge({ type }) {
  const qt = QUEST_TYPES.find(t => t.value === type) || QUEST_TYPES[0];
  return (
    <span style={{
      padding: '2px 8px', fontSize: 11, fontWeight: 600, borderRadius: 3,
      background: qt.color, color: '#fff',
    }}>
      {qt.label}
    </span>
  );
}

function ObjTypeBadge({ type }) {
  const ot = OBJECTIVE_TYPES.find(t => t.value === type);
  return (
    <span style={{
      padding: '2px 8px', fontSize: 11, fontWeight: 600, borderRadius: 3,
      background: 'var(--bg-elevated, var(--bg-card))', border: '1px solid var(--border)',
      color: 'var(--text-secondary)',
    }}>
      {ot ? ot.label : `Type ${type}`}
    </span>
  );
}

function QuestPillTabs({ tabs, active, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          style={{
            padding: '6px 16px', fontSize: 13, fontWeight: active === tab.id ? 600 : 400,
            borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer',
            background: active === tab.id ? 'var(--accent-orange, #f59e0b)' : 'var(--bg-elevated, var(--bg-card))',
            color: active === tab.id ? '#fff' : 'var(--text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function InlineToggle({ value, onChange, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {label && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>}
      <button
        onClick={() => onChange(value ? 0 : 1)}
        style={{
          padding: '3px 12px', fontSize: 11, fontWeight: 600, borderRadius: 4,
          border: '1px solid var(--border)', cursor: 'pointer',
          background: value ? 'var(--accent-green)' : 'var(--bg-elevated, var(--bg-card))',
          color: value ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s',
        }}
      >
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

function MultiSelect({ options, selected, onChange, placeholder }) {
  const sel = Array.isArray(selected) ? selected : [];
  const [open, setOpen] = useState(false);
  const available = options.filter(o => !sel.includes(o.value));
  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 8px', minHeight: 32,
        border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-deep)',
        cursor: 'pointer',
      }} onClick={() => setOpen(!open)}>
        {sel.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{placeholder || 'Select...'}</span>}
        {sel.map(v => {
          const opt = options.find(o => o.value === v);
          return (
            <span key={v} style={{
              padding: '2px 8px', fontSize: 11, fontWeight: 500, borderRadius: 3,
              background: 'var(--bg-elevated, var(--bg-card))', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {opt ? opt.label : v}
              <span style={{ cursor: 'pointer', color: 'var(--accent-red)', fontWeight: 700 }}
                onClick={e => { e.stopPropagation(); onChange(sel.filter(s => s !== v)); }}>x</span>
            </span>
          );
        })}
      </div>
      {open && available.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
          maxHeight: 160, overflowY: 'auto', marginTop: 2,
        }}>
          {available.map(opt => (
            <div key={opt.value}
              onClick={() => { onChange([...sel, opt.value]); setOpen(false); }}
              style={{
                padding: '6px 12px', fontSize: 12, cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated, var(--bg-deep))'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemArrayEditor({ items, onChange, fields }) {
  const list = Array.isArray(items) ? items : [];
  const addItem = () => {
    const blank = {};
    fields.forEach(f => { blank[f.key] = f.default ?? ''; });
    onChange([...list, blank]);
  };
  const updateItem = (idx, key, val) => {
    const next = list.map((item, i) => i === idx ? { ...item, [key]: val } : item);
    onChange(next);
  };
  const removeItem = (idx) => onChange(list.filter((_, i) => i !== idx));
  return (
    <div style={{ marginBottom: 8 }}>
      {list.map((item, idx) => (
        <div key={idx} style={{
          display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4,
          padding: '4px 8px', borderRadius: 4, background: 'var(--bg-deep)', border: '1px solid var(--border)',
        }}>
          {fields.map(f => (
            <input key={f.key} className="input" value={item[f.key] ?? ''} placeholder={f.label}
              type={f.type === 'number' ? 'number' : 'text'}
              onChange={e => updateItem(idx, f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)}
              style={{ flex: f.flex || 1, fontSize: 12 }} />
          ))}
          <button onClick={() => removeItem(idx)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}>
            <X size={14} />
          </button>
        </div>
      ))}
      <button className="btn btn-secondary" onClick={addItem}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12, marginTop: 4 }}>
        <Plus size={12} /> Add
      </button>
    </div>
  );
}

/* ── Quest List Sub-view ─────────────────────────────────────────── */

function QuestListView({ quests, onEdit, onDelete, onCreate }) {
  const [search, setSearch] = useState('');
  const filtered = quests.filter(q =>
    !search || (q.Title || q.ObjectiveText || '').toLowerCase().includes(search.toLowerCase()) ||
    String(q.ID || q.ConfigName || '').toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input className="input" placeholder="Search quests..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ flex: 1, fontSize: 13 }} />
        <button className="btn btn-primary" onClick={onCreate}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, whiteSpace: 'nowrap' }}>
          <Plus size={14} /> Create Quest
        </button>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>ID</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Title</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Type</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Active</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Objectives</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Follow-up</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Repeatable</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No quests found</td></tr>
            )}
            {filtered.map(q => {
              const qid = q.ID ?? q.ConfigName ?? '';
              const objCount = Array.isArray(q.ObjectiveFiles) ? q.ObjectiveFiles.length : (Array.isArray(q.Objectives) ? q.Objectives.length : 0);
              return (
                <tr key={qid} style={{ cursor: 'pointer' }} onClick={() => onEdit(q)}>
                  <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>{qid}</td>
                  <td style={{ padding: '8px 12px', fontSize: 13 }}>{q.Title || q.ObjectiveText || '(untitled)'}</td>
                  <td style={{ padding: '8px 12px' }}><QuestTypeBadge type={q.Type ?? 0} /></td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: q.Active !== 0 ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>
                      {q.Active !== 0 ? 'ON' : 'OFF'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 12 }}>{objCount}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>{q.FollowUpQuest || '-'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: q.Repeatable ? 'var(--accent-green)' : 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>
                      {q.Repeatable ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <button className="btn btn-danger" onClick={e => { e.stopPropagation(); onDelete(q); }}
                      style={{ padding: '2px 8px', fontSize: 11 }}>
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Quest Editor Sub-view ───────────────────────────────────────── */

function QuestEditorView({ quest, quests, npcs, objectives, onSave, onCancel }) {
  const [q, setQ] = useState(() => JSON.parse(JSON.stringify(quest)));
  const upd = (key, val) => setQ(prev => ({ ...prev, [key]: val }));

  const questOptions = quests.filter(x => (x.ID ?? x.ConfigName) !== (q.ID ?? q.ConfigName))
    .map(x => ({ value: x.ID ?? x.ConfigName ?? '', label: `${x.ID ?? x.ConfigName} - ${x.Title || '(untitled)'}` }));
  const npcOptions = npcs.map(n => ({ value: n.ID ?? n.ConfigName ?? '', label: `${n.ID ?? n.ConfigName} - ${n.NPCName || n.ClassName || ''}` }));

  const sectionHeader = (title, color) => (
    <div style={{
      padding: '10px 16px', fontWeight: 700, fontSize: 14,
      borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${color}`,
      background: 'var(--bg-surface, var(--bg-deep))', marginTop: 16,
    }}>{title}</div>
  );

  const fieldRow = (label, content) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 200, fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{content}</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-secondary" onClick={onCancel} style={{ fontSize: 13 }}>
          <ArrowLeft size={14} /> Back
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => onSave(q)} style={{ fontSize: 13 }}>
          <Save size={14} /> Save Quest
        </button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {sectionHeader('Basic Info', 'var(--accent-orange, #f59e0b)')}
        {fieldRow('Title', <input className="input" value={q.Title || ''} onChange={e => upd('Title', e.target.value)} style={{ width: '100%', fontSize: 13 }} />)}
        {fieldRow('Type', (
          <select className="input" value={q.Type ?? 0} onChange={e => upd('Type', Number(e.target.value))} style={{ fontSize: 13, maxWidth: 200 }}>
            {QUEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        ))}
        {fieldRow('Active', <InlineToggle value={q.Active ?? 1} onChange={v => upd('Active', v)} />)}
        {fieldRow('Objective Text', <input className="input" value={q.ObjectiveText || ''} onChange={e => upd('ObjectiveText', e.target.value)} style={{ width: '100%', fontSize: 13 }} />)}
        {fieldRow('Descriptions', (
          <div>
            {(Array.isArray(q.Descriptions) ? q.Descriptions : []).map((desc, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                <textarea className="input" value={desc} rows={2}
                  onChange={e => { const next = [...(q.Descriptions || [])]; next[i] = e.target.value; upd('Descriptions', next); }}
                  style={{ flex: 1, fontSize: 12, resize: 'vertical' }} />
                <button onClick={() => upd('Descriptions', (q.Descriptions || []).filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)' }}><X size={14} /></button>
              </div>
            ))}
            <button className="btn btn-secondary" onClick={() => upd('Descriptions', [...(q.Descriptions || []), ''])}
              style={{ fontSize: 11, padding: '2px 10px' }}><Plus size={12} /> Add Description</button>
          </div>
        ))}

        {sectionHeader('Quest Flow', 'var(--accent-blue)')}
        {fieldRow('Follow-Up Quest', (
          <select className="input" value={q.FollowUpQuest ?? -1} onChange={e => upd('FollowUpQuest', Number(e.target.value))} style={{ fontSize: 13, maxWidth: 300 }}>
            <option value={-1}>None</option>
            {questOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {fieldRow('Pre-Quest IDs', (
          <MultiSelect options={questOptions} selected={q.PreQuestIDs || []} onChange={v => upd('PreQuestIDs', v)} placeholder="Select prerequisite quests..." />
        ))}
        {fieldRow('Is Achievement', <InlineToggle value={q.IsAchievement ?? 0} onChange={v => upd('IsAchievement', v)} />)}

        {sectionHeader('Schedule', 'var(--accent-purple, #a78bfa)')}
        {fieldRow('Repeatable', <InlineToggle value={q.Repeatable ?? 0} onChange={v => upd('Repeatable', v)} />)}
        {fieldRow('Is Daily Quest', <InlineToggle value={q.IsDailyQuest ?? 0} onChange={v => upd('IsDailyQuest', v)} />)}
        {fieldRow('Is Weekly Quest', <InlineToggle value={q.IsWeeklyQuest ?? 0} onChange={v => upd('IsWeeklyQuest', v)} />)}
        {fieldRow('Cancel On Player Death', <InlineToggle value={q.CancelQuestOnPlayerDeath ?? 0} onChange={v => upd('CancelQuestOnPlayerDeath', v)} />)}
        {fieldRow('Autocomplete', <InlineToggle value={q.Autocomplete ?? 0} onChange={v => upd('Autocomplete', v)} />)}
        {fieldRow('Is Group Quest', <InlineToggle value={q.IsGroupQuest ?? 0} onChange={v => upd('IsGroupQuest', v)} />)}
        {fieldRow('Sequential Objectives', <InlineToggle value={q.SequentialObjectives ?? 0} onChange={v => upd('SequentialObjectives', v)} />)}

        {sectionHeader('NPCs', 'var(--accent-green)')}
        {fieldRow('Quest Giver NPCs', (
          <MultiSelect options={npcOptions} selected={q.QuestGiverIDs || []} onChange={v => upd('QuestGiverIDs', v)} placeholder="Select quest givers..." />
        ))}
        {fieldRow('Quest Turn-In NPCs', (
          <MultiSelect options={npcOptions} selected={q.QuestTurnInIDs || []} onChange={v => upd('QuestTurnInIDs', v)} placeholder="Select turn-in NPCs..." />
        ))}

        {sectionHeader('Objectives', 'var(--accent-blue)')}
        <div style={{ padding: 16 }}>
          {Array.isArray(q.ObjectiveFiles) && q.ObjectiveFiles.length > 0 ? (
            q.ObjectiveFiles.map((objFile, i) => {
              const flatObjs = Object.values(objectives).flat();
              const obj = flatObjs.find(o => (o.ID ?? o.ConfigName) === objFile || o.FileName === objFile);
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  borderRadius: 4, background: 'var(--bg-deep)', border: '1px solid var(--border)', marginBottom: 4,
                }}>
                  {obj && <ObjTypeBadge type={obj.ObjectiveType ?? 0} />}
                  <span style={{ flex: 1, fontSize: 12 }}>{objFile}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{obj ? (obj.ObjectiveText || '') : '(not found)'}</span>
                  <button onClick={() => upd('ObjectiveFiles', q.ObjectiveFiles.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)' }}><X size={14} /></button>
                </div>
              );
            })
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>No objectives linked</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <select className="input" id="quest-obj-picker" style={{ flex: 1, fontSize: 12 }}>
              <option value="">-- Select objective to add --</option>
              {Object.values(objectives).flat().map(o => {
                const oid = o.ID ?? o.ConfigName ?? o.FileName ?? '';
                return <option key={oid} value={o.FileName || oid}>{oid} - {o.ObjectiveText || '(no text)'}</option>;
              })}
            </select>
            <button className="btn btn-secondary" onClick={() => {
              const picker = document.getElementById('quest-obj-picker');
              if (picker && picker.value) {
                upd('ObjectiveFiles', [...(q.ObjectiveFiles || []), picker.value]);
                picker.value = '';
              }
            }} style={{ fontSize: 12, padding: '4px 10px' }}><Plus size={12} /> Link</button>
          </div>
        </div>

        {sectionHeader('Rewards', 'var(--accent-orange, #f59e0b)')}
        {fieldRow('Reputation Reward', <input className="input" type="number" value={q.ReputationReward ?? 0} onChange={e => upd('ReputationReward', Number(e.target.value))} style={{ maxWidth: 120, fontSize: 13 }} />)}
        {fieldRow('Reputation Requirement', <input className="input" type="number" value={q.ReputationRequirement ?? -1} onChange={e => upd('ReputationRequirement', Number(e.target.value))} style={{ maxWidth: 120, fontSize: 13 }} />)}
        {fieldRow('Need To Select Reward', <InlineToggle value={q.NeedToSelectReward ?? 0} onChange={v => upd('NeedToSelectReward', v)} />)}
        {fieldRow('Random Reward', <InlineToggle value={q.RandomReward ?? 0} onChange={v => upd('RandomReward', v)} />)}
        {fieldRow('Random Reward Amount', <input className="input" type="number" value={q.RandomRewardAmount ?? 0} onChange={e => upd('RandomRewardAmount', Number(e.target.value))} style={{ maxWidth: 120, fontSize: 13 }} />)}
        {fieldRow('Rewards For Group Owner Only', <InlineToggle value={q.RewardsForGroupOwnerOnly ?? 0} onChange={v => upd('RewardsForGroupOwnerOnly', v)} />)}
        {fieldRow('Quest Items', (
          <ItemArrayEditor items={q.QuestItems} onChange={v => upd('QuestItems', v)}
            fields={[{ key: 'ClassName', label: 'Class Name', flex: 2 }, { key: 'Amount', label: 'Amount', type: 'number', default: 1 }]} />
        ))}
        {fieldRow('Rewards', (
          <ItemArrayEditor items={q.Rewards} onChange={v => upd('Rewards', v)}
            fields={[{ key: 'ClassName', label: 'Class Name', flex: 2 }, { key: 'Amount', label: 'Amount', type: 'number', default: 1 }]} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onCancel} style={{ fontSize: 13 }}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(q)} style={{ fontSize: 13 }}>
          <Save size={14} /> Save Quest
        </button>
      </div>
    </div>
  );
}

/* ── NPC Manager Sub-view ────────────────────────────────────────── */

function NPCManagerView({ npcs, serverId, onSave, onDelete, onCreate }) {
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState(null);
  const [search, setSearch] = useState('');

  const startEdit = (npc) => {
    setEditingId(npc.ID ?? npc.ConfigName ?? null);
    setEditData(JSON.parse(JSON.stringify(npc)));
  };
  const cancelEdit = () => { setEditingId(null); setEditData(null); };
  const npcUpd = (key, val) => setEditData(prev => ({ ...prev, [key]: val }));

  const filtered = npcs.filter(n =>
    !search || (n.NPCName || n.ClassName || '').toLowerCase().includes(search.toLowerCase())
  );

  const markers = npcs.filter(n => n.Position && (n.Position[0] || n.Position[2])).map(n => ({
    id: String(n.ID ?? n.ConfigName ?? ''),
    x: n.Position[0] || 0,
    z: n.Position[2] || 0,
    label: n.NPCName || n.ClassName || 'NPC',
    color: (n.ID ?? n.ConfigName) === editingId ? 'orange' : 'blue',
  }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input className="input" placeholder="Search NPCs..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ flex: 1, fontSize: 13 }} />
        <button className="btn btn-primary" onClick={onCreate}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, whiteSpace: 'nowrap' }}>
          <Plus size={14} /> Create NPC
        </button>
      </div>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <Suspense fallback={<div style={{padding:20,textAlign:'center',color:'var(--text-muted)'}}>Loading map...</div>}><InteractiveMap
          mapName="chernarusplus"
          markers={markers}
          selectedId={editingId != null ? String(editingId) : null}
          onSelect={(id) => {
            const npc = npcs.find(n => String(n.ID ?? n.ConfigName) === id);
            if (npc) startEdit(npc);
          }}
          onMarkerMove={editingId != null ? (id, x, z) => {
            if (String(editingId) === id) {
              npcUpd('Position', [x, editData?.Position?.[1] || 0, z]);
            }
          } : undefined}
          mode={editingId != null ? 'view' : 'view'}
          height={400}
        /></Suspense>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>ID</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Name</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Class</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Faction</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Active</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Position</th>
              <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No NPCs found</td></tr>
            )}
            {filtered.map(n => {
              const nid = n.ID ?? n.ConfigName ?? '';
              const isEditing = nid === editingId;
              return (
                <React.Fragment key={nid}>
                  <tr style={{ cursor: 'pointer', background: isEditing ? 'var(--bg-elevated, var(--bg-deep))' : undefined }}
                    onClick={() => isEditing ? cancelEdit() : startEdit(n)}>
                    <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>{nid}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{n.NPCName || '(unnamed)'}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>{n.ClassName || ''}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12 }}>{n.NPCFaction || ''}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ color: n.Active !== 0 ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>
                        {n.Active !== 0 ? 'ON' : 'OFF'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>
                      {n.Position ? `${(n.Position[0] || 0).toFixed(0)}, ${(n.Position[2] || 0).toFixed(0)}` : '-'}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <button className="btn btn-danger" onClick={e => { e.stopPropagation(); onDelete(n); }}
                        style={{ padding: '2px 8px', fontSize: 11 }}>
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                  {isEditing && editData && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <div style={{ padding: 16, background: 'var(--bg-deep)', borderTop: '1px solid var(--border)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>NPC Name</label>
                              <input className="input" value={editData.NPCName || ''} onChange={e => npcUpd('NPCName', e.target.value)} style={{ width: '100%', fontSize: 13 }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Class Name</label>
                              <input className="input" value={editData.ClassName || ''} onChange={e => npcUpd('ClassName', e.target.value)} style={{ width: '100%', fontSize: 13 }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Faction</label>
                              <input className="input" value={editData.NPCFaction || ''} onChange={e => npcUpd('NPCFaction', e.target.value)} style={{ width: '100%', fontSize: 13 }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>NPC Type</label>
                              <select className="input" value={editData.NPCType ?? 0} onChange={e => npcUpd('NPCType', Number(e.target.value))} style={{ width: '100%', fontSize: 13 }}>
                                <option value={0}>0 - Static</option>
                                <option value={1}>1 - Patrol</option>
                                <option value={2}>2 - Quest</option>
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Loadout File</label>
                              <input className="input" value={editData.NPCLoadoutFile || ''} onChange={e => npcUpd('NPCLoadoutFile', e.target.value)} style={{ width: '100%', fontSize: 13 }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Active</label>
                              <InlineToggle value={editData.Active ?? 1} onChange={v => npcUpd('Active', v)} />
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Position X</label>
                              <input className="input" type="number" value={editData.Position?.[0] ?? 0}
                                onChange={e => npcUpd('Position', [Number(e.target.value), editData.Position?.[1] || 0, editData.Position?.[2] || 0])}
                                style={{ width: '100%', fontSize: 13 }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Position Y</label>
                              <input className="input" type="number" value={editData.Position?.[1] ?? 0}
                                onChange={e => npcUpd('Position', [editData.Position?.[0] || 0, Number(e.target.value), editData.Position?.[2] || 0])}
                                style={{ width: '100%', fontSize: 13 }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Position Z</label>
                              <input className="input" type="number" value={editData.Position?.[2] ?? 0}
                                onChange={e => npcUpd('Position', [editData.Position?.[0] || 0, editData.Position?.[1] || 0, Number(e.target.value)])}
                                style={{ width: '100%', fontSize: 13 }} />
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Orientation X</label>
                              <input className="input" type="number" value={editData.Orientation?.[0] ?? 0}
                                onChange={e => npcUpd('Orientation', [Number(e.target.value), editData.Orientation?.[1] || 0, editData.Orientation?.[2] || 0])}
                                style={{ width: '100%', fontSize: 13 }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Orientation Y</label>
                              <input className="input" type="number" value={editData.Orientation?.[1] ?? 0}
                                onChange={e => npcUpd('Orientation', [editData.Orientation?.[0] || 0, Number(e.target.value), editData.Orientation?.[2] || 0])}
                                style={{ width: '100%', fontSize: 13 }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Orientation Z</label>
                              <input className="input" type="number" value={editData.Orientation?.[2] ?? 0}
                                onChange={e => npcUpd('Orientation', [editData.Orientation?.[0] || 0, editData.Orientation?.[1] || 0, Number(e.target.value)])}
                                style={{ width: '100%', fontSize: 13 }} />
                            </div>
                          </div>
                          <div style={{ marginBottom: 12 }}>
                            <div style={{
                              padding: '8px 12px', fontWeight: 600, fontSize: 12,
                              borderBottom: '1px solid var(--border)', color: 'var(--text-muted)',
                            }}>Emote Settings</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '8px 0' }}>
                              <div>
                                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Emote ID</label>
                                <input className="input" type="number" value={editData.NPCEmoteID ?? 0} onChange={e => npcUpd('NPCEmoteID', Number(e.target.value))} style={{ width: '100%', fontSize: 13 }} />
                              </div>
                              <div>
                                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Emote Is Static</label>
                                <InlineToggle value={editData.NPCEmoteIsStatic ?? 0} onChange={v => npcUpd('NPCEmoteIsStatic', v)} />
                              </div>
                              <div>
                                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Interaction Emote ID</label>
                                <input className="input" type="number" value={editData.NPCInteractionEmoteID ?? 0} onChange={e => npcUpd('NPCInteractionEmoteID', Number(e.target.value))} style={{ width: '100%', fontSize: 13 }} />
                              </div>
                              <div>
                                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Interaction Emote Static</label>
                                <InlineToggle value={editData.NPCInteractionEmoteIsStatic ?? 0} onChange={v => npcUpd('NPCInteractionEmoteIsStatic', v)} />
                              </div>
                            </div>
                          </div>
                          <div style={{ marginBottom: 12 }}>
                            <div style={{
                              padding: '8px 12px', fontWeight: 600, fontSize: 12,
                              borderBottom: '1px solid var(--border)', color: 'var(--text-muted)',
                            }}>Waypoints</div>
                            <ItemArrayEditor
                              items={(editData.Waypoints || []).map(wp => ({ X: wp[0] || 0, Y: wp[1] || 0, Z: wp[2] || 0 }))}
                              onChange={v => npcUpd('Waypoints', v.map(wp => [wp.X || 0, wp.Y || 0, wp.Z || 0]))}
                              fields={[
                                { key: 'X', label: 'X', type: 'number' },
                                { key: 'Y', label: 'Y', type: 'number' },
                                { key: 'Z', label: 'Z', type: 'number' },
                              ]}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={cancelEdit} style={{ fontSize: 12 }}>Cancel</button>
                            <button className="btn btn-primary" onClick={() => { onSave(editData); cancelEdit(); }} style={{ fontSize: 12 }}>
                              <Save size={14} /> Save NPC
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Objectives List Sub-view ────────────────────────────────────── */

function ObjectiveEditorFields({ obj, onChange, type }) {
  const upd = (key, val) => onChange({ ...obj, [key]: val });
  const fieldRow = (label, content) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
      <span style={{ width: 160, fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{content}</div>
    </div>
  );

  return (
    <div>
      {fieldRow('Objective Text', <input className="input" value={obj.ObjectiveText || ''} onChange={e => upd('ObjectiveText', e.target.value)} style={{ width: '100%', fontSize: 12 }} />)}
      {fieldRow('Time Limit', <input className="input" type="number" value={obj.TimeLimit ?? -1} onChange={e => upd('TimeLimit', Number(e.target.value))} style={{ maxWidth: 120, fontSize: 12 }} />)}
      {fieldRow('Active', <InlineToggle value={obj.Active ?? 1} onChange={v => upd('Active', v)} />)}

      {(type === 2) && <>
        {fieldRow('Amount', <input className="input" type="number" value={obj.Amount ?? 1} onChange={e => upd('Amount', Number(e.target.value))} style={{ maxWidth: 120, fontSize: 12 }} />)}
        {fieldRow('Max Distance', <input className="input" type="number" value={obj.MaxDistance ?? -1} onChange={e => upd('MaxDistance', Number(e.target.value))} style={{ maxWidth: 120, fontSize: 12 }} />)}
        {fieldRow('ClassNames', <StringListEditor items={obj.ClassNames} onChange={v => upd('ClassNames', v)} placeholder="Add class name..." />)}
        {fieldRow('Allowed Weapons', <StringListEditor items={obj.AllowedWeapons} onChange={v => upd('AllowedWeapons', v)} placeholder="Add weapon class..." />)}
        {fieldRow('Count Self Kill', <InlineToggle value={obj.CountSelfKill ?? 0} onChange={v => upd('CountSelfKill', v)} />)}
        {fieldRow('Count AI Players', <InlineToggle value={obj.CountAIPlayers ?? 0} onChange={v => upd('CountAIPlayers', v)} />)}
      </>}

      {(type === 3) && <>
        {fieldRow('Max Distance', <input className="input" type="number" value={obj.MaxDistance ?? 5} onChange={e => upd('MaxDistance', Number(e.target.value))} style={{ maxWidth: 120, fontSize: 12 }} />)}
        {fieldRow('Marker Name', <input className="input" value={obj.MarkerName || ''} onChange={e => upd('MarkerName', e.target.value)} style={{ width: '100%', fontSize: 12 }} />)}
        {fieldRow('Trigger On Enter', <InlineToggle value={obj.TriggerOnEnter ?? 1} onChange={v => upd('TriggerOnEnter', v)} />)}
        {fieldRow('Trigger On Exit', <InlineToggle value={obj.TriggerOnExit ?? 0} onChange={v => upd('TriggerOnExit', v)} />)}
      </>}

      {(type === 4 || type === 5) && <>
        {fieldRow('Collections', (
          <ItemArrayEditor items={obj.Collections} onChange={v => upd('Collections', v)}
            fields={[
              { key: 'ClassName', label: 'Class Name', flex: 2 },
              { key: 'Amount', label: 'Amount', type: 'number', default: 1 },
              { key: 'QuantityPercent', label: 'Qty%', type: 'number', default: -1 },
              { key: 'MinQuantityPercent', label: 'MinQty%', type: 'number', default: -1 },
            ]}
          />
        ))}
      </>}

      {(type === 6) && <>
        {fieldRow('Max Distance', <input className="input" type="number" value={obj.MaxDistance ?? 5} onChange={e => upd('MaxDistance', Number(e.target.value))} style={{ maxWidth: 120, fontSize: 12 }} />)}
      </>}

      {(type >= 7 && type <= 9) && <>
        {fieldRow('Max Distance', <input className="input" type="number" value={obj.MaxDistance ?? -1} onChange={e => upd('MaxDistance', Number(e.target.value))} style={{ maxWidth: 120, fontSize: 12 }} />)}
      </>}

      {(type === 10) && <>
        {fieldRow('Action Names', <StringListEditor items={obj.ActionNames} onChange={v => upd('ActionNames', v)} placeholder="Add action name..." />)}
      </>}

      {(type === 11) && <>
        {fieldRow('Item Names', <StringListEditor items={obj.ItemNames} onChange={v => upd('ItemNames', v)} placeholder="Add item name..." />)}
      </>}

      {/* Position fields for types that use them */}
      {(type === 2 || type === 3 || type === 6 || type === 7 || type === 8 || type === 9) && <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Position X</label>
            <input className="input" type="number" value={obj.Position?.[0] ?? 0}
              onChange={e => upd('Position', [Number(e.target.value), obj.Position?.[1] || 0, obj.Position?.[2] || 0])}
              style={{ width: '100%', fontSize: 12 }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Position Y</label>
            <input className="input" type="number" value={obj.Position?.[1] ?? 0}
              onChange={e => upd('Position', [obj.Position?.[0] || 0, Number(e.target.value), obj.Position?.[2] || 0])}
              style={{ width: '100%', fontSize: 12 }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Position Z</label>
            <input className="input" type="number" value={obj.Position?.[2] ?? 0}
              onChange={e => upd('Position', [obj.Position?.[0] || 0, obj.Position?.[1] || 0, Number(e.target.value)])}
              style={{ width: '100%', fontSize: 12 }} />
          </div>
        </div>
      </>}
    </div>
  );
}

function ObjectivesListView({ objectives, onSave, onDelete, onCreate }) {
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState(null);

  const startEdit = (obj) => {
    setEditingId(obj.ID ?? obj.ConfigName ?? null);
    setEditData(JSON.parse(JSON.stringify(obj)));
  };
  const cancelEdit = () => { setEditingId(null); setEditData(null); };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={onCreate}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, whiteSpace: 'nowrap' }}>
          <Plus size={14} /> Create Objective
        </button>
      </div>

      {OBJECTIVE_TYPES.map(otype => {
        const typeObjs = (objectives[otype.value] || []);
        if (typeObjs.length === 0) return null;
        return (
          <div key={otype.value} className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
            <div style={{
              padding: '10px 16px', fontWeight: 700, fontSize: 14,
              borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-blue)',
              background: 'var(--bg-surface, var(--bg-deep))',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <ObjTypeBadge type={otype.value} />
              <span>Type {otype.value}: {otype.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({typeObjs.length})</span>
            </div>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>ID</th>
                  <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Text</th>
                  <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Active</th>
                  <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {typeObjs.map(obj => {
                  const oid = obj.ID ?? obj.ConfigName ?? '';
                  const isEditing = oid === editingId;
                  return (
                    <React.Fragment key={oid}>
                      <tr style={{ cursor: 'pointer', background: isEditing ? 'var(--bg-elevated, var(--bg-deep))' : undefined }}
                        onClick={() => isEditing ? cancelEdit() : startEdit(obj)}>
                        <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>{oid}</td>
                        <td style={{ padding: '8px 12px', fontSize: 12 }}>{obj.ObjectiveText || '(no text)'}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ color: obj.Active !== 0 ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>
                            {obj.Active !== 0 ? 'ON' : 'OFF'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <button className="btn btn-danger" onClick={e => { e.stopPropagation(); onDelete(obj); }}
                            style={{ padding: '2px 8px', fontSize: 11 }}>
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                      {isEditing && editData && (
                        <tr>
                          <td colSpan={4} style={{ padding: 0 }}>
                            <div style={{ padding: 16, background: 'var(--bg-deep)', borderTop: '1px solid var(--border)' }}>
                              <ObjectiveEditorFields obj={editData} onChange={setEditData} type={otype.value} />
                              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                                <button className="btn btn-secondary" onClick={cancelEdit} style={{ fontSize: 12 }}>Cancel</button>
                                <button className="btn btn-primary" onClick={() => { onSave(editData, otype.value); cancelEdit(); }} style={{ fontSize: 12 }}>
                                  <Save size={14} /> Save
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {Object.values(objectives).flat().length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          No objectives found. Create one to get started.
        </div>
      )}
    </div>
  );
}

/* ── Quest Chain Visualizer Sub-view (Placeholder) ───────────────── */

function QuestChainView({ quests }) {
  const starters = quests.filter(q => !Array.isArray(q.PreQuestIDs) || q.PreQuestIDs.length === 0);
  const typeColor = (q) => {
    if (q.IsDailyQuest) return 'var(--accent-blue)';
    if (q.IsWeeklyQuest) return 'var(--accent-purple, #a78bfa)';
    if (q.Active === 0) return 'var(--text-muted)';
    return 'var(--accent-green)';
  };

  const buildChain = (quest, visited = new Set()) => {
    const qid = quest.ID ?? quest.ConfigName ?? '';
    if (visited.has(qid)) return null;
    visited.add(qid);
    const followUp = quest.FollowUpQuest && quest.FollowUpQuest !== -1
      ? quests.find(q => (q.ID ?? q.ConfigName) === quest.FollowUpQuest)
      : null;
    return (
      <div key={qid} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{
          padding: '6px 12px', borderRadius: 6, fontSize: 12,
          border: `2px solid ${typeColor(quest)}`,
          background: 'var(--bg-card)', minWidth: 160,
        }}>
          <div style={{ fontWeight: 600 }}>{quest.Title || quest.ObjectiveText || qid}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
            <QuestTypeBadge type={quest.Type ?? 0} />
            <span>{qid}</span>
          </div>
        </div>
        {followUp && (
          <>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>&#8594;</span>
            {buildChain(followUp, visited)}
          </>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="card" style={{ padding: 16, marginBottom: 16, borderLeft: '3px solid var(--accent-orange, #f59e0b)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Quest Chain Visualizer</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Showing quest chains as a simple flow. Chain starters (no prerequisites) are listed below.
          A full canvas-based node graph will be built separately.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-green)' }} /> Active
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--text-muted)' }} /> Inactive
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-blue)' }} /> Daily
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-purple, #a78bfa)' }} /> Weekly
        </span>
      </div>
      {starters.length === 0 && quests.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          No quests found. Create some quests to see the chain view.
        </div>
      )}
      {starters.map(q => buildChain(q))}
      {starters.length === 0 && quests.length > 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 16 }}>
          No chain starters found (all quests have prerequisites). Showing all quests:
          {quests.map(q => buildChain(q))}
        </div>
      )}
    </div>
  );
}

/* ── Main QuestsSection Component ────────────────────────────────── */

function QuestsSection({ serverId }) {
  const [view, setView] = useState('list');
  const [quests, setQuests] = useState([]);
  const [npcs, setNPCs] = useState([]);
  const [objectives, setObjectives] = useState({});
  const [editingQuest, setEditingQuest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newObjType, setNewObjType] = useState(null);

  const loadData = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    try {
      const [qRes, nRes, oRes] = await Promise.all([
        API.get(`/api/servers/${serverId}/expansion/quests`),
        API.get(`/api/servers/${serverId}/expansion/npcs`),
        API.get(`/api/servers/${serverId}/expansion/objectives`),
      ]);
      setQuests(Array.isArray(qRes) ? qRes : (qRes?.quests || qRes?.data || []));
      setNPCs(Array.isArray(nRes) ? nRes : (nRes?.npcs || nRes?.data || []));
      if (oRes && !oRes.error) {
        // API returns { "2": { folder, prefix, objectives: [...] }, "3": { ... } }
        // Normalize to { "2": [...], "3": [...] } for the UI
        const grouped = {};
        if (Array.isArray(oRes)) {
          oRes.forEach(o => {
            const t = String(o.ObjectiveType ?? 0);
            if (!grouped[t]) grouped[t] = [];
            grouped[t].push(o);
          });
        } else {
          for (const [typeKey, typeData] of Object.entries(oRes)) {
            if (typeData && Array.isArray(typeData.objectives)) {
              grouped[typeKey] = typeData.objectives;
            } else if (Array.isArray(typeData)) {
              grouped[typeKey] = typeData;
            }
          }
        }
        setObjectives(grouped);
      }
    } catch (err) {
      window.addToast?.('Failed to load quest data: ' + (err.message || ''), 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Quest CRUD
  const saveQuest = async (q) => {
    try {
      const qid = q.ID ?? q.ConfigName;
      let res;
      if (qid && quests.some(x => (x.ID ?? x.ConfigName) === qid)) {
        res = await API.put(`/api/servers/${serverId}/expansion/quests/${qid}`, q);
      } else {
        res = await API.post(`/api/servers/${serverId}/expansion/quests`, q);
      }
      if (res && !res.error) {
        window.addToast?.('Quest saved', 'success');
        await loadData();
        setView('list');
        setEditingQuest(null);
      } else {
        window.addToast?.('Failed to save quest: ' + (res?.error || ''), 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to save quest: ' + err.message, 'error');
    }
  };

  const deleteQuest = async (q) => {
    if (!confirm(`Delete quest "${q.Title || q.ID || q.ConfigName}"?`)) return;
    try {
      const qid = q.ID ?? q.ConfigName;
      const res = await API.del(`/api/servers/${serverId}/expansion/quests/${qid}`);
      if (res && !res.error) {
        window.addToast?.('Quest deleted', 'success');
        await loadData();
      } else {
        window.addToast?.('Failed to delete quest: ' + (res?.error || ''), 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to delete quest: ' + err.message, 'error');
    }
  };

  const createQuest = () => {
    setEditingQuest({
      Title: '', Type: 0, Active: 1, ObjectiveText: '', Descriptions: [],
      FollowUpQuest: -1, PreQuestIDs: [], IsAchievement: 0,
      Repeatable: 0, IsDailyQuest: 0, IsWeeklyQuest: 0,
      CancelQuestOnPlayerDeath: 0, Autocomplete: 0, IsGroupQuest: 0, SequentialObjectives: 0,
      QuestGiverIDs: [], QuestTurnInIDs: [], ObjectiveFiles: [],
      ReputationReward: 0, ReputationRequirement: -1,
      NeedToSelectReward: 0, RandomReward: 0, RandomRewardAmount: 0,
      RewardsForGroupOwnerOnly: 0, QuestItems: [], Rewards: [],
    });
    setView('edit');
  };

  // NPC CRUD
  const saveNPC = async (npc) => {
    try {
      const nid = npc.ID ?? npc.ConfigName;
      let res;
      if (nid && npcs.some(x => (x.ID ?? x.ConfigName) === nid)) {
        res = await API.put(`/api/servers/${serverId}/expansion/npcs/${nid}`, npc);
      } else {
        res = await API.post(`/api/servers/${serverId}/expansion/npcs`, npc);
      }
      if (res && !res.error) {
        window.addToast?.('NPC saved', 'success');
        await loadData();
      } else {
        window.addToast?.('Failed to save NPC: ' + (res?.error || ''), 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to save NPC: ' + err.message, 'error');
    }
  };

  const deleteNPC = async (npc) => {
    if (!confirm(`Delete NPC "${npc.NPCName || npc.ID || npc.ConfigName}"?`)) return;
    try {
      const nid = npc.ID ?? npc.ConfigName;
      const res = await API.del(`/api/servers/${serverId}/expansion/npcs/${nid}`);
      if (res && !res.error) {
        window.addToast?.('NPC deleted', 'success');
        await loadData();
      } else {
        window.addToast?.('Failed to delete NPC: ' + (res?.error || ''), 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to delete NPC: ' + err.message, 'error');
    }
  };

  const createNPC = () => {
    const newNPC = {
      NPCName: 'New NPC', ClassName: 'SurvivorM_Mirek',
      Position: [0, 0, 0], Orientation: [0, 0, 0],
      NPCLoadoutFile: '', NPCFaction: '', NPCType: 2, Active: 1,
      NPCEmoteID: 0, NPCEmoteIsStatic: 0, NPCInteractionEmoteID: 0, NPCInteractionEmoteIsStatic: 0,
      Waypoints: [],
    };
    saveNPC(newNPC);
  };

  // Objective CRUD
  const saveObjective = async (obj, objType) => {
    try {
      const oid = obj.ID ?? obj.ConfigName;
      const t = objType ?? obj.ObjectiveType ?? 0;
      let res;
      if (oid && Object.values(objectives).flat().some(x => (x.ID ?? x.ConfigName) === oid)) {
        res = await API.put(`/api/servers/${serverId}/expansion/objectives/${t}/${oid}`, obj);
      } else {
        res = await API.post(`/api/servers/${serverId}/expansion/objectives/${t}`, obj);
      }
      if (res && !res.error) {
        window.addToast?.('Objective saved', 'success');
        await loadData();
      } else {
        window.addToast?.('Failed to save objective: ' + (res?.error || ''), 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to save objective: ' + err.message, 'error');
    }
  };

  const deleteObjective = async (obj) => {
    if (!confirm(`Delete objective "${obj.ObjectiveText || obj.ID || obj.ConfigName}"?`)) return;
    try {
      const oid = obj.ID ?? obj.ConfigName;
      const t = obj.ObjectiveType ?? 0;
      const res = await API.del(`/api/servers/${serverId}/expansion/objectives/${t}/${oid}`);
      if (res && !res.error) {
        window.addToast?.('Objective deleted', 'success');
        await loadData();
      } else {
        window.addToast?.('Failed to delete objective: ' + (res?.error || ''), 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to delete objective: ' + err.message, 'error');
    }
  };

  const createObjective = (typeVal) => {
    const newObj = {
      ObjectiveType: typeVal, ObjectiveText: '', TimeLimit: -1, Active: 1,
      Position: [0, 0, 0], MaxDistance: -1,
    };
    if (typeVal === 2) { newObj.Amount = 1; newObj.ClassNames = []; newObj.AllowedWeapons = []; newObj.CountSelfKill = 0; newObj.CountAIPlayers = 0; }
    if (typeVal === 3) { newObj.MaxDistance = 5; newObj.MarkerName = ''; newObj.TriggerOnEnter = 1; newObj.TriggerOnExit = 0; }
    if (typeVal === 4 || typeVal === 5) { newObj.Collections = []; }
    if (typeVal === 10) { newObj.ActionNames = []; }
    if (typeVal === 11) { newObj.ItemNames = []; }
    saveObjective(newObj, typeVal);
    setNewObjType(null);
  };

  if (!serverId) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        No server selected.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading quest data...</span>
      </div>
    );
  }

  const tabs = [
    { id: 'list', label: 'Quests' },
    { id: 'npcs', label: 'NPCs' },
    { id: 'objectives', label: 'Objectives' },
    { id: 'chain', label: 'Quest Chain' },
  ];

  // If editing a quest, show the editor instead of the list
  if (view === 'edit' && editingQuest) {
    return (
      <div>
        <QuestPillTabs tabs={tabs} active="list" onSelect={(id) => { setView(id); setEditingQuest(null); }} />
        <QuestEditorView
          quest={editingQuest}
          quests={quests}
          npcs={npcs}
          objectives={objectives}
          onSave={saveQuest}
          onCancel={() => { setView('list'); setEditingQuest(null); }}
        />
      </div>
    );
  }

  return (
    <div>
      <QuestPillTabs tabs={tabs} active={view} onSelect={setView} />

      {view === 'list' && (
        <QuestListView
          quests={quests}
          onEdit={(q) => { setEditingQuest(q); setView('edit'); }}
          onDelete={deleteQuest}
          onCreate={createQuest}
        />
      )}

      {view === 'npcs' && (
        <NPCManagerView
          npcs={npcs}
          serverId={serverId}
          onSave={saveNPC}
          onDelete={deleteNPC}
          onCreate={createNPC}
        />
      )}

      {view === 'objectives' && (
        <>
          {newObjType !== null && (
            <div className="card" style={{ padding: 16, marginBottom: 16, background: 'var(--bg-deep)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Select Objective Type:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {OBJECTIVE_TYPES.map(ot => (
                  <button key={ot.value} className="btn btn-secondary" onClick={() => createObjective(ot.value)}
                    style={{ fontSize: 12, padding: '4px 12px' }}>
                    {ot.label}
                  </button>
                ))}
                <button className="btn btn-secondary" onClick={() => setNewObjType(null)}
                  style={{ fontSize: 12, padding: '4px 12px', color: 'var(--accent-red)' }}>Cancel</button>
              </div>
            </div>
          )}
          <ObjectivesListView
            objectives={objectives}
            onSave={saveObjective}
            onDelete={deleteObjective}
            onCreate={() => setNewObjType(true)}
          />
        </>
      )}

      {view === 'chain' && (
        <QuestChainView quests={quests} />
      )}
    </div>
  );
}

// ─── Section router ─────────────────────────────────────────────────

const SECTION_RENDERERS = {
  general: GeneralSection,
  notifications: NotificationsSection,
  party: PartySection,
  territory: TerritorySection,
  nametags: NameTagsSection,
  logs: LogsSection,
  raiding: RaidingSection,
  core: CoreSection,
  playerlist: PlayerListSection,
  damage: DamageSystemSection,
  social: SocialMediaSection,
  chat: ChatSection,
  questsettings: QuestSettingsSection,
  quests: QuestsSection,
  garage: GarageSection,
  airdrops: AirdropSection,
  map: MapSection,
  basebuilding: BaseBuildingSection,
  safezones: SafeZonesSection,
  hardline: HardlineSection,
  market: MarketSection,
};

// ─── Main Component ─────────────────────────────────────────────────

export default function ExpansionEditorPage({ serverId }) {
  const navigate = useNavigate();
  const [configs, setConfigs] = useState({});
  const [originalConfigs, setOriginalConfigs] = useState({});
  const [activeCategory, setActiveCategory] = useState('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState('');

  // Load all expansion configs
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/mod-configs/expansion`);
      if (data && !data.error && data.configs) {
        const configData = {};
        for (const [fileName, cfg] of Object.entries(data.configs)) {
          configData[fileName] = cfg.data || {};
        }
        setConfigs(configData);
        setOriginalConfigs(JSON.parse(JSON.stringify(configData)));
      } else {
        window.addToast?.('Failed to load Expansion configs', 'error');
      }
    } catch {
      window.addToast?.('Failed to load Expansion configs', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Track which configs are modified
  const modifiedFiles = useMemo(() => {
    const modified = new Set();
    for (const fileName of Object.keys(configs)) {
      if (JSON.stringify(configs[fileName]) !== JSON.stringify(originalConfigs[fileName])) {
        modified.add(fileName);
      }
    }
    return modified;
  }, [configs, originalConfigs]);

  const totalModified = modifiedFiles.size;

  // Resolve file keys for each category
  const fileMap = useMemo(() => {
    const map = {};
    for (const cat of CATEGORIES) {
      map[cat.id] = resolveFileKey(configs, cat.fileKey);
    }
    return map;
  }, [configs]);

  // Raw config data lookup from the API response for "found" status
  const [rawConfigMeta, setRawConfigMeta] = useState({});
  useEffect(() => {
    (async () => {
      try {
        const data = await API.get(`/api/servers/${serverId}/mod-configs/expansion`);
        if (data && data.configs) {
          const meta = {};
          for (const [fileName, cfg] of Object.entries(data.configs)) {
            meta[fileName] = { found: cfg.found, displayName: cfg.displayName };
          }
          setRawConfigMeta(meta);
        }
      } catch { /* ignore */ }
    })();
  }, [serverId]);

  // Update a config file
  const updateConfig = useCallback((categoryId, newData) => {
    const fileName = fileMap[categoryId];
    if (!fileName) return;
    setConfigs(prev => ({ ...prev, [fileName]: newData }));
  }, [fileMap]);

  // Save all modified
  const handleSaveAll = useCallback(async () => {
    if (totalModified === 0) {
      window.addToast?.('No changes to save', 'info');
      return;
    }
    setSaving(true);
    let saved = 0;
    let failed = 0;
    for (const fileName of modifiedFiles) {
      setSaveProgress(`Saving ${fileName.split('/').pop()}...`);
      try {
        const result = await API.put(`/api/servers/${serverId}/mod-configs/expansion`, {
          fileName,
          data: configs[fileName],
        });
        if (result && !result.error) {
          saved++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    setSaveProgress('');
    setSaving(false);
    if (failed === 0) {
      window.addToast?.(`Saved ${saved} config${saved !== 1 ? 's' : ''} successfully`, 'success');
      setOriginalConfigs(JSON.parse(JSON.stringify(configs)));
    } else {
      window.addToast?.(`Saved ${saved}, failed ${failed}`, 'error');
      // Refresh original for the ones that saved
      setOriginalConfigs(JSON.parse(JSON.stringify(configs)));
    }
  }, [totalModified, modifiedFiles, configs, serverId]);

  // Ctrl+S
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveAll();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // Render active section
  const activeCat = CATEGORIES.find(c => c.id === activeCategory);
  const activeFileName = activeCat ? fileMap[activeCat.id] : null;
  const activeData = activeFileName ? configs[activeFileName] : null;
  const SectionRenderer = SECTION_RENDERERS[activeCategory];

  if (loading) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading Expansion configs...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
        flexWrap: 'wrap',
      }}>
        <button
          className="btn btn-secondary"
          onClick={() => navigate(`/servers/${serverId}/mod-configs`)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 13 }}
        >
          <ArrowLeft size={16} /> Back to Mod Configs
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Puzzle size={20} /> DayZ Expansion
          </h2>
        </div>
        {totalModified > 0 && (
          <span style={{ color: 'var(--accent-orange, #f59e0b)', fontWeight: 600, fontSize: 13 }}>
            {totalModified} unsaved config{totalModified !== 1 ? 's' : ''}
          </span>
        )}
        <button
          className="btn btn-primary"
          onClick={handleSaveAll}
          disabled={saving || totalModified === 0}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
        >
          <Save size={14} /> {saving ? (saveProgress || 'Saving...') : 'Save All'}
        </button>
      </div>

      {/* Main layout: sidebar + content */}
      <div style={{ display: 'flex', gap: 16, minHeight: 600 }}>
        {/* Sidebar */}
        <div style={{
          width: 180,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          {CATEGORIES.map((cat, idx) => {
            const fileName = fileMap[cat.id];
            const isActive = activeCategory === cat.id;
            const isModified = fileName && modifiedFiles.has(fileName);
            const meta = fileName ? rawConfigMeta[fileName] : null;
            const notFound = meta && meta.found === false;
            const prevCat = idx > 0 ? CATEGORIES[idx - 1] : null;
            const showSectionDivider = cat.section === 'Mission' && (!prevCat || prevCat.section !== 'Mission');

            return (
              <React.Fragment key={cat.id}>
              {showSectionDivider && (
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', padding: '12px 12px 4px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                  Mission Folder
                </div>
              )}
              <button
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--bg-elevated, var(--bg-card))' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: cat.color, flexShrink: 0,
                }} />
                <span style={{ flex: 1 }}>{cat.label}</span>
                {isModified && (
                  <span style={{ color: 'var(--accent-orange, #f59e0b)', fontWeight: 700, fontSize: 11 }}>*</span>
                )}
                {notFound && (
                  <span style={{
                    fontSize: 9, padding: '1px 4px', borderRadius: 3,
                    background: 'var(--accent-red)', color: '#fff', fontWeight: 600,
                  }}>N/A</span>
                )}
              </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {SectionRenderer ? (
            <SectionRenderer
              data={activeData}
              onChange={(newData) => updateConfig(activeCategory, newData)}
              serverId={serverId}
            />
          ) : (
            <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
              Select a category from the sidebar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
