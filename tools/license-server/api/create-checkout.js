/**
 * POST /api/create-checkout
 *
 * Creates a Stripe Checkout Session and returns the URL.
 * Optional — you can use Stripe Payment Links instead and skip this endpoint entirely.
 *
 * Body (optional): { "email": "customer@example.com" }
 */
const Stripe = require('stripe');

const SUCCESS_URL = process.env.SUCCESS_URL || 'https://citadel.gg/purchase/success';
const CANCEL_URL = process.env.CANCEL_URL || 'https://citadel.gg/purchase';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });
  if (!STRIPE_PRICE_ID) return res.status(500).json({ error: 'STRIPE_PRICE_ID not configured' });

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  try {
    // Parse JSON body (Vercel parses it automatically unless raw body is configured)
    const email = req.body?.email || undefined;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: CANCEL_URL,
      customer_email: email,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout creation failed:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
