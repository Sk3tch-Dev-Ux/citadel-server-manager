import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * JsonConfigEditor — a fallback raw JSON editor for configs without schemas.
 *
 * Props:
 *   content    – JSON string or object
 *   onChange(newContent) – called when content changes (passes the raw string)
 */
export default function JsonConfigEditor({ content, onChange }) {
  // Normalize initial content to a string
  const initialValue = typeof content === 'object' ? JSON.stringify(content, null, 2) : (content ?? '');
  const [text, setText] = useState(initialValue);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  // Sync if content prop changes externally
  useEffect(() => {
    const val = typeof content === 'object' ? JSON.stringify(content, null, 2) : (content ?? '');
    setText(val);
    setError(null);
  }, [content]);

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setText(val);

    // Validate JSON
    try {
      if (val.trim()) {
        JSON.parse(val);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    }

    onChange(val);
  }, [onChange]);

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      setText(formatted);
      setError(null);
      onChange(formatted);
    } catch (err) {
      setError(err.message);
    }
  }, [text, onChange]);

  // Count lines for the gutter
  const lineCount = text.split('\n').length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');

  return (
    <div className="json-config-editor" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Raw JSON Editor {error ? '' : '(valid)'}
        </span>
        <button className="btn btn-secondary" onClick={handleFormat} style={{ fontSize: 12, padding: '4px 12px' }}>
          Format JSON
        </button>
      </div>

      {error && (
        <div style={{
          fontSize: 12,
          color: 'var(--danger, #e53e3e)',
          background: 'var(--danger-bg, rgba(229,62,62,0.1))',
          padding: '6px 10px',
          borderRadius: 4,
          fontFamily: 'monospace',
        }}>
          JSON Error: {error}
        </div>
      )}

      <div style={{
        display: 'flex',
        border: `1px solid ${error ? 'var(--danger, #e53e3e)' : 'var(--border)'}`,
        borderRadius: 6,
        overflow: 'hidden',
        background: 'var(--bg-secondary, #1a1a2e)',
      }}>
        {/* Line numbers gutter */}
        <div style={{
          padding: '12px 8px 12px 12px',
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: '1.5',
          color: 'var(--text-muted)',
          background: 'var(--bg-tertiary, #151525)',
          textAlign: 'right',
          userSelect: 'none',
          minWidth: 40,
          whiteSpace: 'pre',
          overflow: 'hidden',
        }}>
          {lineNumbers}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          spellCheck={false}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            resize: 'vertical',
            padding: '12px',
            fontFamily: 'monospace',
            fontSize: 13,
            lineHeight: '1.5',
            minHeight: 400,
            background: 'transparent',
            color: 'var(--text-primary, #e0e0e0)',
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
