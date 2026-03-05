import { useState, useCallback, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

// ─── Inline Styles ───────────────────────────────────────────
const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    zIndex: 1100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'fadeIn 0.15s',
  },
  content: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '28px',
    width: 420,
    maxWidth: '90vw',
    zIndex: 1101,
    animation: 'fadeIn 0.15s',
    outline: 'none',
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    marginBottom: 20,
    whiteSpace: 'pre-line',
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-primary)',
    fontSize: 14,
    fontFamily: 'var(--font-display)',
    outline: 'none',
    marginBottom: 20,
    boxSizing: 'border-box',
  },
  actions: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
  },
  btnCancel: {
    padding: '9px 18px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'var(--font-display)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  btnConfirmDefault: {
    padding: '9px 18px',
    background: 'var(--accent-blue)',
    border: '1px solid var(--accent-blue)',
    borderRadius: 'var(--radius)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'var(--font-display)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  btnConfirmDanger: {
    padding: '9px 18px',
    background: 'var(--accent-red)',
    border: '1px solid var(--accent-red)',
    borderRadius: 'var(--radius)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'var(--font-display)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
};

// ─── ConfirmDialog Component ─────────────────────────────────
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  promptMode = false,
  promptPlaceholder = '',
  promptDefaultValue = '',
}) {
  const [inputValue, setInputValue] = useState(promptDefaultValue);
  const inputRef = useRef(null);

  const handleOpenChange = (v) => {
    if (!v) {
      onCancel?.();
      onOpenChange?.(false);
    }
  };

  const handleConfirm = () => {
    if (promptMode) {
      onConfirm?.(inputValue);
    } else {
      onConfirm?.(true);
    }
    onOpenChange?.(false);
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange?.(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && promptMode && inputValue.trim()) {
      e.preventDefault();
      handleConfirm();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={styles.overlay} />
        <Dialog.Content
          style={styles.content}
          onOpenAutoFocus={(e) => {
            if (promptMode && inputRef.current) {
              e.preventDefault();
              inputRef.current.focus();
              inputRef.current.select();
            }
          }}
        >
          {title && (
            <Dialog.Title style={styles.title}>{title}</Dialog.Title>
          )}
          {message && (
            <Dialog.Description style={styles.message}>
              {message}
            </Dialog.Description>
          )}
          {promptMode && (
            <input
              ref={inputRef}
              type="text"
              style={styles.input}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={promptPlaceholder}
              autoFocus
            />
          )}
          <div style={styles.actions}>
            <button
              type="button"
              style={styles.btnCancel}
              onClick={handleCancel}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--border)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-elevated)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              style={variant === 'danger' ? styles.btnConfirmDanger : styles.btnConfirmDefault}
              onClick={handleConfirm}
              disabled={promptMode && !inputValue.trim()}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '0.85';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── useConfirmDialog Hook ───────────────────────────────────
export function useConfirmDialog() {
  const [state, setState] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    variant: 'default',
    promptMode: false,
    promptPlaceholder: '',
    promptDefaultValue: '',
  });

  const resolveRef = useRef(null);

  const resetAndResolve = useCallback((value) => {
    setState((s) => ({ ...s, open: false }));
    if (resolveRef.current) {
      resolveRef.current(value);
      resolveRef.current = null;
    }
  }, []);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        title: options.title || 'Confirm',
        message: options.message || '',
        confirmLabel: options.confirmLabel || 'Confirm',
        cancelLabel: options.cancelLabel || 'Cancel',
        variant: options.variant || 'default',
        promptMode: false,
        promptPlaceholder: '',
        promptDefaultValue: '',
      });
    });
  }, []);

  const prompt = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        title: options.title || 'Input',
        message: options.message || '',
        confirmLabel: options.confirmLabel || 'Send',
        cancelLabel: options.cancelLabel || 'Cancel',
        variant: options.variant || 'default',
        promptMode: true,
        promptPlaceholder: options.placeholder || '',
        promptDefaultValue: options.defaultValue || '',
      });
    });
  }, []);

  const DialogComponent = (
    <ConfirmDialog
      open={state.open}
      onOpenChange={(v) => {
        if (!v) resetAndResolve(state.promptMode ? null : false);
      }}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      variant={state.variant}
      promptMode={state.promptMode}
      promptPlaceholder={state.promptPlaceholder}
      promptDefaultValue={state.promptDefaultValue}
      onConfirm={(value) => resetAndResolve(value)}
      onCancel={() => resetAndResolve(state.promptMode ? null : false)}
    />
  );

  return { confirm, prompt, DialogComponent };
}

export default ConfirmDialog;
