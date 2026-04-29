/**
 * LicenseGate — wraps content that requires a specific entitlement on
 * the user's Citadel + Citadel Cloud subscription stack.
 *
 * Two ways to use it:
 *
 *   <LicenseGate>
 *     <SomePaidFeature />
 *   </LicenseGate>
 *
 *   - Requires only the base Citadel subscription (active local-app license).
 *   - Useful for features behind the Citadel paywall but NOT the Cloud add-on.
 *
 *   <LicenseGate feature="cloud" featureName="Global Ban Database">
 *     <GlobalBansPage />
 *   </LicenseGate>
 *
 *   - Requires both Citadel sub AND the Cloud entitlement.
 *   - Used for everything in the $10/mo Citadel Cloud add-on.
 *
 * The backend's require-license middleware (backend/middleware/require-license.js)
 * is the *server-side* equivalent. Apply both for defense in depth.
 */
import { Lock, Sparkles, ExternalLink } from './Icon';
import useLicenseStatus from '../hooks/useLicenseStatus';

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {'cloud'} [props.feature] - Entitlement key required, if any.
 * @param {string} [props.featureName] - Human-readable feature name shown in the upgrade card.
 * @param {string} [props.description] - Short blurb shown under the feature name.
 * @param {React.ReactNode} [props.fallback] - Custom upgrade UI; replaces the default card.
 */
export default function LicenseGate({ children, feature, featureName, description, fallback }) {
  const { loading, isUsable, hasCloud, hasFeature, status } = useLicenseStatus();

  // Don't flash the paywall while we're still waiting for the first
  // /status response — the customer may turn out to be subscribed.
  if (loading) return null;

  // Base gate: must have an active Citadel sub.
  if (!isUsable) {
    if (fallback !== undefined) return <>{fallback}</>;
    return <UpgradeCard feature={feature} featureName={featureName} description={description} status={status} reason="no-citadel" />;
  }

  // Feature-specific gate: must have the Cloud entitlement (or future feature).
  if (feature) {
    const entitled = feature === 'cloud' ? hasCloud : hasFeature(feature);
    if (!entitled) {
      if (fallback !== undefined) return <>{fallback}</>;
      return <UpgradeCard feature={feature} featureName={featureName} description={description} status={status} reason="no-feature" />;
    }
  }

  return <>{children}</>;
}

function UpgradeCard({ feature, featureName, description, status, reason }) {
  const featureLabel = featureName || (feature === 'cloud' ? 'Citadel Cloud' : 'This feature');
  const lapsed = status === 'lapsed' || status === 'expired' || reason === 'no-citadel';

  // Three distinct messages depending on what's missing:
  //   - 'no-citadel'  → base Citadel sub is gone (rare here; banner usually catches this first)
  //   - 'no-feature'  → base sub is fine, just missing the Cloud add-on
  const isFeatureUpsell = reason === 'no-feature';

  return (
    <div
      role="region"
      aria-label="Subscription upgrade required"
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
        {lapsed
          ? `${featureLabel} is paused`
          : isFeatureUpsell
            ? `${featureLabel} is part of the Citadel Cloud add-on`
            : `${featureLabel} requires a Citadel subscription`}
      </h2>

      <p style={{ margin: '0 0 22px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        {description || (
          lapsed
            ? 'Your Citadel subscription is no longer active. Renew on citadels.cc to restore this feature.'
            : isFeatureUpsell
              ? 'Citadel Cloud is a $10/month add-on on top of your Citadel subscription. It unlocks features like the Global Ban Database, with more cloud-only tools coming.'
              : 'You need an active Citadel subscription to use this. Sign up on citadels.cc.'
        )}
      </p>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <a
          href={isFeatureUpsell ? 'https://citadels.cc/cloud' : 'https://citadels.cc/account'}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          {lapsed
            ? 'Manage subscription'
            : isFeatureUpsell
              ? 'Add Citadel Cloud — $10/mo'
              : 'Get Citadel'}
          <ExternalLink size={14} />
        </a>
        <a
          href="/citadel-license"
          className="btn btn-ghost"
          style={{ display: 'inline-flex', alignItems: 'center' }}
        >
          {lapsed
            ? 'Re-activate this machine'
            : isFeatureUpsell
              ? 'Already subscribed? Sign in'
              : 'I have an account — sign in'}
        </a>
      </div>
    </div>
  );
}
