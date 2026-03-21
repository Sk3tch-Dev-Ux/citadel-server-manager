import { useState, useCallback } from 'react';

/**
 * Convert a camelCase or snake_case key to a human-readable label.
 * e.g. "maxPlayerCount" -> "Max Player Count", "use_ce" -> "Use Ce"
 */
function formatLabel(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Check if a numeric value is outside schema min/max bounds.
 */
function isOutOfRange(value, propSchema) {
  if (value === '' || value === null || value === undefined) return false;
  const num = Number(value);
  if (isNaN(num)) return false;
  if (propSchema.minimum !== undefined && num < propSchema.minimum) return true;
  if (propSchema.maximum !== undefined && num > propSchema.maximum) return true;
  return false;
}

/**
 * Detect if a schema property represents a boolean-like toggle:
 * integer type with enum [0, 1].
 */
function isBooleanToggle(propSchema) {
  if (propSchema.type === 'integer' && Array.isArray(propSchema.enum)) {
    const sorted = [...propSchema.enum].sort();
    return sorted.length === 2 && sorted[0] === 0 && sorted[1] === 1;
  }
  return false;
}

/** Render a single field based on its schema type */
function SchemaField({ propKey, propSchema, value, onChange }) {
  const label = formatLabel(propKey);

  // Boolean toggle for integer enum [0,1]
  if (isBooleanToggle(propSchema)) {
    return (
      <div className="schema-field" style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={value === 1 || value === true}
            onChange={e => onChange(e.target.checked ? 1 : 0)}
            style={{ width: 18, height: 18 }}
          />
          {label}
        </label>
        {propSchema.description && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, marginLeft: 26 }}>{propSchema.description}</div>
        )}
      </div>
    );
  }

  // Boolean
  if (propSchema.type === 'boolean') {
    return (
      <div className="schema-field" style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={e => onChange(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          {label}
        </label>
        {propSchema.description && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, marginLeft: 26 }}>{propSchema.description}</div>
        )}
      </div>
    );
  }

  // String with enum -> dropdown
  if (propSchema.type === 'string' && Array.isArray(propSchema.enum)) {
    return (
      <div className="schema-field" style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{label}</label>
        <select
          className="input"
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%', maxWidth: 400 }}
        >
          <option value="">-- Select --</option>
          {propSchema.enum.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {propSchema.description && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{propSchema.description}</div>
        )}
      </div>
    );
  }

  // Number / Integer
  if (propSchema.type === 'number' || propSchema.type === 'integer') {
    // Integer with enum (not 0/1) -> dropdown
    if (Array.isArray(propSchema.enum)) {
      return (
        <div className="schema-field" style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{label}</label>
          <select
            className="input"
            value={value ?? ''}
            onChange={e => onChange(Number(e.target.value))}
            style={{ width: '100%', maxWidth: 400 }}
          >
            <option value="">-- Select --</option>
            {propSchema.enum.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {propSchema.description && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{propSchema.description}</div>
          )}
        </div>
      );
    }

    const invalid = isOutOfRange(value, propSchema);
    const rangeHint = [];
    if (propSchema.minimum !== undefined) rangeHint.push(`Min: ${propSchema.minimum}`);
    if (propSchema.maximum !== undefined) rangeHint.push(`Max: ${propSchema.maximum}`);

    return (
      <div className="schema-field" style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{label}</label>
        <input
          type="number"
          className="input"
          value={value ?? ''}
          min={propSchema.minimum}
          max={propSchema.maximum}
          step={propSchema.type === 'integer' ? 1 : 'any'}
          onChange={e => {
            const v = e.target.value;
            if (v === '') { onChange(propSchema.default ?? ''); return; }
            onChange(propSchema.type === 'integer' ? parseInt(v, 10) : parseFloat(v));
          }}
          style={{
            width: '100%',
            maxWidth: 400,
            borderColor: invalid ? 'var(--danger, #e53e3e)' : undefined,
            boxShadow: invalid ? '0 0 0 1px var(--danger, #e53e3e)' : undefined,
          }}
        />
        {rangeHint.length > 0 && (
          <div style={{ fontSize: 11, color: invalid ? 'var(--danger, #e53e3e)' : 'var(--text-muted)', marginTop: 2 }}>
            {rangeHint.join(' | ')}
          </div>
        )}
        {propSchema.description && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{propSchema.description}</div>
        )}
      </div>
    );
  }

  // String (plain)
  if (propSchema.type === 'string') {
    return (
      <div className="schema-field" style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{label}</label>
        <input
          type="text"
          className="input"
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%', maxWidth: 400 }}
        />
        {propSchema.description && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{propSchema.description}</div>
        )}
      </div>
    );
  }

  // Array of objects -> table
  if (propSchema.type === 'array' && propSchema.items?.type === 'object' && propSchema.items?.properties) {
    const itemProps = propSchema.items.properties;
    const columns = Object.keys(itemProps);
    const rows = Array.isArray(value) ? value : [];

    const updateRow = (idx, col, val) => {
      const newRows = rows.map((r, i) => i === idx ? { ...r, [col]: val } : r);
      onChange(newRows);
    };

    const addRow = () => {
      const newRow = {};
      columns.forEach(col => {
        const t = itemProps[col]?.type;
        newRow[col] = itemProps[col]?.default ?? (t === 'number' || t === 'integer' ? 0 : t === 'boolean' ? false : '');
      });
      onChange([...rows, newRow]);
    };

    const removeRow = (idx) => {
      onChange(rows.filter((_, i) => i !== idx));
    };

    return (
      <div className="schema-field" style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{label}</label>
        {propSchema.description && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{propSchema.description}</div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600 }}>
                    {formatLabel(col)}
                  </th>
                ))}
                <th style={{ width: 40, borderBottom: '1px solid var(--border)' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  {columns.map(col => (
                    <td key={col} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                      {itemProps[col]?.type === 'boolean' ? (
                        <input type="checkbox" checked={!!row[col]} onChange={e => updateRow(idx, col, e.target.checked)} />
                      ) : itemProps[col]?.type === 'number' || itemProps[col]?.type === 'integer' ? (
                        <input type="number" className="input" value={row[col] ?? ''} onChange={e => updateRow(idx, col, Number(e.target.value))} style={{ width: '100%', minWidth: 60 }} />
                      ) : (
                        <input type="text" className="input" value={row[col] ?? ''} onChange={e => updateRow(idx, col, e.target.value)} style={{ width: '100%', minWidth: 80 }} />
                      )}
                    </td>
                  ))}
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                    <button className="btn btn-secondary" onClick={() => removeRow(idx)} style={{ padding: '2px 8px', fontSize: 12 }} title="Remove row">
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={columns.length + 1} style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No items</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <button className="btn btn-secondary" onClick={addRow} style={{ marginTop: 8, fontSize: 12 }}>
          + Add Row
        </button>
      </div>
    );
  }

  // Array of primitives
  if (propSchema.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    const itemType = propSchema.items?.type || 'string';

    const updateItem = (idx, val) => {
      const newItems = items.map((v, i) => i === idx ? val : v);
      onChange(newItems);
    };
    const addItem = () => {
      const def = propSchema.items?.default ?? (itemType === 'number' || itemType === 'integer' ? 0 : '');
      onChange([...items, def]);
    };
    const removeItem = (idx) => onChange(items.filter((_, i) => i !== idx));

    return (
      <div className="schema-field" style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{label}</label>
        {propSchema.description && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{propSchema.description}</div>
        )}
        {items.map((item, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
            <input
              type={itemType === 'number' || itemType === 'integer' ? 'number' : 'text'}
              className="input"
              value={item ?? ''}
              onChange={e => updateItem(idx, itemType === 'number' || itemType === 'integer' ? Number(e.target.value) : e.target.value)}
              style={{ flex: 1, maxWidth: 400 }}
            />
            <button className="btn btn-secondary" onClick={() => removeItem(idx)} style={{ padding: '2px 8px', fontSize: 12 }}>&times;</button>
          </div>
        ))}
        <button className="btn btn-secondary" onClick={addItem} style={{ marginTop: 4, fontSize: 12 }}>+ Add Item</button>
      </div>
    );
  }

  // Object with properties -> nested section (recursive)
  if (propSchema.type === 'object' && propSchema.properties) {
    return (
      <div className="schema-field" style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 600, fontSize: 15, marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>{label}</label>
        {propSchema.description && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{propSchema.description}</div>
        )}
        <div style={{ paddingLeft: 16, borderLeft: '2px solid var(--border)' }}>
          <SchemaEditor
            schema={propSchema}
            data={value && typeof value === 'object' ? value : {}}
            onChange={newVal => onChange(newVal)}
          />
        </div>
      </div>
    );
  }

  // Fallback: plain text input
  return (
    <div className="schema-field" style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{label}</label>
      <input
        type="text"
        className="input"
        value={typeof value === 'object' ? JSON.stringify(value) : (value ?? '')}
        onChange={e => onChange(e.target.value)}
        style={{ width: '100%', maxWidth: 400 }}
      />
      {propSchema.description && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{propSchema.description}</div>
      )}
    </div>
  );
}

/**
 * SchemaEditor — a generic, reusable JSON Schema-driven form renderer.
 *
 * Props:
 *   schema  – JSON Schema object with `properties`
 *   data    – current values object
 *   onChange(newData) – called when any value changes
 */
export default function SchemaEditor({ schema, data, onChange }) {
  const properties = schema?.properties || {};

  const handleFieldChange = useCallback((key, newValue) => {
    onChange({ ...data, [key]: newValue });
  }, [data, onChange]);

  if (Object.keys(properties).length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No configurable properties in this schema.</div>;
  }

  return (
    <div className="schema-editor">
      {Object.entries(properties).map(([key, propSchema]) => (
        <SchemaField
          key={key}
          propKey={key}
          propSchema={propSchema}
          value={data?.[key]}
          onChange={val => handleFieldChange(key, val)}
        />
      ))}
    </div>
  );
}
