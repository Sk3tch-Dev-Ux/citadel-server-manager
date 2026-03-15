/**
 * POST /api/webhook
 *
 * Stripe webhook handler for subscription lifecycle events.
 *
 * Events handled:
 *   - checkout.session.completed → Initial subscription, generate license key
 *   - invoice.paid → Recurring payment, refresh license key
 *   - customer.subscription.updated → Plan change (upgrade/downgrade)
 *   - customer.subscription.deleted → Cancellation notification
 *
 * Stripe Dashboard → Developers → Webhooks:
 *   Endpoint URL: https://citadel-license-generator.vercel.app/api/webhook
 *   Events: checkout.session.completed, invoice.paid,
 *           customer.subscription.updated, customer.subscription.deleted
 *
 * IMPORTANT: This endpoint needs the raw body for Stripe signature verification.
 */
const Stripe = require('stripe');
const { generateLicenseKey } = require('../lib/generate-key');
const { sendLicenseEmail, sendSubscriptionEmail } = require('../lib/email');

/**
 * Read the raw body from the request stream.
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

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripe, event.data.object);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(stripe, event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(stripe, event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(stripe, event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    // Log but return 200 so Stripe doesn't retry endlessly
    console.error(`Error processing ${event.type}:`, err);
  }

  return res.status(200).json({ received: true });
};

/**
 * Initial subscription checkout completed.
 * Generate license key and email it to the customer.
 */
async function handleCheckoutCompleted(stripe, session) {
  const email = session.customer_email || session.customer_details?.email;
  const name = session.customer_details?.name || '';
  const customerId = session.customer;

  if (!email) {
    console.error('No email found in checkout session', session.id);
    return;
  }

  // Retrieve the subscription to get tier from metadata
  const subscriptionId = session.subscription;
  if (!subscriptionId) {
    console.warn('No subscription in checkout session — may be a one-time payment');
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const tier = subscription.metadata?.tier || 'basic';

  console.log(`New subscription: ${email} (${name}) → ${tier} — session ${session.id}`);

  const licenseKey = generateLicenseKey({
    email,
    name,
    tier,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
  });

  await sendLicenseEmail(email, name, licenseKey, tier);

  console.log('Sale:', JSON.stringify({
    timestamp: new Date().toISOString(),
    sessionId: session.id,
    email,
    name,
    tier,
    amount: session.amount_total,
    currency: session.currency,
  }));
}

/**
 * Recurring invoice paid — generate a fresh license key with extended expiry.
 */
async function handleInvoicePaid(stripe, invoice) {
  // Skip the initial invoice (handled by checkout.session.completed)
  if (invoice.billing_reason === 'subscription_create') return;

  const email = invoice.customer_email;
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  if (!email || !subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const tier = subscription.metadata?.tier || 'basic';

  // Determine expiry based on billing interval
  const interval = subscription.items?.data?.[0]?.price?.recurring?.interval;
  const expiresInDays = interval === 'year' ? 395 : 35; // Buffer days beyond billing period

  console.log(`Invoice paid: ${email} → ${tier} (renewal, ${expiresInDays}d expiry)`);

  const licenseKey = generateLicenseKey({
    email,
    name: '',
    tier,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    expiresInDays,
  });

  await sendSubscriptionEmail(email, licenseKey, tier, 'renewed');
}

/**
 * Subscription updated — plan change (upgrade/downgrade).
 */
async function handleSubscriptionUpdated(stripe, subscription) {
  const tier = subscription.metadata?.tier;
  const customerId = subscription.customer;

  if (!tier || !customerId) return;

  // Get customer email
  const customer = await stripe.customers.retrieve(customerId);
  const email = customer.email;
  if (!email) return;

  const interval = subscription.items?.data?.[0]?.price?.recurring?.interval;
  const expiresInDays = interval === 'year' ? 395 : 35;

  console.log(`Subscription updated: ${email} → ${tier}`);

  const licenseKey = generateLicenseKey({
    email,
    name: customer.name || '',
    tier,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    expiresInDays,
  });

  await sendSubscriptionEmail(email, licenseKey, tier, 'updated');
}

/**
 * Subscription canceled — notify customer.
 * The existing JWT will expire naturally within its expiry period.
 */
async function handleSubscriptionDeleted(stripe, subscription) {
  const customerId = subscription.customer;
  if (!customerId) return;

  const customer = await stripe.customers.retrieve(customerId);
  const email = customer.email;
  if (!email) return;

  console.log(`Subscription canceled: ${email}`);

  await sendSubscriptionEmail(email, null, null, 'canceled');
}

// Disable Vercel's automatic body parsing — Stripe signature verification
// requires the raw request body, not a pre-parsed JSON object.
module.exports.config = { api: { bodyParser: false } };
