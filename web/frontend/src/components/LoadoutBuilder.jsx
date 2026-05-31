/**
 * LoadoutBuilder — visual editor for the Expansion `ExpansionLoadout` format.
 *
 * The format is a recursive tree: every node has ClassName / Include / Chance /
 * Quantity / Health, plus children in InventoryAttachments (slot-based worn gear
 * & attachments), InventoryCargo (items in pockets/containers), and Sets (the
 * special WEAPON / MELEE / SIDEARM groups). The root node represents the
 * character itself (blank ClassName).
 *
 * This mirrors the official Expansion Loadout Builder but is catalog-aware — the
 * item picker is backed by the server's actual item classnames (vanilla + mods),
 * while still allowing free text for classnames not present in the economy.
 *
 * All editing is immutable: each editor gets `node` + `onChange(newNode)` and
 * rebuilds its subtree, so the parent always receives a fresh object tree.
 */
import { useState, useEffect } from 'react';
import { Plus, Trash2, Copy, ChevronDown, ChevronRight } from './Icon';
import ItemPicker from './ItemPicker';
import useDragReorder, { move, gripStyle } from '../hooks/useDragReorder';

// Common DayZ/Expansion attachment slot names, for the "add slot" menu.
export const DAYZ_SLOTS = [
  'Headgear', 'Mask', 'Eyewear', 'Hands', 'Gloves', 'Armband',
  'Body', 'Vest', 'Back', 'Hips', 'Legs', 'Feet', 'Shoulder', 'Melee',
];
const SET_TYPES = ['WEAPON', 'MELEE', 'SIDEARM'];

// ─── Stable React keys ───────────────────────────────────
// Loadout nodes have no natural id, and index keys make expand-state/inputs
// stick to the wrong row on remove/reorder. We tag each object with an
// enumerable `_key` (so immutable {...node} spreads carry it forward, keeping
// identity stable across edits) and strip it at serialization via stripKeys.
let _keySeq = 0;
function ensureKey(o) {
  if (o && typeof o === 'object' && !o._key) o._key = `k${++_keySeq}`;
  return o ? o._key : undefined;
}
/** Deep-clone without the transient `_key` tags — use before save/export. */
export function stripKeys(value) {
  if (Array.isArray(value)) return value.map(stripKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) if (k !== '_key') out[k] = stripKeys(value[k]);
    return out;
  }
  return value;
}

// ─── Factories ───────────────────────────────────────────
export function newNode(className = '') {
  return {
    ClassName: className,
    Include: '',
    Chance: 1.0,
    Quantity: { Min: 0.0, Max: 0.0 },
    Health: [],
    InventoryAttachments: [],
    InventoryCargo: [],
    ConstructionPartsBuilt: [],
    Sets: [],
  };
}
function newHealth() { return { Min: 0.5, Max: 1.0, Zone: '' }; }
function newSlot(name) { return { SlotName: name, Items: [] }; }
function newSet(type = 'WEAPON') { const n = newNode(type); return n; }

// ─── Small UI atoms ──────────────────────────────────────
const lbl = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 2 };
const numInput = { width: 64, fontSize: 12, padding: '3px 6px' };

function NumberField({ label, value, onChange, step = 0.05, min, max, width }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input
        className="input" type="number" step={step} min={min} max={max}
        value={value ?? 0}
        onChange={(e) => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
        style={{ ...numInput, width: width || numInput.width }}
      />
    </div>
  );
}

// ─── Health editor ───────────────────────────────────────
function HealthEditor({ health, onChange }) {
  const list = health || [];
  const set = (i, key, v) => { const next = list.map((h, j) => j === i ? { ...h, [key]: v } : h); onChange(next); };
  return (
    <div>
      <label style={lbl}>Health (0–1)</label>
      {list.length === 0 && (
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => onChange([newHealth()])}>
          <Plus size={11} /> Add range
        </button>
      )}
      {list.map((h, i) => (
        <div key={ensureKey(h)} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <input className="input" type="number" step={0.05} min={0} max={1} value={h.Min ?? 0} onChange={(e) => set(i, 'Min', parseFloat(e.target.value) || 0)} style={numInput} title="Min" />
          <span style={{ color: 'var(--text-muted)' }}>–</span>
          <input className="input" type="number" step={0.05} min={0} max={1} value={h.Max ?? 1} onChange={(e) => set(i, 'Max', parseFloat(e.target.value) || 0)} style={numInput} title="Max" />
          <input className="input" placeholder="Zone (opt)" value={h.Zone || ''} onChange={(e) => set(i, 'Zone', e.target.value)} style={{ width: 90, fontSize: 12, padding: '3px 6px' }} />
          <button className="btn btn-ghost btn-sm" style={{ padding: '2px 5px' }} title="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 size={11} /></button>
        </div>
      ))}
      {list.length > 0 && (
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => onChange([...list, newHealth()])}>
          <Plus size={11} /> Range
        </button>
      )}
    </div>
  );
}

// ─── A single loadout node (recursive) ───────────────────
function NodeEditor({ node, onChange, onRemove, onDuplicate, dragHandleProps, dragRowProps, isOver, catalog, classNameMode, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const upd = (patch) => onChange({ ...node, ...patch });
  const attCount = (node.InventoryAttachments || []).length;
  const cargoCount = (node.InventoryCargo || []).length;
  const nested = attCount + cargoCount;

  return (
    <div {...(dragRowProps || {})} style={{ border: `1px solid ${isOver ? 'var(--accent-blue)' : 'var(--border)'}`, borderRadius: 6, marginBottom: 8, background: 'var(--bg-deep)' }}>
      {/* Header row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '8px 10px', flexWrap: 'wrap' }}>
        {dragHandleProps && (
          <span {...dragHandleProps} style={{ ...gripStyle(), alignSelf: 'center' }}>⋮⋮</span>
        )}
        {classNameMode === 'set' ? (
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={lbl}>Set type</label>
            <select className="input" value={node.ClassName || 'WEAPON'} onChange={(e) => upd({ ClassName: e.target.value })} style={{ width: '100%', fontSize: 12, padding: '4px 8px' }}>
              {SET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        ) : (
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={lbl}>Item ClassName</label>
            <ItemPicker value={node.ClassName} onChange={(v) => upd({ ClassName: v })} catalog={catalog} />
          </div>
        )}
        <NumberField label="Chance" value={node.Chance} onChange={(v) => upd({ Chance: v })} min={0} max={1} width={60} />
        <NumberField label="Qty Min" value={node.Quantity?.Min} onChange={(v) => upd({ Quantity: { ...node.Quantity, Min: v } })} min={0} step={0.1} width={56} />
        <NumberField label="Qty Max" value={node.Quantity?.Max} onChange={(v) => upd({ Quantity: { ...node.Quantity, Max: v } })} min={0} step={0.1} width={56} />
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" style={{ padding: '4px 6px' }} title={expanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{nested > 0 ? ` ${nested}` : ''}
        </button>
        {onDuplicate && (
          <button className="btn btn-ghost btn-sm" style={{ padding: '4px 6px' }} title="Duplicate" onClick={onDuplicate}><Copy size={13} /></button>
        )}
        {onRemove && (
          <button className="btn btn-danger btn-sm" style={{ padding: '4px 6px' }} title="Remove" onClick={onRemove}><Trash2 size={13} /></button>
        )}
      </div>

      {expanded && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <HealthEditor health={node.Health} onChange={(h) => upd({ Health: h })} />
            <div>
              <label style={lbl}>Include (ref file)</label>
              <input className="input" value={node.Include || ''} placeholder="OtherLoadout" onChange={(e) => upd({ Include: e.target.value })} style={{ width: 160, fontSize: 12, padding: '3px 6px' }} />
            </div>
          </div>

          {/* Nested attachments (e.g. weapon → magazine, vest → holster) */}
          <AttachmentsSection
            attachments={node.InventoryAttachments}
            onChange={(a) => upd({ InventoryAttachments: a })}
            catalog={catalog}
            depth={depth + 1}
            title="Attachments"
          />
          {/* Nested cargo (e.g. backpack contents) */}
          <CargoSection
            cargo={node.InventoryCargo}
            onChange={(c) => upd({ InventoryCargo: c })}
            catalog={catalog}
            depth={depth + 1}
            title="Cargo"
          />
        </div>
      )}
    </div>
  );
}

// ─── A slot ({ SlotName, Items[] }) ──────────────────────
function SlotEditor({ slot, onChange, onRemove, catalog, depth }) {
  const items = slot.Items || [];
  const setItem = (i, v) => onChange({ ...slot, Items: items.map((it, j) => j === i ? v : it) });
  const addItem = () => onChange({ ...slot, Items: [...items, newNode('')] });
  const removeItem = (i) => onChange({ ...slot, Items: items.filter((_, j) => j !== i) });
  const dupItem = (i) => onChange({ ...slot, Items: [...items.slice(0, i + 1), stripKeys(items[i]), ...items.slice(i + 1)] });
  const dr = useDragReorder((from, to) => onChange({ ...slot, Items: move(items, from, to) }));

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 10, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>SLOT</span>
        <input className="input" value={slot.SlotName || ''} placeholder="SlotName" onChange={(e) => onChange({ ...slot, SlotName: e.target.value })} style={{ width: 140, fontSize: 12, fontWeight: 600, padding: '3px 8px' }} list="dayz-slot-list" />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items.length} candidate{items.length !== 1 ? 's' : ''}</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '3px 8px' }} onClick={addItem}><Plus size={12} /> Item</button>
        <button className="btn btn-danger btn-sm" style={{ padding: '3px 6px' }} title="Remove slot" onClick={onRemove}><Trash2 size={12} /></button>
      </div>
      {items.map((it, i) => (
        <NodeEditor key={ensureKey(it)} node={it} onChange={(v) => setItem(i, v)} onRemove={() => removeItem(i)} onDuplicate={() => dupItem(i)}
          dragHandleProps={dr.handleProps(i)} dragRowProps={dr.rowProps(i)} isOver={dr.overIndex === i} catalog={catalog} depth={depth} />
      ))}
      {items.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>No items — add candidate items the wearer may spawn with.</div>
      )}
    </div>
  );
}

// ─── InventoryAttachments section (array of slots) ───────
function AttachmentsSection({ attachments, onChange, catalog, depth, title }) {
  const list = attachments || [];
  const [newSlotName, setNewSlotName] = useState('Body');
  const setSlot = (i, v) => onChange(list.map((s, j) => j === i ? v : s));
  const removeSlot = (i) => onChange(list.filter((_, j) => j !== i));
  const addSlot = () => { onChange([...list, newSlot(newSlotName)]); };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, var(--text-primary))' }}>{title || 'Attachments'}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{list.length}</span>
        <div style={{ flex: 1 }} />
        <select className="input" value={newSlotName} onChange={(e) => setNewSlotName(e.target.value)} style={{ fontSize: 11, padding: '3px 6px', width: 120 }}>
          {DAYZ_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '3px 8px' }} onClick={addSlot}><Plus size={12} /> Slot</button>
      </div>
      {list.map((s, i) => (
        <SlotEditor key={ensureKey(s)} slot={s} onChange={(v) => setSlot(i, v)} onRemove={() => removeSlot(i)} catalog={catalog} depth={depth} />
      ))}
    </div>
  );
}

// ─── InventoryCargo section (array of nodes) ─────────────
function CargoSection({ cargo, onChange, catalog, depth, title }) {
  const list = cargo || [];
  const setItem = (i, v) => onChange(list.map((it, j) => j === i ? v : it));
  const addItem = () => onChange([...list, newNode('')]);
  const removeItem = (i) => onChange(list.filter((_, j) => j !== i));
  const dupItem = (i) => onChange([...list.slice(0, i + 1), stripKeys(list[i]), ...list.slice(i + 1)]);
  const dr = useDragReorder((from, to) => onChange(move(list, from, to)));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{title || 'Cargo'}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{list.length}</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '3px 8px' }} onClick={addItem}><Plus size={12} /> Item</button>
      </div>
      {list.map((it, i) => (
        <NodeEditor key={ensureKey(it)} node={it} onChange={(v) => setItem(i, v)} onRemove={() => removeItem(i)} onDuplicate={() => dupItem(i)}
          dragHandleProps={dr.handleProps(i)} dragRowProps={dr.rowProps(i)} isOver={dr.overIndex === i} catalog={catalog} depth={depth} />
      ))}
    </div>
  );
}

// ─── Top-level builder (root node) ───────────────────────
export default function LoadoutBuilder({ data, onChange, catalog }) {
  const [newSetType, setNewSetType] = useState('WEAPON');
  // Hook must run before the early return (rules-of-hooks); reads `data` lazily.
  const setDr = useDragReorder((from, to) => {
    if (!data) return;
    onChange({ ...data, Sets: move(data.Sets || [], from, to) });
  });
  if (!data || typeof data !== 'object') {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>This file isn’t a recognizable loadout object.</div>;
  }
  const root = data;
  const sets = root.Sets || [];
  const setSets = (s) => onChange({ ...root, Sets: s });

  return (
    <div>
      {/* Native datalist powering the slot-name inputs */}
      <datalist id="dayz-slot-list">{DAYZ_SLOTS.map((s) => <option key={s} value={s} />)}</datalist>

      <Section title="Worn Gear" hint="Slot-based clothing & armor the character spawns wearing. Each slot lists candidate items chosen by Chance.">
        <AttachmentsSection
          attachments={root.InventoryAttachments}
          onChange={(a) => onChange({ ...root, InventoryAttachments: a })}
          catalog={catalog}
          depth={0}
          title="Slots"
        />
      </Section>

      <Section title="Cargo" hint="Loose items placed in the character’s pockets/containers.">
        <CargoSection
          cargo={root.InventoryCargo}
          onChange={(c) => onChange({ ...root, InventoryCargo: c })}
          catalog={catalog}
          depth={0}
          title="Items"
        />
      </Section>

      <Section title="Weapon / Melee / Sidearm Sets" hint="Expansion’s special equipment sets. Each set holds the weapon (in its slot) plus magazines/ammo in cargo.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sets.length} set{sets.length !== 1 ? 's' : ''}</span>
          <div style={{ flex: 1 }} />
          <select className="input" value={newSetType} onChange={(e) => setNewSetType(e.target.value)} style={{ fontSize: 11, padding: '3px 6px', width: 110 }}>
            {SET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setSets([...sets, newSet(newSetType)])}><Plus size={12} /> Set</button>
        </div>
        {sets.map((s, i) => (
          <NodeEditor key={ensureKey(s)} node={s} onChange={(v) => setSets(sets.map((x, j) => j === i ? v : x))} onRemove={() => setSets(sets.filter((_, j) => j !== i))} onDuplicate={() => setSets([...sets.slice(0, i + 1), stripKeys(s), ...sets.slice(i + 1)])}
            dragHandleProps={setDr.handleProps(i)} dragRowProps={setDr.rowProps(i)} isOver={setDr.overIndex === i} catalog={catalog} classNameMode="set" depth={0} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, maxWidth: 720 }}>{hint}</div>}
      {children}
    </div>
  );
}
