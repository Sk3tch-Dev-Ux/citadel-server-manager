/**
 * POST /api/create-checkout
 *
 * Creates a Stripe Checkout Session and returns the URL.
 * Collects customer's GitHub username via Stripe's custom_fields
 * so we can auto-invite them to the private repo after payment.
 *
 * Body (optional): { "email": "customer@example.com" }
 */
const Stripe = require('stripe');

const SUCCESS_URL = process.env.SUCCESS_URL || 'https://citadel.gg/purchase/success';
const CANCEL_URL = process.env.CANCEL_URL || 'https://citadel.gg/purchase';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://sk3tch-dev-ux.github.io').split(',');

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
  const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });
  if (!STRIPE_PRICE_ID) return res.status(500).json({ error: 'STRIPE_PRICE_ID not configured' });

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  try {
    const email = req.body?.email || undefined;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: CANCEL_URL,
      customer_email: email,
      // Collect GitHub username on the checkout page
      custom_fields: [
        {
          key: 'github_username',
          label: { type: 'custom', custom: 'GitHub Username' },
          type: 'text',
          optional: false,
        },
      ],
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout creation failed:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
