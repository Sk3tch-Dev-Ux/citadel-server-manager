/**
 * CFToolsImportModal — three-step flow for importing an existing CFTools
 * banlist into the local Citadel ban database.
 *
 *   Step 1 (form):    customer enters CFTools application_id + secret +
 *                     either banlist_id or server_id.
 *   Step 2 (preview): backend authenticates, fetches first page, returns
 *                     summary + sample of the ~5 first records.
 *   Step 3 (import):  customer confirms; backend pages through and
 *                     writes to local ban DB. Modal shows the full result.
 *
 * Credentials handling: the form keeps apiToken in component state ONLY.
 * It's sent over HTTPS to /api/cftools-import/* and the backend never
 * persists it. We clear it when the modal closes.
 *
 * Errors:
 *   401 from CFTools → "Wrong API token"
 *   404 from server lookup → "Server has no banlist on CFTools"
 *   anything else → upstream error message displayed verbatim
 */
import { useState, useCallback } from 'react';
import API from '../api';
import Modal from './ui/Modal';
import { Upload, Loader, AlertTriangle, CheckCircle, ExternalLink, Eye, EyeOff } from './Icon';

export default function CFToolsImportModal({ open, onClose, onImported }) {
  // ── Form state (Step 1) ──
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [idType, setIdType] = useState('banlistId'); // 'banlistId' | 'serverId'
  const [idValue, setIdValue] = useState('');

  // ── Flow state ──
  const [step, setStep] = useState('form'); // 'form' | 'preview' | 'importing' | 'done'
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);

  // ── Result state ──
  const [preview, setPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const reset = useCallback(() => {
    setApiToken('');
    setShowToken(false);
    setIdType('banlistId');
    setIdValue('');
    setStep('form');
    setPreviewing(false);
    setImporting(false);
    setError(null);
    setPreview(null);
    setImportResult(null);
  }, []);

  function handleClose() {
    reset();
    onClose && onClose();
  }

  function buildPayload() {
    const payload = { apiToken: apiToken.trim() };
    if (idType === 'banlistId') payload.banlistId = idValue.trim();
    else payload.serverId = idValue.trim();
    return payload;
  }

  // ── Step transitions ──

  async function handlePreview(e) {
    e.preventDefault();
    if (!apiToken.trim() || !idValue.trim()) return;
    setError(null);
    setPreviewing(true);
    try {
      const res = await API.post('/api/cftools-import/preview', buildPayload());
      if (res?.error) {
        setError(res.message || res.error);
        return;
      }
      setPreview(res);
      setStep('preview');
    } catch (err) {
      setError(err.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    setError(null);
    setImporting(true);
    setStep('importing');
    try {
      const res = await API.post('/api/cftools-import/run', buildPayload());
      if (res?.error) {
        setError(res.message || res.error);
        setStep('preview'); // back to preview so they can retry
        return;
      }
      setImportResult(res);
      setStep('done');
      // Tell the parent to refresh the bans list.
      if (onImported) onImported(res);
    } catch (err) {
      setError(err.message || 'Import failed');
      setStep('preview');
    } finally {
      setImporting(false);
    }
  }

  // ───────────────────────────────────────────────────────────

  return (
    <Modal open={open} onClose={handleClose} title="Import bans from CFTools">
      {step === 'form' && (
        <FormStep
          apiToken={apiToken}
          setApiToken={setApiToken}
          showToken={showToken}
          setShowToken={setShowToken}
          idType={idType}
          setIdType={setIdType}
          idValue={idValue}
          setIdValue={setIdValue}
          previewing={previewing}
          error={error}
          onSubmit={handlePreview}
          onCancel={handleClose}
        />
      )}

      {step === 'preview' && preview && (
        <PreviewStep
          preview={preview}
          error={error}
          importing={importing}
          onConfirm={handleImport}
          onBack={() => setStep('form')}
        />
      )}

      {step === 'importing' && (
        <ImportingStep />
      )}

      {step === 'done' && importResult && (
        <DoneStep
          result={importResult}
          onClose={handleClose}
        />
      )}
    </Modal>
  );
}

// ───────────────────────────────────────────────────────────

function FormStep({
  apiToken, setApiToken,
  showToken, setShowToken,
  idType, setIdType,
  idValue, setIdValue,
  previewing, error, onSubmit, onCancel,
}) {
  return (
    <form onSubmit={onSubmit}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.55 }}>
        Bring your existing CFTools-hosted banlist into Citadel. We&apos;ll fetch
        the first page so you can confirm what we found, then import on your approval.
        Your API token is used once and never saved.
        {' '}
        <a
          href="https://developer.cftools.cloud/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent)', textDecoration: 'none' }}
        >
          Get your token from the CFTools Developer Portal{' '}
          <ExternalLink size={11} style={{ verticalAlign: 'middle' }} />
        </a>
      </p>

      <div className="input-group">
        <label className="input-label">CFTools API token</label>
        <div style={{ position: 'relative' }}>
          <input
            className="input"
            type={showToken ? 'text' : 'password'}
            placeholder="paste your Bearer token"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            autoFocus
            required
            autoComplete="off"
            spellCheck={false}
            style={{ paddingRight: 36 }}
          />
          <button
            type="button"
            onClick={() => setShowToken((s) => !s)}
            aria-label={showToken ? 'Hide token' : 'Show token'}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 4,
            }}
          >
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
          Sent to your local Citadel backend over loopback, then to CFTools over HTTPS.
          Discarded after this import — re-enter to import again.
        </span>
      </div>

      <div className="input-group">
        <label className="input-label">Source</label>
        <div style={{ display: 'flex', gap: 16, marginTop: 4, marginBottom: 8 }}>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="cftools-id-type"
              value="banlistId"
              checked={idType === 'banlistId'}
              onChange={() => setIdType('banlistId')}
            />
            Banlist ID
          </label>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="cftools-id-type"
              value="serverId"
              checked={idType === 'serverId'}
              onChange={() => setIdType('serverId')}
            />
            Server ID (we&apos;ll look up the banlist)
          </label>
        </div>
        <input
          className="input"
          placeholder={idType === 'banlistId'
            ? 'e.g. 693628d4fc4178db4369ab7b'
            : 'your CFTools server ID'}
          value={idValue}
          onChange={(e) => setIdValue(e.target.value)}
          required
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}
        />
        <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
          {idType === 'banlistId'
            ? 'On CFTools: open your banlist → look at the URL, or copy the "Banlist ID" shown at the top of the page (24-character hex string).'
            : 'On CFTools: open your server → Settings. The server ID is in the URL.'}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: 'var(--danger)',
            background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            borderRadius: 8,
            padding: '10px 12px',
            marginTop: 4,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={previewing}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={previewing || !apiToken.trim() || !idValue.trim()}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {previewing ? <><Loader size={14} className="spin" /> Authenticating…</> : 'Preview import'}
        </button>
      </div>
    </form>
  );
}

// ───────────────────────────────────────────────────────────

function PreviewStep({ preview, error, importing, onConfirm, onBack }) {
  const breakdown = preview.skipBreakdown || {};
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.55 }}>
        Found the banlist. Here&apos;s what we can import. CFTools bans target
        <code> cftools_id </code>or<code> ipv4 </code>identifiers — we can only import bans
        whose record also carries a Steam64, since DayZ&apos;s <code>ban.txt</code> needs that.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <PreviewStat label="Banlist ID" value={preview.banlistId} mono />
        <PreviewStat label="Total records" value={preview.totalRecords} />
        <PreviewStat label="Importable (have Steam64)" value={preview.estimatedSteam64} accent="success" />
        <PreviewStat label="Skipped" value={preview.estimatedSkipped} accent="muted" />
      </div>

      {/* Skip breakdown — explains exactly why each one was excluded so
          the customer doesn't think we're randomly dropping records. */}
      {(breakdown.skipNoSteam64 > 0 || breakdown.skipIpv4 > 0 || breakdown.skipMalformed > 0) && (
        <details style={{ marginBottom: 16 }}>
          <summary style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Why some records were skipped
          </summary>
          <div style={{
            marginTop: 6,
            fontSize: 12,
            color: 'var(--text-muted)',
            background: 'var(--bg-surface)',
            borderRadius: 6,
            padding: '10px 12px',
            lineHeight: 1.5,
          }}>
            {breakdown.skipNoSteam64 > 0 && (
              <div>
                <strong>{breakdown.skipNoSteam64}</strong> bans target a CFTools account ID with no
                Steam64 attached to the record. DayZ&apos;s <code>ban.txt</code> requires Steam64 to
                enforce the ban — without it, we can&apos;t import.
              </div>
            )}
            {breakdown.skipIpv4 > 0 && (
              <div style={{ marginTop: 4 }}>
                <strong>{breakdown.skipIpv4}</strong> bans target an IP address.
                DayZ&apos;s <code>ban.txt</code> doesn&apos;t accept IP bans.
              </div>
            )}
            {breakdown.skipMalformed > 0 && (
              <div style={{ marginTop: 4 }}>
                <strong>{breakdown.skipMalformed}</strong> records had an unexpected shape.
              </div>
            )}
          </div>
        </details>
      )}

      {preview.sample?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
            Sample (first {preview.sample.length} of {preview.estimatedSteam64} Steam64 bans):
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {preview.sample.map((s) => (
              <div
                key={s.steamId}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '6px 10px',
                  background: 'var(--bg-surface)',
                  borderRadius: 6,
                  fontSize: 12,
                  alignItems: 'center',
                }}
              >
                <code style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)' }}>
                  {s.steamId}
                </code>
                <span style={{ color: 'var(--text-muted)', flex: 1 }}>{s.reason || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: 'var(--danger)',
            background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={importing}>
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onConfirm}
          disabled={importing || preview.estimatedSteam64 === 0}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Upload size={14} /> Import all
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────

function ImportingStep() {
  return (
    <div style={{ padding: '32px 8px', textAlign: 'center' }}>
      <Loader size={28} className="spin" style={{ color: 'var(--accent)' }} />
      <div style={{ marginTop: 14, fontSize: 14, fontWeight: 500 }}>Importing…</div>
      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
        Paging through the banlist. Don&apos;t close this dialog — we&apos;ll show the result when complete.
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────

function DoneStep({ result, onClose }) {
  const total = result.added + result.updated;
  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        padding: 14,
        background: 'color-mix(in srgb, var(--success) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
        borderRadius: 8,
      }}>
        <CheckCircle size={20} style={{ color: 'var(--success)' }} />
        <div>
          <div style={{ fontWeight: 600 }}>Import complete</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {total.toLocaleString()} ban{total !== 1 ? 's' : ''} synced to your local database
            and to <code>ban.txt</code> on every managed server.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <PreviewStat label="Added" value={result.added.toLocaleString()} accent="success" />
        <PreviewStat label="Updated" value={result.updated.toLocaleString()} />
        <PreviewStat label="Skipped (non-Steam64)" value={result.skipped.toLocaleString()} accent="muted" />
        <PreviewStat label="Errors" value={result.errors.length.toLocaleString()} accent={result.errors.length > 0 ? 'danger' : 'muted'} />
      </div>

      {result.capped && (
        <div style={{
          fontSize: 12,
          color: 'var(--warning)',
          marginBottom: 14,
          padding: '8px 12px',
          background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
          borderRadius: 6,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <AlertTriangle size={14} style={{ marginTop: 1 }} />
          <span>
            The import hit our 100,000-ban hard cap. If your CFTools list is bigger than that,
            contact support — we&apos;ll bump the cap for your installation.
          </span>
        </div>
      )}

      {result.errors.length > 0 && (
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
            {result.errors.length} import error{result.errors.length === 1 ? '' : 's'} (click to expand)
          </summary>
          <div style={{
            marginTop: 8,
            maxHeight: 180,
            overflowY: 'auto',
            background: 'var(--bg-surface)',
            borderRadius: 6,
            padding: 8,
            fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
          }}>
            {result.errors.slice(0, 100).map((e, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <strong>{e.steamId || '?'}:</strong> {e.message}
              </div>
            ))}
            {result.errors.length > 100 && (
              <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>
                + {result.errors.length - 100} more (showing first 100)
              </div>
            )}
          </div>
        </details>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────

function PreviewStat({ label, value, accent, mono }) {
  const color = accent === 'success' ? 'var(--success)'
              : accent === 'danger' ? 'var(--danger)'
              : accent === 'warning' ? 'var(--warning)'
              : accent === 'muted' ? 'var(--text-muted)'
              : 'var(--text-primary)';
  return (
    <div style={{
      padding: '10px 14px',
      background: 'var(--bg-surface)',
      borderRadius: 8,
      border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{
        fontSize: mono ? 12 : 16,
        fontWeight: 600,
        color,
        marginTop: 4,
        wordBreak: 'break-all',
        fontFamily: mono ? 'var(--font-mono, monospace)' : 'inherit',
      }}>
        {value}
      </div>
    </div>
  );
}
