/**
 * POST /api/create-portal-session
 *
 * Creates a Stripe Billing Portal session so customers can manage
 * their subscription (change plan, update payment, cancel).
 *
 * Body: { stripeCustomerId: string }
 * Returns: { url: string }
 */
const Stripe = require('stripe');

const RETURN_URL = process.env.PORTAL_RETURN_URL || 'http://localhost:3001/license';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const { stripeCustomerId } = req.body || {};
  if (!stripeCustomerId) {
    return res.status(400).json({ error: 'stripeCustomerId is required' });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: RETURN_URL,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Portal session creation failed:', err.message);
    return res.status(500).json({ error: 'Failed to create billing portal session' });
  }
};
