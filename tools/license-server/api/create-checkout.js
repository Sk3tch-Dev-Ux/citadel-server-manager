/**
 * POST /api/create-checkout
 *
 * Creates a Stripe Checkout Session for a subscription tier.
 * Returns the checkout URL for the customer to complete payment.
 *
 * Body: { tier: 'basic'|'pro'|'community', interval: 'month'|'year', email?: string }
 */
const Stripe = require('stripe');

const SUCCESS_URL = process.env.SUCCESS_URL || 'https://citadel.gg/purchase/success';
const CANCEL_URL = process.env.CANCEL_URL || 'https://citadel.gg/purchase';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://sk3tch-dev-ux.github.io').split(',');

// Price ID env var naming convention: STRIPE_PRICE_{TIER}_{INTERVAL}
// e.g. STRIPE_PRICE_BASIC_MONTHLY, STRIPE_PRICE_PRO_YEARLY
const PRICE_MAP = {
  basic_month: process.env.STRIPE_PRICE_BASIC_MONTHLY,
  basic_year: process.env.STRIPE_PRICE_BASIC_YEARLY,
  pro_month: process.env.STRIPE_PRICE_PRO_MONTHLY,
  pro_year: process.env.STRIPE_PRICE_PRO_YEARLY,
  community_month: process.env.STRIPE_PRICE_COMMUNITY_MONTHLY,
  community_year: process.env.STRIPE_PRICE_COMMUNITY_YEARLY,
};

const VALID_TIERS = ['basic', 'pro', 'community'];
const VALID_INTERVALS = ['month', 'year'];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const { tier, interval, email } = req.body || {};

  // Validate tier
  if (!tier || !VALID_TIERS.includes(tier)) {
    return res.status(400).json({ error: `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}` });
  }

  // Validate interval
  if (!interval || !VALID_INTERVALS.includes(interval)) {
    return res.status(400).json({ error: `Invalid interval. Must be one of: ${VALID_INTERVALS.join(', ')}` });
  }

  const priceKey = `${tier}_${interval}`;
  const priceId = PRICE_MAP[priceKey];

  if (!priceId) {
    return res.status(500).json({ error: `Price not configured for ${tier}/${interval}. Set STRIPE_PRICE_${tier.toUpperCase()}_${interval === 'month' ? 'MONTHLY' : 'YEARLY'} env var.` });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: CANCEL_URL,
      customer_email: email || undefined,
      subscription_data: {
        metadata: { tier },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout creation failed:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
