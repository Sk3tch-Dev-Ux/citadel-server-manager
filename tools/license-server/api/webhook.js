/**
 * POST /api/webhook
 *
 * Stripe webhook handler.
 * On checkout.session.completed:
 *   1. Generate RSA-signed license key
 *   2. Invite customer to private GitHub repo
 *   3. Email license key + repo access instructions
 *
 * Stripe Dashboard → Developers → Webhooks:
 *   Endpoint URL: https://citadel-license-generator.vercel.app/api/webhook
 *   Events: checkout.session.completed
 *
 * IMPORTANT: This endpoint needs the raw body for Stripe signature verification.
 * The body parsing for this route is disabled in vercel.json.
 */
const Stripe = require('stripe');
const { generateLicenseKey } = require('../lib/generate-key');
const { sendLicenseEmail } = require('../lib/email');
const { inviteToRepo } = require('../lib/github');

/**
 * Read the raw body from the request stream.
 * Vercel's Node.js runtime doesn't auto-parse when bodyParser is disabled.
 */
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  // Get raw body for signature verification
  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle checkout completion
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    const name = session.customer_details?.name || '';

    // Extract GitHub username from Stripe custom_fields
    const ghField = (session.custom_fields || []).find(f => f.key === 'github_username');
    const githubUsername = ghField?.text?.value?.trim() || '';

    if (!email) {
      console.error('No email found in checkout session', session.id);
      return res.status(200).json({ received: true, warning: 'no email' });
    }

    console.log(`Payment received from ${email} (${name}) — session ${session.id} — GitHub: ${githubUsername || 'N/A'}`);

    try {
      const licenseKey = generateLicenseKey(email, name);

      // Invite to GitHub repo (non-blocking — don't fail the sale if this errors)
      let githubInvited = false;
      if (githubUsername) {
        try {
          const inviteResult = await inviteToRepo(githubUsername);
          githubInvited = inviteResult.success;
          console.log(`GitHub invite for ${githubUsername}: ${inviteResult.message}`);
        } catch (ghErr) {
          console.error(`GitHub invite failed for ${githubUsername}:`, ghErr.message);
        }
      } else {
        console.warn('No GitHub username provided — skipping repo invite');
      }

      await sendLicenseEmail(email, name, licenseKey, githubUsername, githubInvited);

      console.log('Sale:', JSON.stringify({
        timestamp: new Date().toISOString(),
        sessionId: session.id,
        email,
        name,
        githubUsername,
        githubInvited,
        amount: session.amount_total,
        currency: session.currency,
      }));
    } catch (err) {
      // Log but return 200 so Stripe doesn't retry endlessly
      console.error('License generation/delivery failed:', err);
    }
  }

  return res.status(200).json({ received: true });
};

// Disable Vercel's automatic body parsing — Stripe signature verification
// requires the raw request body, not a pre-parsed JSON object.
module.exports.config = { api: { bodyParser: false } };
