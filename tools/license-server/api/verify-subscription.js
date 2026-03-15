/**
 * POST /api/verify-subscription
 *
 * Verifies a subscription is still active and returns a fresh license key.
 * Called by the local Citadel backend every 24 hours to refresh the JWT.
 *
 * Body: { licenseKey: string }
 * Returns: { valid: true, licenseKey: string } or { valid: false, reason: string }
 */
const Stripe = require('stripe');
const jwt = require('jsonwebtoken');
const { generateLicenseKey } = require('../lib/generate-key');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const { licenseKey } = req.body || {};
  if (!licenseKey) {
    return res.status(400).json({ valid: false, reason: 'licenseKey is required' });
  }

  // Decode the JWT without verification to extract subscription ID
  let decoded;
  try {
    decoded = jwt.decode(licenseKey);
  } catch {
    return res.status(400).json({ valid: false, reason: 'Invalid license key format' });
  }

  if (!decoded || !decoded.stripeSubscriptionId) {
    return res.status(400).json({ valid: false, reason: 'License key does not contain a subscription ID' });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  try {
    const subscription = await stripe.subscriptions.retrieve(decoded.stripeSubscriptionId);

    // Check subscription status
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      const tier = subscription.metadata?.tier || decoded.tier || 'basic';
      const interval = subscription.items?.data?.[0]?.price?.recurring?.interval;
      const expiresInDays = interval === 'year' ? 395 : 35;

      // Get customer for name
      const customer = await stripe.customers.retrieve(subscription.customer);

      const newKey = generateLicenseKey({
        email: customer.email || decoded.email,
        name: customer.name || decoded.licensee || '',
        tier,
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        expiresInDays,
      });

      return res.status(200).json({ valid: true, licenseKey: newKey, tier });
    }

    // Subscription is not active
    return res.status(200).json({
      valid: false,
      reason: `Subscription status: ${subscription.status}`,
      status: subscription.status,
    });
  } catch (err) {
    console.error('Subscription verification failed:', err.message);
    return res.status(200).json({ valid: false, reason: 'Failed to verify subscription' });
  }
};
