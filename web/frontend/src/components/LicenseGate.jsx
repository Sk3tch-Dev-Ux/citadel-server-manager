/**
 * LicenseGate — wraps content that requires an active Citadel Cloud
 * subscription. If the license is usable (active or grace), renders
 * children verbatim. Otherwise renders an upgrade card pointing the
 * user at citadels.cc/cloud.
 *
 * Phase 2 ships this scaffolding; no feature currently wraps with it.
 * Phase 3+ paid features will look like:
 *
 *   <LicenseGate feature="Global Ban Database">
 *     <GlobalBansPage />
 *   </LicenseGate>
 *
 * The backend's require-license middleware (backend/middleware/require-license.js)
 * is the *server-side* equivalent — wrap the route and gate the data; wrap
 * the page and gate the UI. Use both for defense in depth.
 */
import { Lock, Sparkles, ExternalLink } from './Icon';
import useLicenseStatus from '../hooks/useLicenseStatus';

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.feature]   - Human-readable feature name shown in the upgrade card.
 * @param {string} [props.description] - Short blurb shown under the feature name.
 * @param {React.ReactNode} [props.fallback] - Custom upgrade UI; replaces the default card.
 */
export default function LicenseGate({ children, feature, description, fallback }) {
  const { loading, isUsable, status } = useLicenseStatus();

  // Show nothing while we wait for the first status load — don't flash a
  // paywall to users who turn out to be activated.
  if (loading) return null;
  if (isUsable) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;

  return (
    <UpgradeCard feature={feature} description={description} status={status} />
  );
}

function UpgradeCard({ feature, description, status }) {
  const featureLabel = feature || 'This feature';
  const lapsed = status === 'lapsed' || status === 'expired';

  return (
    <div
      role="region"
      aria-label="Citadel Cloud upgrade required"
      style={{
        maxWidth: 560,
        margin: '40px auto',
        padding: 32,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 18px',
        }}
      >
        {lapsed
          ? <Lock size={26} style={{ color: 'var(--warning)' }} />
          : <Sparkles size={26} style={{ color: 'var(--accent)' }} />}
      </div>

      <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
        {lapsed ? `${featureLabel} is paused` : `${featureLabel} is part of Citadel Cloud`}
      </h2>

      <p style={{ margin: '0 0 22px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        {description ||
          (lapsed
            ? 'Your Citadel Cloud subscription is no longer active. Renew to restore this feature on this machine.'
            : 'Citadel is free to use. Citadel Cloud is an optional paid service that unlocks features like this one.')}
      </p>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <a
          href="https://citadels.cc/cloud"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          {lapsed ? 'Manage subscription' : 'Learn about Citadel Cloud'}
          <ExternalLink size={14} />
        </a>
        <a
          href="/citadel-license"
          className="btn btn-ghost"
          style={{ display: 'inline-flex', alignItems: 'center' }}
        >
          {lapsed ? 'Re-activate this machine' : 'I have an account — sign in'}
        </a>
      </div>
    </div>
  );
}
