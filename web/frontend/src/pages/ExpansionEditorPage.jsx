import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import { ArrowLeft, Save, ChevronRight, Plus, X, Puzzle } from '../components/Icon';

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
            const val = data[f.key];
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

      {/* HUD Colors section — only show if UseHUDColors exists */}
      {data.UseHUDColors !== undefined && (
        <>
          <SettingsTable title="HUD Colors" color="var(--accent-purple, #a78bfa)" data={data} onChange={upd} fields={[
            { key: 'UseHUDColors', type: 'toggle', description: 'Enable custom HUD colors' },
          ]} />
          {data.UseHUDColors ? (
            <SettingsTable title="HUD Color Values (ARGB Hex)" color="var(--accent-purple, #a78bfa)" data={data} onChange={upd} fields={[
              { key: 'StaminaBarColor', type: 'color', description: 'Stamina bar color (ARGB hex)' },
              { key: 'NotifierDividerColor', type: 'color', description: 'Notifier divider color' },
              { key: 'TemperatureHotColor', type: 'color', description: 'Hot temperature color' },
              { key: 'TemperatureColdColor', type: 'color', description: 'Cold temperature color' },
              { key: 'NotifierHealthColor', type: 'color', description: 'Health notifier color' },
              { key: 'NotifierBloodColor', type: 'color', description: 'Blood notifier color' },
              { key: 'NotifierHungerColor', type: 'color', description: 'Hunger notifier color' },
              { key: 'NotifierThirstColor', type: 'color', description: 'Thirst notifier color' },
              { key: 'NotifierFeverColor', type: 'color', description: 'Fever notifier color' },
              { key: 'NotifierSickColor', type: 'color', description: 'Sick notifier color' },
              { key: 'ReputationPositiveColor', type: 'color', description: 'Positive reputation color' },
              { key: 'ReputationNegativeColor', type: 'color', description: 'Negative reputation color' },
            ].filter(f => data[f.key] !== undefined)} />
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

// ─── Mission-folder section renderers ────────────────────────────────

function MapSection({ data, onChange }) {
  if (!data) return <NoData />;
  const update = (key, val) => onChange({ ...data, [key]: val });
  return (
    <>
      <SettingsTable title="Map General" color="var(--accent-blue)" data={data} onChange={onChange} fields={[
        { key: 'EnableMap', type: 'toggle', description: 'Enable Expansion colored map (0 = vanilla white map)' },
        { key: 'UseMapOnMapItem', type: 'toggle', description: 'Use Expansion map UI for map items' },
        { key: 'ShowPlayerPosition', type: 'number', description: 'Show player position (0=hidden, 1=always, 2=compass only)' },
        { key: 'ShowMapStats', type: 'toggle', description: 'Show XYZ coordinates on map' },
        { key: 'CanOpenMapWithKeyBinding', type: 'toggle', description: 'Allow M key to open map' },
        { key: 'NeedMapItemForKeyBinding', type: 'toggle', description: 'Require physical map item for keybind' },
        { key: 'CreateDeathMarker', type: 'toggle', description: 'Auto-mark death location on map' },
        { key: 'PlayerLocationNotifier', type: 'toggle', description: 'Show town name/time notifications' },
      ]} />
      <SettingsTable title="Markers" color="var(--accent-green)" data={data} onChange={onChange} fields={[
        { key: 'CanCreateMarker', type: 'toggle', description: 'Allow players to create markers' },
        { key: 'CanCreate3DMarker', type: 'toggle', description: 'Allow 3D markers visible in-world' },
        { key: 'NeedPenItemForCreateMarker', type: 'toggle', description: 'Require pen item to create markers' },
        { key: 'NeedGPSItemForCreateMarker', type: 'toggle', description: 'Require GPS item to create markers' },
        { key: 'ShowDistanceOnPersonalMarkers', type: 'toggle', description: 'Show distance to personal markers' },
        { key: 'EnableServerMarkers', type: 'toggle', description: 'Enable server-defined markers' },
        { key: 'ShowNameOnServerMarkers', type: 'toggle', description: 'Show names on server markers' },
        { key: 'ShowDistanceOnServerMarkers', type: 'toggle', description: 'Show distance on server markers' },
      ]} />
      <SettingsTable title="GPS & Compass" color="var(--accent-purple, #a78bfa)" data={data} onChange={onChange} fields={[
        { key: 'EnableHUDGPS', type: 'toggle', description: 'Enable GPS HUD (N key)' },
        { key: 'NeedGPSItemForKeyBinding', type: 'toggle', description: 'Require GPS item for HUD GPS' },
        { key: 'EnableHUDCompass', type: 'toggle', description: 'Enable compass at top of screen' },
        { key: 'NeedCompassItemForHUDCompass', type: 'toggle', description: 'Require compass item for HUD compass' },
        { key: 'NeedGPSItemForHUDCompass', type: 'toggle', description: 'Require GPS item for HUD compass' },
      ]} />
      {/* Server Markers list */}
      {data.ServerMarkers && data.ServerMarkers.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
          <div style={{
            padding: '10px 16px', fontWeight: 700, fontSize: 14,
            borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-orange, #f59e0b)',
            background: 'var(--bg-surface, var(--bg-deep))',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>Server Markers ({data.ServerMarkers.length})</span>
            <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 11 }}
              onClick={() => update('ServerMarkers', [...data.ServerMarkers, { m_UID: 'NewMarker_' + Date.now(), m_Visibility: 6, m_Is3D: 1, m_Text: 'New Marker', m_IconName: 'Trader', m_Color: -13710223, m_Position: [0, 0, 0], m_Locked: 0, m_Persist: 1 }])}>
              <Plus size={12} /> Add Marker
            </button>
          </div>
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 12px' }}>Name</th>
                <th style={{ padding: '8px 12px' }}>Display Text</th>
                <th style={{ padding: '8px 12px' }}>Icon</th>
                <th style={{ padding: '8px 12px' }}>X</th>
                <th style={{ padding: '8px 12px' }}>Y</th>
                <th style={{ padding: '8px 12px' }}>Z</th>
                <th style={{ padding: '8px 12px' }}>3D</th>
                <th style={{ padding: '8px 12px', width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {data.ServerMarkers.map((marker, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" value={marker.m_UID || ''} style={{ width: '100%', fontSize: 12 }}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_UID: e.target.value }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" value={marker.m_Text || ''} style={{ width: '100%', fontSize: 12 }}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_Text: e.target.value }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" value={marker.m_IconName || ''} style={{ width: 80, fontSize: 12 }}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_IconName: e.target.value }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" type="number" value={marker.m_Position?.[0] ?? 0} style={{ width: 80, fontSize: 12 }}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_Position: [Number(e.target.value), marker.m_Position?.[1] ?? 0, marker.m_Position?.[2] ?? 0] }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" type="number" value={marker.m_Position?.[1] ?? 0} style={{ width: 80, fontSize: 12 }}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_Position: [marker.m_Position?.[0] ?? 0, Number(e.target.value), marker.m_Position?.[2] ?? 0] }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <input className="input" type="number" value={marker.m_Position?.[2] ?? 0} style={{ width: 80, fontSize: 12 }}
                      onChange={e => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_Position: [marker.m_Position?.[0] ?? 0, marker.m_Position?.[1] ?? 0, Number(e.target.value)] }; update('ServerMarkers', m); }} />
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                    <button onClick={() => { const m = [...data.ServerMarkers]; m[idx] = { ...m[idx], m_Is3D: m[idx].m_Is3D ? 0 : 1 }; update('ServerMarkers', m); }}
                      style={{ padding: '2px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer',
                        background: marker.m_Is3D ? 'var(--accent-green)' : 'var(--bg-elevated, var(--bg-card))', color: marker.m_Is3D ? '#fff' : 'var(--text-muted)' }}>
                      {marker.m_Is3D ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td style={{ padding: '6px 12px' }}>
                    <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => { const m = [...data.ServerMarkers]; m.splice(idx, 1); update('ServerMarkers', m); }}>
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
      <SettingsTable title="Build Permissions" color="var(--accent-green)" data={data} onChange={onChange} fields={[
        { key: 'CanBuildAnywhere', type: 'toggle', description: 'Allow building anywhere on the map' },
        { key: 'AllowBuildingWithoutATerritory', type: 'toggle', description: 'Allow building without a territory flag' },
        { key: 'CanCraftVanillaBasebuilding', type: 'toggle', description: 'Allow crafting vanilla base building items' },
        { key: 'CanCraftExpansionBasebuilding', type: 'toggle', description: 'Allow crafting Expansion base building items' },
        { key: 'CanCraftTerritoryFlagKit', type: 'toggle', description: 'Allow crafting territory flag kits' },
      ]} />
      <SettingsTable title="Territory Flags" color="var(--accent-purple, #a78bfa)" data={data} onChange={onChange} fields={[
        { key: 'SimpleTerritory', type: 'toggle', description: 'Use simplified territory system' },
        { key: 'AutomaticFlagOnCreation', type: 'toggle', description: 'Auto-place flag when creating territory' },
        { key: 'GetTerritoryFlagKitAfterBuild', type: 'toggle', description: 'Return flag kit after building' },
        { key: 'DestroyFlagOnDismantle', type: 'toggle', description: 'Destroy flag when dismantled' },
        { key: 'DismantleFlagMode', type: 'number', description: 'Flag dismantle mode (1=enabled)' },
        { key: 'FlagMenuMode', type: 'number', description: 'Flag menu mode (1=enabled)' },
      ]} />
      <SettingsTable title="Dismantling & Code Locks" color="var(--accent-orange, #f59e0b)" data={data} onChange={onChange} fields={[
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
      <SettingsTable title="Virtual Storage & Misc" color="var(--text-muted)" data={data} onChange={onChange} fields={[
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
  return (
    <>
      <SettingsTable title="Safe Zone General" color="var(--accent-green)" data={data} onChange={onChange} fields={[
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
      {/* Circle Zones */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-blue)',
          background: 'var(--bg-surface, var(--bg-deep))',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Circle Zones ({(data.CircleZones || []).length})</span>
          <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 11 }}
            onClick={() => update('CircleZones', [...(data.CircleZones || []), { Center: [0, 0, 0], Radius: 500 }])}>
            <Plus size={12} /> Add Zone
          </button>
        </div>
        <table className="table" style={{ width: '100%', fontSize: 13 }}>
          <thead><tr>
            <th style={{ padding: '8px 12px' }}>X</th>
            <th style={{ padding: '8px 12px' }}>Y</th>
            <th style={{ padding: '8px 12px' }}>Z</th>
            <th style={{ padding: '8px 12px' }}>Radius</th>
            <th style={{ padding: '8px 12px', width: 50 }}></th>
          </tr></thead>
          <tbody>
            {(data.CircleZones || []).map((zone, idx) => (
              <tr key={idx}>
                {[0, 1, 2].map(i => (
                  <td key={i} style={{ padding: '6px 12px' }}>
                    <input className="input" type="number" step="0.1" value={zone.Center?.[i] ?? 0} style={{ width: 100, fontSize: 12 }}
                      onChange={e => { const z = [...data.CircleZones]; const c = [...(z[idx].Center || [0, 0, 0])]; c[i] = Number(e.target.value); z[idx] = { ...z[idx], Center: c }; update('CircleZones', z); }} />
                  </td>
                ))}
                <td style={{ padding: '6px 12px' }}>
                  <input className="input" type="number" value={zone.Radius ?? 500} style={{ width: 80, fontSize: 12 }}
                    onChange={e => { const z = [...data.CircleZones]; z[idx] = { ...z[idx], Radius: Number(e.target.value) }; update('CircleZones', z); }} />
                </td>
                <td style={{ padding: '6px 12px' }}>
                  <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={() => { const z = [...data.CircleZones]; z.splice(idx, 1); update('CircleZones', z); }}>
                    <X size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
            ? 'No polygon zones defined.'
            : `${data.PolygonZones.length} polygon zone(s) with ${data.PolygonZones.reduce((sum, z) => sum + (z.Positions?.length || 0), 0)} total vertices. Edit via raw JSON in the Files editor for complex polygon manipulation.`
          }
        </div>
      </div>
    </>
  );
}

function HardlineSection({ data, onChange }) {
  if (!data) return <NoData />;
  return (
    <SettingsTable title="Hardline / Reputation" color="var(--accent-purple, #a78bfa)" data={data} onChange={onChange} fields={
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
  return (
    <>
      <SettingsTable title="Market General" color="var(--accent-orange, #f59e0b)" data={data} onChange={onChange} fields={[
        { key: 'MarketSystemEnabled', type: 'toggle', description: 'Enable the market/trader system' },
        { key: 'CurrencyIcon', type: 'text', description: 'Currency icon path (.edds file)' },
        { key: 'SellPricePercent', type: 'number', description: 'Default sell price as % of buy price' },
        { key: 'NetworkBatchSize', type: 'number', description: 'Items sent per network batch' },
        { key: 'MaxVehicleDistanceToTrader', type: 'number', description: 'Max vehicle distance to trader (meters)' },
        { key: 'MaxLargeVehicleDistanceToTrader', type: 'number', description: 'Max large vehicle distance to trader (meters)' },
      ]} />
      <SettingsTable title="ATM / Banking" color="var(--accent-blue)" data={data} onChange={onChange} fields={[
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
