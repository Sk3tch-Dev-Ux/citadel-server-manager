import { useState, useEffect, useCallback, lazy, Suspense, useRef } from 'react';
import API from '../api';
import {
  Plus, X, Save, Search, Trash2, ChevronDown, ChevronRight, ChevronUp,
  ArrowLeft, Target, MapPin, Package, Crosshair, Wand2, Star, Skull,
  Shield, Eye, Edit, Copy, RefreshCw
} from '../components/Icon';
import { toolWikiUrl, WIKI_TOOLS } from '../utils/wikiLinks';

const InteractiveMap = lazy(() => import('../components/InteractiveMap'));
import useServerMap from '../hooks/useServerMap';

// ─── Constants ────────────────────────────────────────────────────────

const QUEST_TYPES = [
  { value: 1, label: 'Treasure Hunt', color: '#eab308' },
  { value: 2, label: 'Target/Kill',   color: '#ef4444' },
  { value: 3, label: 'Travel',        color: '#3b82f6' },
  { value: 4, label: 'Delivery',      color: '#f97316' },
  { value: 5, label: 'Collection',    color: '#22c55e' },
  { value: 6, label: 'Crafting',      color: '#a855f7' },
  { value: 7, label: 'AI Camp',       color: '#facc15' },
  { value: 8, label: 'AI VIP',        color: '#fbbf24' },
];

const OBJECTIVE_TYPES = [
  { value: 2,  label: 'Target/Kill',   icon: Target,    color: '#ef4444' },
  { value: 3,  label: 'Travel',        icon: MapPin,    color: '#3b82f6' },
  { value: 4,  label: 'Collection',    icon: Package,   color: '#22c55e' },
  { value: 5,  label: 'Delivery',      icon: Package,   color: '#f97316' },
  { value: 6,  label: 'Treasure Hunt', icon: Star,      color: '#eab308' },
  { value: 7,  label: 'AI Patrol',     icon: Shield,    color: '#facc15' },
  { value: 8,  label: 'AI Camp',       icon: Skull,     color: '#facc15' },
  { value: 9,  label: 'AI VIP',        icon: Skull,     color: '#fbbf24' },
  { value: 10, label: 'Action',        icon: Crosshair, color: '#64748b' },
  { value: 11, label: 'Crafting',      icon: Wand2,     color: '#a855f7' },
];

function getQuestTypeInfo(type) {
  return QUEST_TYPES.find(t => t.value === type) || { label: 'Unknown', color: '#6b7280' };
}

function getObjTypeInfo(type) {
  return OBJECTIVE_TYPES.find(t => t.value === type) || { label: 'Unknown', icon: Crosshair, color: '#6b7280' };
}

// ─── Shared small components ──────────────────────────────────────────

function QuestTypeBadge({ type, size = 'sm' }) {
  const info = getQuestTypeInfo(type);
  const fontSize = size === 'lg' ? 13 : 11;
  const padding = size === 'lg' ? '4px 12px' : '2px 8px';
  return (
    <span style={{
      padding, fontSize, fontWeight: 600, borderRadius: 4,
      background: info.color, color: '#fff', whiteSpace: 'nowrap',
    }}>
      {info.label}
    </span>
  );
}

function ObjTypeBadge({ type }) {
  const info = getObjTypeInfo(type);
  const IconComp = info.icon;
  return (
    <span style={{
      padding: '2px 8px', fontSize: 11, fontWeight: 600, borderRadius: 4,
      background: `${info.color}22`, border: `1px solid ${info.color}44`,
      color: info.color, display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      <IconComp size={12} />
      {info.label}
    </span>
  );
}

function Toggle({ value, onChange, label }) {
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
  const ref = useRef(null);
  const available = options.filter(o => !sel.includes(o.value));

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
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
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
          maxHeight: 200, overflowY: 'auto', marginTop: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
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
    <div>
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

// ─── Default templates ────────────────────────────────────────────────

function newQuestTemplate() {
  return {
    ConfigVersion: 8,
    ID: 0,
    Type: 3,
    Title: '',
    Descriptions: [''],
    ObjectiveText: '',
    PreQuestIDs: [],
    FollowUpQuest: -1,
    QuestGiverIDs: [],
    QuestTurnInIDs: [],
    IsAchievement: 0,
    Repeatable: 0,
    IsDailyQuest: 0,
    IsWeeklyQuest: 0,
    CancelQuestOnPlayerDeath: 1,
    Autocomplete: 0,
    IsGroupQuest: 0,
    SequentialObjectives: 0,
    ObjectiveFiles: [],
    QuestItems: [],
    Rewards: [],
    NeedToSelectReward: 0,
    RewardsForGroupOwnerOnly: 0,
    ReputationReward: 0,
    ReputationRequirement: -1,
    RandomReward: 0,
    RandomRewardAmount: 0,
  };
}

function newObjectiveTemplate(objType) {
  const base = {
    ConfigVersion: 8,
    ID: 0,
    ObjectiveType: objType,
    ObjectiveText: '',
    TimeLimit: -1,
  };
  switch (objType) {
    case 2: // Target
      return { ...base, Amount: 1, AllowedClassNames: [], CountSelfKill: 1, NeedSpecialWeapon: 0, SpecialWeapon: [] };
    case 3: // Travel
      return { ...base, Position: [0, 0, 0], MaxDistance: 10, MarkerName: '', ShowDistance: 1 };
    case 4: // Collection
      return { ...base, Collections: [], NeedAll: 1 };
    case 5: // Delivery
      return { ...base, Collections: [], MaxDistance: 5 };
    case 6: // Treasure Hunt
      return { ...base, Position: [0, 0, 0], MaxDistance: 10, LootItemClassName: '', LootItemAmount: 1 };
    case 7: // AI Patrol
      return { ...base, Amount: 1, Position: [0, 0, 0], MinDistRadius: 100, MaxDistRadius: 500 };
    case 8: // AI Camp
      return { ...base, Amount: 1, Position: [0, 0, 0], MinDistRadius: 100, MaxDistRadius: 500 };
    case 9: // AI VIP
      return { ...base, Position: [0, 0, 0], MaxDistance: 10 };
    case 10: // Action
      return { ...base, ActionNames: [] };
    case 11: // Crafting
      return { ...base, Collections: [], NeedAll: 1 };
    default:
      return base;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  LEFT PANEL — Quest List
// ═══════════════════════════════════════════════════════════════════════

function QuestListPanel({ quests, selectedId, onSelect, onCreate }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('id');

  const filtered = quests.filter(q => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (q.Title || '').toLowerCase().includes(s) ||
      String(q.ID || '').includes(s);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'id') return (a.ID || 0) - (b.ID || 0);
    if (sortBy === 'title') return (a.Title || '').localeCompare(b.Title || '');
    if (sortBy === 'type') return (a.Type || 0) - (b.Type || 0);
    return 0;
  });

  return (
    <div style={{
      width: 260, minWidth: 260, borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', background: 'var(--bg-surface, var(--bg-card))',
      height: '100%', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)' }}>
        <button className="btn btn-primary" onClick={onCreate}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, padding: '8px 12px', marginBottom: 8 }}>
          <Plus size={14} /> New Quest
        </button>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input className="input" placeholder="Search quests..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', fontSize: 12, paddingLeft: 28 }} />
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {['id', 'title', 'type'].map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              style={{
                flex: 1, padding: '2px 4px', fontSize: 10, fontWeight: sortBy === s ? 700 : 400,
                borderRadius: 3, border: '1px solid var(--border)', cursor: 'pointer',
                background: sortBy === s ? 'var(--accent-blue)' : 'var(--bg-deep)',
                color: sortBy === s ? '#fff' : 'var(--text-muted)', textTransform: 'uppercase',
              }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Quest list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {sorted.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            {quests.length === 0 ? 'No quests found. Create one to get started.' : 'No matching quests.'}
          </div>
        )}
        {sorted.map(q => {
          const isActive = selectedId === q.ID;
          const typeInfo = getQuestTypeInfo(q.Type);
          return (
            <div key={q.ID}
              onClick={() => onSelect(q.ID)}
              style={{
                padding: '8px 12px', cursor: 'pointer', borderLeft: `3px solid ${isActive ? typeInfo.color : 'transparent'}`,
                background: isActive ? 'var(--bg-elevated, var(--bg-deep))' : 'transparent',
                borderBottom: '1px solid var(--border)',
                transition: 'all 0.1s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-deep)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)', minWidth: 28 }}>#{q.ID}</span>
                <QuestTypeBadge type={q.Type} />
                {q.Repeatable ? (
                  <RefreshCw size={10} style={{ color: 'var(--accent-green)', marginLeft: 'auto' }} />
                ) : null}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {q.Title || '(untitled)'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                {q.ObjectiveCount || 0} objectives
                {q.IsDailyQuest ? ' | Daily' : q.IsWeeklyQuest ? ' | Weekly' : ''}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer count */}
      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
        {quests.length} quest{quests.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  OBJECTIVE EDITOR (inline card within center panel)
// ═══════════════════════════════════════════════════════════════════════

function ObjectiveEditor({ objective, index, onChange, onRemove, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [expanded, setExpanded] = useState(true);
  const info = getObjTypeInfo(objective.ObjectiveType);
  const IconComp = info.icon;
  const upd = (key, val) => onChange({ ...objective, [key]: val });

  const fieldRow = (label, content) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 160, fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{content}</div>
    </div>
  );

  return (
    <div style={{
      border: `1px solid ${info.color}44`, borderRadius: 8, marginBottom: 8,
      background: 'var(--bg-surface, var(--bg-card))', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: `${info.color}11`, borderBottom: expanded ? `1px solid ${info.color}33` : 'none',
        cursor: 'pointer',
      }} onClick={() => setExpanded(!expanded)}>
        <div style={{
          width: 24, height: 24, borderRadius: 6, background: info.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <IconComp size={14} color="#fff" />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: info.color }}>#{index + 1}</span>
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
          {objective.ObjectiveText || info.label + ' Objective'}
        </span>
        <ObjTypeBadge type={objective.ObjectiveType} />
        <div style={{ display: 'flex', gap: 2 }}>
          {!isFirst && (
            <button onClick={e => { e.stopPropagation(); onMoveUp(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
              <ChevronUp size={14} />
            </button>
          )}
          {!isLast && (
            <button onClick={e => { e.stopPropagation(); onMoveDown(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
              <ChevronDown size={14} />
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); onRemove(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}>
            <Trash2 size={14} />
          </button>
        </div>
        {expanded ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: '8px 16px' }}>
          {fieldRow('Objective Text', (
            <input className="input" value={objective.ObjectiveText || ''} onChange={e => upd('ObjectiveText', e.target.value)}
              style={{ width: '100%', fontSize: 12 }} placeholder="Describe this objective..." />
          ))}
          {fieldRow('Time Limit', (
            <input className="input" type="number" value={objective.TimeLimit ?? -1} onChange={e => upd('TimeLimit', Number(e.target.value))}
              style={{ width: 100, fontSize: 12 }} />
          ))}

          {/* Type-specific fields */}
          {renderTypeSpecificFields(objective, upd, fieldRow)}
        </div>
      )}
    </div>
  );
}

function renderTypeSpecificFields(obj, upd, fieldRow) {
  const type = obj.ObjectiveType;

  switch (type) {
    case 2: // Target/Kill
      return (<>
        {fieldRow('Kill Amount', (
          <input className="input" type="number" value={obj.Amount ?? 1} onChange={e => upd('Amount', Number(e.target.value))}
            style={{ width: 100, fontSize: 12 }} />
        ))}
        {fieldRow('Allowed ClassNames', (
          <ClassNameArrayEditor items={obj.AllowedClassNames} onChange={v => upd('AllowedClassNames', v)} />
        ))}
        {fieldRow('Count Self Kill', <Toggle value={obj.CountSelfKill ?? 1} onChange={v => upd('CountSelfKill', v)} />)}
        {fieldRow('Need Special Weapon', <Toggle value={obj.NeedSpecialWeapon ?? 0} onChange={v => upd('NeedSpecialWeapon', v)} />)}
        {obj.NeedSpecialWeapon ? fieldRow('Special Weapons', (
          <ClassNameArrayEditor items={obj.SpecialWeapon} onChange={v => upd('SpecialWeapon', v)} />
        )) : null}
      </>);

    case 3: // Travel
      return (<>
        {fieldRow('Position', (
          <PositionEditor value={obj.Position || [0, 0, 0]} onChange={v => upd('Position', v)} />
        ))}
        {fieldRow('Max Distance', (
          <input className="input" type="number" value={obj.MaxDistance ?? 10} onChange={e => upd('MaxDistance', Number(e.target.value))}
            style={{ width: 100, fontSize: 12 }} />
        ))}
        {fieldRow('Marker Name', (
          <input className="input" value={obj.MarkerName || ''} onChange={e => upd('MarkerName', e.target.value)}
            style={{ width: 200, fontSize: 12 }} placeholder="Optional map marker..." />
        ))}
        {fieldRow('Show Distance', <Toggle value={obj.ShowDistance ?? 1} onChange={v => upd('ShowDistance', v)} />)}
      </>);

    case 4: // Collection
    case 11: // Crafting
      return (<>
        {fieldRow('Items Required', (
          <ItemArrayEditor items={obj.Collections} onChange={v => upd('Collections', v)}
            fields={[{ key: 'ClassName', label: 'Class Name', flex: 2 }, { key: 'Amount', label: 'Qty', type: 'number', default: 1 }]} />
        ))}
        {fieldRow('Need All Items', <Toggle value={obj.NeedAll ?? 1} onChange={v => upd('NeedAll', v)} />)}
      </>);

    case 5: // Delivery
      return (<>
        {fieldRow('Delivery Items', (
          <ItemArrayEditor items={obj.Collections} onChange={v => upd('Collections', v)}
            fields={[{ key: 'ClassName', label: 'Class Name', flex: 2 }, { key: 'Amount', label: 'Qty', type: 'number', default: 1 }]} />
        ))}
        {fieldRow('Max Distance', (
          <input className="input" type="number" value={obj.MaxDistance ?? 5} onChange={e => upd('MaxDistance', Number(e.target.value))}
            style={{ width: 100, fontSize: 12 }} />
        ))}
      </>);

    case 6: // Treasure Hunt
      return (<>
        {fieldRow('Position', (
          <PositionEditor value={obj.Position || [0, 0, 0]} onChange={v => upd('Position', v)} />
        ))}
        {fieldRow('Max Distance', (
          <input className="input" type="number" value={obj.MaxDistance ?? 10} onChange={e => upd('MaxDistance', Number(e.target.value))}
            style={{ width: 100, fontSize: 12 }} />
        ))}
        {fieldRow('Loot Item', (
          <input className="input" value={obj.LootItemClassName || ''} onChange={e => upd('LootItemClassName', e.target.value)}
            style={{ width: 200, fontSize: 12 }} placeholder="Treasure item class name..." />
        ))}
        {fieldRow('Loot Amount', (
          <input className="input" type="number" value={obj.LootItemAmount ?? 1} onChange={e => upd('LootItemAmount', Number(e.target.value))}
            style={{ width: 100, fontSize: 12 }} />
        ))}
      </>);

    case 7: // AI Patrol
    case 8: // AI Camp
      return (<>
        {fieldRow('AI Amount', (
          <input className="input" type="number" value={obj.Amount ?? 1} onChange={e => upd('Amount', Number(e.target.value))}
            style={{ width: 100, fontSize: 12 }} />
        ))}
        {fieldRow('Position', (
          <PositionEditor value={obj.Position || [0, 0, 0]} onChange={v => upd('Position', v)} />
        ))}
        {fieldRow('Min Distance Radius', (
          <input className="input" type="number" value={obj.MinDistRadius ?? 100} onChange={e => upd('MinDistRadius', Number(e.target.value))}
            style={{ width: 100, fontSize: 12 }} />
        ))}
        {fieldRow('Max Distance Radius', (
          <input className="input" type="number" value={obj.MaxDistRadius ?? 500} onChange={e => upd('MaxDistRadius', Number(e.target.value))}
            style={{ width: 100, fontSize: 12 }} />
        ))}
      </>);

    case 9: // AI VIP
      return (<>
        {fieldRow('Position', (
          <PositionEditor value={obj.Position || [0, 0, 0]} onChange={v => upd('Position', v)} />
        ))}
        {fieldRow('Max Distance', (
          <input className="input" type="number" value={obj.MaxDistance ?? 10} onChange={e => upd('MaxDistance', Number(e.target.value))}
            style={{ width: 100, fontSize: 12 }} />
        ))}
      </>);

    case 10: // Action
      return (<>
        {fieldRow('Action Names', (
          <ClassNameArrayEditor items={obj.ActionNames} onChange={v => upd('ActionNames', v)} placeholder="Action class name..." />
        ))}
      </>);

    default:
      return null;
  }
}

function PositionEditor({ value, onChange }) {
  const pos = Array.isArray(value) ? value : [0, 0, 0];
  const upd = (i, v) => { const next = [...pos]; next[i] = v; onChange(next); };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {['X', 'Y', 'Z'].map((label, i) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', width: 12 }}>{label}</span>
          <input className="input" type="number" step="0.1" value={pos[i] ?? 0}
            onChange={e => upd(i, Number(e.target.value))}
            style={{ width: 80, fontSize: 12 }} />
        </div>
      ))}
    </div>
  );
}

function ClassNameArrayEditor({ items, onChange, placeholder }) {
  const list = Array.isArray(items) ? items : [];
  const [inputVal, setInputVal] = useState('');
  const addItem = () => {
    if (inputVal.trim()) {
      onChange([...list, inputVal.trim()]);
      setInputVal('');
    }
  };
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        {list.map((item, i) => (
          <span key={i} style={{
            padding: '2px 8px', fontSize: 11, borderRadius: 3, fontFamily: 'var(--font-mono, monospace)',
            background: 'var(--bg-deep)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {item}
            <span style={{ cursor: 'pointer', color: 'var(--accent-red)', fontWeight: 700 }}
              onClick={() => onChange(list.filter((_, j) => j !== i))}>x</span>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input className="input" value={inputVal} onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
          placeholder={placeholder || 'Class name...'} style={{ flex: 1, fontSize: 12 }} />
        <button className="btn btn-secondary" onClick={addItem} style={{ fontSize: 11, padding: '4px 8px' }}>
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  CENTER PANEL — Quest Builder
// ═══════════════════════════════════════════════════════════════════════

function QuestBuilderPanel({ quest, quests, npcs, objectives, onObjectivesChange, onQuestChange, onSave, onDelete, saving }) {
  const q = quest;
  const upd = (key, val) => onQuestChange({ ...q, [key]: val });

  const questOptions = quests.filter(x => x.ID !== q.ID)
    .map(x => ({ value: x.ID, label: `#${x.ID} - ${x.Title || '(untitled)'}` }));
  const npcOptions = npcs.map(n => ({ value: n.ID, label: `#${n.ID} - ${n.NPCName || n.ClassName || 'NPC'}` }));

  const sectionHeader = (title, color, rightContent) => (
    <div style={{
      padding: '10px 16px', fontWeight: 700, fontSize: 14,
      borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${color}`,
      background: 'var(--bg-surface, var(--bg-deep))', marginTop: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <span>{title}</span>
      {rightContent}
    </div>
  );

  const fieldRow = (label, content) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 200, fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{content}</div>
    </div>
  );

  const typeInfo = getQuestTypeInfo(q.Type);

  // Add objective handler
  const [showObjTypeMenu, setShowObjTypeMenu] = useState(false);
  const addObjective = (objType) => {
    const newObj = newObjectiveTemplate(objType);
    onObjectivesChange([...objectives, newObj]);
    setShowObjTypeMenu(false);
  };

  const updateObjective = (idx, obj) => {
    const next = [...objectives];
    next[idx] = obj;
    onObjectivesChange(next);
  };

  const removeObjective = (idx) => {
    onObjectivesChange(objectives.filter((_, i) => i !== idx));
  };

  const moveObjective = (idx, dir) => {
    const next = [...objectives];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onObjectivesChange(next);
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
      {/* Top action bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8, background: typeInfo.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 800, color: '#fff',
        }}>
          {q.ID || '?'}
        </div>
        <div style={{ flex: 1 }}>
          <input className="input" value={q.Title || ''} onChange={e => upd('Title', e.target.value)}
            placeholder="Quest Title..."
            style={{ fontSize: 18, fontWeight: 600, width: '100%', background: 'transparent', border: 'none', borderBottom: '2px solid var(--border)', borderRadius: 0, padding: '4px 0' }} />
        </div>
        <QuestTypeBadge type={q.Type} size="lg" />
        <a
          href={toolWikiUrl('quest-editor')}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary"
          title={`Open in ${WIKI_TOOLS['quest-editor']}`}
          style={{ padding: '8px 12px', fontSize: 12, textDecoration: 'none' }}
        >
          Docs ↗
        </a>
        <button className="btn btn-primary" onClick={onSave} disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 16px' }}>
          <Save size={14} /> {saving ? 'Saving...' : 'Save'}
        </button>
        {q.ID > 0 && (
          <button className="btn btn-danger" onClick={onDelete}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '8px 12px' }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Quest Header */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        {sectionHeader('Basic Info', typeInfo.color)}
        {fieldRow('Quest ID', (
          <span style={{ fontSize: 13, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary)' }}>
            {q.ID || '(auto-assigned on save)'}
          </span>
        ))}
        {fieldRow('Type', (
          <select className="input" value={q.Type ?? 3} onChange={e => upd('Type', Number(e.target.value))} style={{ fontSize: 13, maxWidth: 200 }}>
            {QUEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        ))}
        {fieldRow('Objective Text', (
          <input className="input" value={q.ObjectiveText || ''} onChange={e => upd('ObjectiveText', e.target.value)}
            style={{ width: '100%', fontSize: 12 }} placeholder="Brief summary shown in quest log..." />
        ))}
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
              style={{ fontSize: 11, padding: '2px 10px' }}><Plus size={12} /> Add</button>
          </div>
        ))}
      </div>

      {/* Quest Properties */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        {sectionHeader('Quest Properties', '#6366f1')}
        {fieldRow('Follow-Up Quest', (
          <select className="input" value={q.FollowUpQuest ?? -1} onChange={e => upd('FollowUpQuest', Number(e.target.value))} style={{ fontSize: 13, maxWidth: 300 }}>
            <option value={-1}>None</option>
            {questOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {fieldRow('Pre-Quest IDs', (
          <MultiSelect options={questOptions} selected={q.PreQuestIDs || []} onChange={v => upd('PreQuestIDs', v)} placeholder="Select prerequisite quests..." />
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
          <div style={{ padding: '8px 16px', borderRight: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Is Achievement</span>
            <Toggle value={q.IsAchievement ?? 0} onChange={v => upd('IsAchievement', v)} />
          </div>
          <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Repeatable</span>
            <Toggle value={q.Repeatable ?? 0} onChange={v => upd('Repeatable', v)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
          <div style={{ padding: '8px 16px', borderRight: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Daily Quest</span>
            <Toggle value={q.IsDailyQuest ?? 0} onChange={v => upd('IsDailyQuest', v)} />
          </div>
          <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Weekly Quest</span>
            <Toggle value={q.IsWeeklyQuest ?? 0} onChange={v => upd('IsWeeklyQuest', v)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
          <div style={{ padding: '8px 16px', borderRight: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Cancel On Death</span>
            <Toggle value={q.CancelQuestOnPlayerDeath ?? 1} onChange={v => upd('CancelQuestOnPlayerDeath', v)} />
          </div>
          <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Autocomplete</span>
            <Toggle value={q.Autocomplete ?? 0} onChange={v => upd('Autocomplete', v)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ padding: '8px 16px', borderRight: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Group Quest</span>
            <Toggle value={q.IsGroupQuest ?? 0} onChange={v => upd('IsGroupQuest', v)} />
          </div>
          <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Sequential Objectives</span>
            <Toggle value={q.SequentialObjectives ?? 0} onChange={v => upd('SequentialObjectives', v)} />
          </div>
        </div>
      </div>

      {/* NPCs */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        {sectionHeader('Quest Givers & Turn-in', '#22c55e')}
        {fieldRow('Quest Giver NPCs', (
          <MultiSelect options={npcOptions} selected={q.QuestGiverIDs || []} onChange={v => upd('QuestGiverIDs', v)} placeholder="Select quest givers..." />
        ))}
        {fieldRow('Quest Turn-In NPCs', (
          <MultiSelect options={npcOptions} selected={q.QuestTurnInIDs || []} onChange={v => upd('QuestTurnInIDs', v)} placeholder="Select turn-in NPCs..." />
        ))}
        {/* NPC cards */}
        {(q.QuestGiverIDs || []).length > 0 && (
          <div style={{ padding: '8px 16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(q.QuestGiverIDs || []).map(npcId => {
              const npc = npcs.find(n => n.ID === npcId);
              if (!npc) return null;
              return (
                <div key={npcId} style={{
                  padding: '6px 12px', borderRadius: 6, background: 'var(--bg-deep)', border: '1px solid var(--accent-green)',
                  fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-green)' }} />
                  <span style={{ fontWeight: 500 }}>{npc.NPCName || npc.ClassName || 'NPC'}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>#{npc.ID}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, fontStyle: 'italic' }}>giver</span>
                </div>
              );
            })}
            {(q.QuestTurnInIDs || []).map(npcId => {
              const npc = npcs.find(n => n.ID === npcId);
              if (!npc) return null;
              return (
                <div key={`ti-${npcId}`} style={{
                  padding: '6px 12px', borderRadius: 6, background: 'var(--bg-deep)', border: '1px solid var(--accent-orange, #f59e0b)',
                  fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-orange, #f59e0b)' }} />
                  <span style={{ fontWeight: 500 }}>{npc.NPCName || npc.ClassName || 'NPC'}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>#{npc.ID}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, fontStyle: 'italic' }}>turn-in</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Objectives */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        {sectionHeader('Objectives', '#3b82f6', (
          <div style={{ position: 'relative' }}>
            <button className="btn btn-secondary" onClick={() => setShowObjTypeMenu(!showObjTypeMenu)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 10px' }}>
              <Plus size={12} /> Add Objective
            </button>
            {showObjTypeMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4,
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)', minWidth: 200, overflow: 'hidden',
              }}>
                {OBJECTIVE_TYPES.map(ot => {
                  const OtIcon = ot.icon;
                  return (
                    <div key={ot.value}
                      onClick={() => addObjective(ot.value)}
                      style={{
                        padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        borderBottom: '1px solid var(--border)', fontSize: 13,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = `${ot.color}22`}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <OtIcon size={14} color={ot.color} />
                      <span>{ot.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        <div style={{ padding: 12 }}>
          {objectives.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No objectives yet. Click "Add Objective" to create one.
            </div>
          ) : (
            <>
              {/* Visual timeline connector */}
              {objectives.map((obj, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  {i > 0 && (
                    <div style={{
                      position: 'absolute', left: 23, top: -4, width: 2, height: 8,
                      background: 'var(--border)',
                    }} />
                  )}
                  <ObjectiveEditor
                    objective={obj}
                    index={i}
                    onChange={updated => updateObjective(i, updated)}
                    onRemove={() => removeObjective(i)}
                    onMoveUp={() => moveObjective(i, -1)}
                    onMoveDown={() => moveObjective(i, 1)}
                    isFirst={i === 0}
                    isLast={i === objectives.length - 1}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Rewards */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        {sectionHeader('Rewards', '#f59e0b')}
        {fieldRow('Reputation Reward', (
          <input className="input" type="number" value={q.ReputationReward ?? 0} onChange={e => upd('ReputationReward', Number(e.target.value))}
            style={{ width: 120, fontSize: 12 }} />
        ))}
        {fieldRow('Reputation Requirement', (
          <input className="input" type="number" value={q.ReputationRequirement ?? -1} onChange={e => upd('ReputationRequirement', Number(e.target.value))}
            style={{ width: 120, fontSize: 12 }} />
        ))}
        {fieldRow('Need To Select Reward', <Toggle value={q.NeedToSelectReward ?? 0} onChange={v => upd('NeedToSelectReward', v)} />)}
        {fieldRow('Random Reward', <Toggle value={q.RandomReward ?? 0} onChange={v => upd('RandomReward', v)} />)}
        {q.RandomReward ? fieldRow('Random Reward Amount', (
          <input className="input" type="number" value={q.RandomRewardAmount ?? 0} onChange={e => upd('RandomRewardAmount', Number(e.target.value))}
            style={{ width: 120, fontSize: 12 }} />
        )) : null}
        {fieldRow('Rewards For Group Owner Only', <Toggle value={q.RewardsForGroupOwnerOnly ?? 0} onChange={v => upd('RewardsForGroupOwnerOnly', v)} />)}
        {fieldRow('Reward Items', (
          <ItemArrayEditor items={q.Rewards} onChange={v => upd('Rewards', v)}
            fields={[{ key: 'ClassName', label: 'Class Name', flex: 2 }, { key: 'Amount', label: 'Amount', type: 'number', default: 1 }]} />
        ))}
      </div>

      {/* Quest Items */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        {sectionHeader('Quest Items', '#8b5cf6')}
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Items given to the player when the quest starts.
          </div>
          <ItemArrayEditor items={q.QuestItems} onChange={v => upd('QuestItems', v)}
            fields={[{ key: 'ClassName', label: 'Class Name', flex: 2 }, { key: 'Amount', label: 'Amount', type: 'number', default: 1 }]} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  RIGHT PANEL — Map Preview & Quest Flow
// ═══════════════════════════════════════════════════════════════════════

function QuestPreviewPanel({ quest, objectives, npcs, collapsed, onToggle, serverId }) {
  const serverMap = useServerMap(serverId);
  if (collapsed) {
    return (
      <div style={{
        width: 32, minWidth: 32, borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8,
        background: 'var(--bg-surface, var(--bg-card))', cursor: 'pointer',
      }} onClick={onToggle}>
        <ChevronRight size={16} style={{ color: 'var(--text-muted)', transform: 'rotate(180deg)' }} />
        <span style={{ writingMode: 'vertical-rl', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Preview</span>
      </div>
    );
  }

  // Collect map markers from objectives with positions
  const markers = [];
  objectives.forEach((obj, i) => {
    if (obj.Position && (obj.Position[0] || obj.Position[2])) {
      const info = getObjTypeInfo(obj.ObjectiveType);
      markers.push({
        id: `obj-${i}`,
        x: obj.Position[0],
        z: obj.Position[2],
        label: `#${i + 1} ${info.label}`,
        color: info.color,
      });
    }
  });

  // NPC markers
  const allNpcIds = [...(quest.QuestGiverIDs || []), ...(quest.QuestTurnInIDs || [])];
  const uniqueNpcIds = [...new Set(allNpcIds)];
  uniqueNpcIds.forEach(npcId => {
    const npc = npcs.find(n => n.ID === npcId);
    if (npc && npc.Position && (npc.Position[0] || npc.Position[2])) {
      markers.push({
        id: `npc-${npcId}`,
        x: npc.Position[0],
        z: npc.Position[2],
        label: npc.NPCName || 'NPC',
        color: '#22c55e',
      });
    }
  });

  return (
    <div style={{
      width: 320, minWidth: 320, borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', background: 'var(--bg-surface, var(--bg-card))',
      height: '100%', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Preview</span>
        <button onClick={onToggle}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Map */}
      {markers.length > 0 ? (
        <div style={{ height: 300, borderBottom: '1px solid var(--border)' }}>
          <Suspense fallback={<div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading map...</div>}>
            <InteractiveMap
              mapName={serverMap}
              markers={markers}
              height={300}
              mode="view"
            />
          </Suspense>
        </div>
      ) : (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
          No positions to display on map.
          <br />Add Travel, AI, or Treasure objectives with coordinates.
        </div>
      )}

      {/* Quest Flow Diagram */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Quest Flow</div>

        {/* NPC Giver */}
        {(quest.QuestGiverIDs || []).length > 0 && (
          <FlowNode color="#22c55e" label="Quest Giver"
            detail={(quest.QuestGiverIDs || []).map(id => {
              const npc = npcs.find(n => n.ID === id);
              return npc ? (npc.NPCName || `NPC #${id}`) : `NPC #${id}`;
            }).join(', ')} />
        )}

        {(quest.QuestGiverIDs || []).length > 0 && objectives.length > 0 && <FlowConnector />}

        {/* Objectives */}
        {objectives.map((obj, i) => {
          const info = getObjTypeInfo(obj.ObjectiveType);
          return (
            <div key={i}>
              <FlowNode color={info.color} label={`#${i + 1} ${info.label}`}
                detail={obj.ObjectiveText || ''} />
              {i < objectives.length - 1 && <FlowConnector />}
            </div>
          );
        })}

        {objectives.length > 0 && (quest.QuestTurnInIDs || []).length > 0 && <FlowConnector />}

        {/* NPC Turn-in */}
        {(quest.QuestTurnInIDs || []).length > 0 && (
          <FlowNode color="#f59e0b" label="Turn In"
            detail={(quest.QuestTurnInIDs || []).map(id => {
              const npc = npcs.find(n => n.ID === id);
              return npc ? (npc.NPCName || `NPC #${id}`) : `NPC #${id}`;
            }).join(', ')} />
        )}

        {/* Rewards summary */}
        {(quest.Rewards || []).length > 0 && (
          <>
            <FlowConnector />
            <FlowNode color="#a855f7" label="Rewards"
              detail={(quest.Rewards || []).map(r => `${r.Amount}x ${r.ClassName}`).join(', ')} />
          </>
        )}
      </div>
    </div>
  );
}

function FlowNode({ color, label, detail }) {
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 6, borderLeft: `3px solid ${color}`,
      background: `${color}11`, fontSize: 12,
    }}>
      <div style={{ fontWeight: 600, color }}>{label}</div>
      {detail && <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>{detail}</div>}
    </div>
  );
}

function FlowConnector() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
      <div style={{ width: 2, height: 16, background: 'var(--border)' }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════

export default function QuestCreatorPage({ serverId }) {
  const [quests, setQuests] = useState([]);
  const [npcs, setNpcs] = useState([]);
  const [selectedQuestId, setSelectedQuestId] = useState(null);
  const [editingQuest, setEditingQuest] = useState(null);
  const [editingObjectives, setEditingObjectives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  const base = `/api/servers/${serverId}/expansion`;

  // Load all quests + NPCs
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, nRes] = await Promise.all([
        API.get(`${base}/quests`),
        API.get(`${base}/npcs`),
      ]);
      setQuests(Array.isArray(qRes) ? qRes : []);
      setNpcs(Array.isArray(nRes) ? nRes : []);
    } catch (err) {
      window.addToast?.('Failed to load quest data: ' + (err.message || ''), 'error');
    }
    setLoading(false);
  }, [base]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load full quest when selected
  const selectQuest = useCallback(async (questId) => {
    setSelectedQuestId(questId);
    try {
      const full = await API.get(`${base}/quests/${questId}/full`);
      if (full && !full.error) {
        setEditingQuest(full);
        // Extract resolved objectives
        const objs = Array.isArray(full._resolvedObjectives)
          ? full._resolvedObjectives.filter(o => !o._missing)
          : [];
        setEditingObjectives(objs);
      } else {
        // Fallback: load basic quest
        const basic = await API.get(`${base}/quests/${questId}`);
        setEditingQuest(basic);
        setEditingObjectives([]);
      }
    } catch (err) {
      window.addToast?.('Failed to load quest: ' + (err.message || ''), 'error');
    }
  }, [base]);

  // Create new quest
  const createNewQuest = () => {
    const template = newQuestTemplate();
    setSelectedQuestId(null);
    setEditingQuest(template);
    setEditingObjectives([]);
  };

  // Save quest
  const saveQuest = async () => {
    if (!editingQuest) return;
    setSaving(true);
    try {
      const isNew = !editingQuest.ID || editingQuest.ID === 0;
      const url = isNew ? `${base}/quests/full` : `${base}/quests/${editingQuest.ID}/full`;
      const method = isNew ? 'post' : 'put';

      // Clean objectives: strip internal metadata
      const cleanObjs = editingObjectives.map(obj => {
        const { _fileName, _objType, _missing, ...clean } = obj;
        return clean;
      });

      const result = await API[method](url, { quest: editingQuest, objectives: cleanObjs });
      if (result && !result.error) {
        window.addToast?.('Quest saved successfully', 'success');
        await loadData();
        if (result.ID) {
          setSelectedQuestId(result.ID);
          selectQuest(result.ID);
        }
      } else {
        window.addToast?.('Failed to save: ' + (result?.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to save quest: ' + (err.message || ''), 'error');
    }
    setSaving(false);
  };

  // Delete quest
  const deleteQuest = async () => {
    if (!editingQuest || !editingQuest.ID) return;
    if (!confirm(`Delete quest #${editingQuest.ID} "${editingQuest.Title || ''}"? This cannot be undone.`)) return;
    try {
      await API.del(`${base}/quests/${editingQuest.ID}`);
      window.addToast?.('Quest deleted', 'success');
      setEditingQuest(null);
      setEditingObjectives([]);
      setSelectedQuestId(null);
      await loadData();
    } catch (err) {
      window.addToast?.('Failed to delete: ' + (err.message || ''), 'error');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        Loading quest data...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', overflow: 'hidden' }}>
      {/* Left Panel — Quest List */}
      <QuestListPanel
        quests={quests}
        selectedId={selectedQuestId}
        onSelect={selectQuest}
        onCreate={createNewQuest}
      />

      {/* Center Panel — Quest Builder */}
      {editingQuest ? (
        <>
          <QuestBuilderPanel
            quest={editingQuest}
            quests={quests}
            npcs={npcs}
            objectives={editingObjectives}
            onObjectivesChange={setEditingObjectives}
            onQuestChange={setEditingQuest}
            onSave={saveQuest}
            onDelete={deleteQuest}
            saving={saving}
          />

          {/* Right Panel — Preview */}
          <QuestPreviewPanel
            quest={editingQuest}
            objectives={editingObjectives}
            npcs={npcs}
            collapsed={previewCollapsed}
            onToggle={() => setPreviewCollapsed(!previewCollapsed)}
            serverId={serverId}
          />
        </>
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 12, color: 'var(--text-muted)',
        }}>
          <Star size={48} style={{ opacity: 0.3 }} />
          <div style={{ fontSize: 16, fontWeight: 500 }}>Select a quest or create a new one</div>
          <div style={{ fontSize: 13 }}>Use the left panel to browse and manage quests</div>
          <button className="btn btn-primary" onClick={createNewQuest}
            style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, padding: '10px 20px' }}>
            <Plus size={16} /> Create Your First Quest
          </button>
        </div>
      )}
    </div>
  );
}
