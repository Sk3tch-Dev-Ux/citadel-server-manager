/**
 * VIP Store Engine — Stripe-powered priority queue purchases.
 *
 * Server owners configure their own Stripe credentials. Players purchase
 * VIP tiers via Stripe Checkout (hosted by Stripe — no card data on our
 * server). Successful payments auto-provision priority queue entries.
 *
 * Products and purchases are stored in data/ JSON files.
 * Stripe SDK is optional — loaded with try/catch.
 *
 * LB Master Integration:
 *   Products can optionally include `lbPerks` — an array of LB Master perks
 *   (e.g., chat prefixes) that are automatically applied to the player's
 *   Steam ID across all servers when a purchase completes.
 */
const { v4: uuid } = require('uuid');
const logger = require('./logger');
const ctx = require('./context');
const { saveJSON } = require('./data-store');
const { addEntry } = require('./cftools-priority');
const { addNotification, fireWebhooks } = require('./notifications');
const { addAudit } = require('./audit');
const { applyPerksForPurchase } = require('./lb-perks');

// ─── Optional Stripe SDK ────────────────────────────────
let Stripe;
try {
  Stripe = require('stripe');
} catch {
  Stripe = null;
}

/**
 * Get a Stripe client instance using the configured secret key.
 * Returns null if Stripe is not installed or not configured.
 */
function _getStripe() {
  if (!Stripe) return null;
  const key = ctx.CONFIG?.store?.stripeSecretKey;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2024-12-18.acacia' });
}

// ─── Persistence ─────────────────────────────────────────

function _persistProducts() {
  saveJSON(ctx.CONFIG.dataDir, 'store_products.json', ctx.storeProducts);
}

function _persistPurchases() {
  saveJSON(ctx.CONFIG.dataDir, 'store_purchases.json', ctx.storePurchases);
}

// ─── Steam64 ID Validation ──────────────────────────────

function isValidSteam64(steamId) {
  return typeof steamId === 'string' && /^7656119\d{10}$/.test(steamId);
}

// ─── Product Management ─────────────────────────────────

/** List all products. */
function listProducts() {
  return ctx.storeProducts || [];
}

/** List only active products (for public store). */
function listActiveProducts() {
  return (ctx.storeProducts || [])
    .filter(p => p.active)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/** Get a product by UUID. */
function getProduct(id) {
  return (ctx.storeProducts || []).find(p => p.id === id) || null;
}

/**
 * Create a new product.
 */
function addProduct({ name, description, role, durationDays, price, currency, lbPerks }) {
  if (!name) throw new Error('Product name is required');
  if (price == null || price < 0) throw new Error('Valid price is required');

  const product = {
    id: uuid(),
    name,
    description: description || '',
    role: role || 'VIP',
    durationDays: durationDays != null ? parseInt(durationDays) || null : null,
    price: parseInt(price) || 0,
    currency: (currency || ctx.CONFIG?.store?.currency || 'usd').toLowerCase(),
    active: true,
    order: (ctx.storeProducts || []).length,
    lbPerks: Array.isArray(lbPerks) && lbPerks.length > 0 ? lbPerks : undefined,
    createdAt: new Date().toISOString(),
  };

  if (!ctx.storeProducts) ctx.storeProducts = [];
  ctx.storeProducts.push(product);
  _persistProducts();
  return product;
}

/**
 * Update an existing product.
 */
function updateProduct(id, updates) {
  const product = getProduct(id);
  if (!product) return null;

  if (updates.name !== undefined) product.name = updates.name;
  if (updates.description !== undefined) product.description = updates.description;
  if (updates.role !== undefined) product.role = updates.role;
  if (updates.durationDays !== undefined) product.durationDays = updates.durationDays != null ? parseInt(updates.durationDays) || null : null;
  if (updates.price !== undefined) product.price = parseInt(updates.price) || 0;
  if (updates.currency !== undefined) product.currency = (updates.currency || 'usd').toLowerCase();
  if (updates.active !== undefined) product.active = !!updates.active;
  if (updates.order !== undefined) product.order = parseInt(updates.order) || 0;
  if (updates.lbPerks !== undefined) {
    product.lbPerks = Array.isArray(updates.lbPerks) && updates.lbPerks.length > 0
      ? updates.lbPerks : undefined;
  }

  _persistProducts();
  return product;
}

/**
 * Remove a product by UUID.
 */
function removeProduct(id) {
  const product = getProduct(id);
  if (!product) return null;
  ctx.storeProducts = ctx.storeProducts.filter(p => p.id !== id);
  _persistProducts();
  return product;
}

// ─── Purchase History ────────────────────────────────────

/** List all purchases. */
function listPurchases() {
  return ctx.storePurchases || [];
}

/** Get purchases for a specific player. */
function getPurchasesByPlayer(steamId) {
  return (ctx.storePurchases || []).filter(p => p.steamId === steamId);
}

// ─── Stripe Checkout ─────────────────────────────────────

/**
 * Create a Stripe Checkout Session for a product purchase.
 *
 * @param {object} params
 * @param {string} params.productId - UUID of the product
 * @param {string} params.steamId   - Player's Steam64 ID
 * @param {string} params.playerName - Player display name (optional)
 * @param {string} params.baseUrl   - Base URL for success/cancel redirects
 * @returns {Promise<{ url: string, sessionId: string }>}
 */
async function createCheckoutSession({ productId, steamId, playerName, baseUrl }) {
  const stripe = _getStripe();
  if (!stripe) throw new Error('Stripe is not configured. Add your Stripe Secret Key in Settings.');

  if (!isValidSteam64(steamId)) {
    throw new Error('Invalid Steam64 ID. Must be 17 digits starting with 7656119.');
  }

  const product = getProduct(productId);
  if (!product) throw new Error('Product not found');
  if (!product.active) throw new Error('Product is not available');

  const durationLabel = product.durationDays
    ? `${product.durationDays} day${product.durationDays === 1 ? '' : 's'}`
    : 'Permanent';

  const successUrl = ctx.CONFIG?.store?.successUrl
    || `${baseUrl}/store?success=true&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = ctx.CONFIG?.store?.cancelUrl
    || `${baseUrl}/store?cancelled=true`;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: product.currency,
        product_data: {
          name: product.name,
          description: `${product.description || product.role + ' Priority Queue Access'} (${durationLabel})`,
        },
        unit_amount: product.price,
      },
      quantity: 1,
    }],
    metadata: {
      steamId,
      playerName: playerName || '',
      productId: product.id,
      productName: product.name,
      role: product.role,
      durationDays: product.durationDays != null ? String(product.durationDays) : '',
      lbPerks: product.lbPerks ? JSON.stringify(product.lbPerks) : '',
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  logger.info({
    sessionId: session.id,
    steamId,
    product: product.name,
    amount: product.price,
  }, 'Stripe Checkout session created');

  return { url: session.url, sessionId: session.id };
}

// ─── Stripe Webhook Handler ─────────────────────────────

/**
 * Process a Stripe webhook event.
 * Verifies the signature and handles checkout.session.completed events.
 *
 * @param {Buffer} rawBody   - Raw request body (for signature verification)
 * @param {string} signature - Stripe-Signature header
 * @returns {Promise<object|null>} The created purchase record, or null if event was not relevant
 */
async function handleWebhook(rawBody, signature) {
  const stripe = _getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

  const webhookSecret = ctx.CONFIG?.store?.stripeWebhookSecret;
  if (!webhookSecret) throw new Error('Stripe webhook secret is not configured');

  // Verify webhook signature
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    logger.warn({ err: err.message }, 'Stripe webhook signature verification failed');
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }

  logger.debug({ type: event.type, id: event.id }, 'Stripe webhook event received');

  // Only handle completed checkout sessions
  if (event.type !== 'checkout.session.completed') {
    return null;
  }

  const session = event.data.object;
  const meta = session.metadata || {};

  // Extract purchase data from metadata
  const steamId = meta.steamId;
  const playerName = meta.playerName || 'Unknown';
  const productId = meta.productId;
  const productName = meta.productName || 'Unknown Product';
  const role = meta.role || 'VIP';
  const durationDays = meta.durationDays ? parseInt(meta.durationDays) : null;

  if (!steamId) {
    logger.error({ sessionId: session.id }, 'Stripe webhook: missing steamId in metadata');
    throw new Error('Missing steamId in session metadata');
  }

  // Calculate expiration
  let expiresAt = null;
  if (durationDays) {
    const expires = new Date();
    expires.setDate(expires.getDate() + durationDays);
    expiresAt = expires.toISOString();
  }

  // Auto-provision priority queue entry
  const entry = addEntry({
    steamId,
    name: playerName,
    role,
    expiresAt,
    addedBy: 'store',
    source: 'purchase',
  });

  // ── Apply LB Master perks (if product has them) ────────
  let lbPerksApplied;
  try {
    // Perks come from product definition (preferred) or Stripe metadata (fallback)
    const product = getProduct(productId);
    const perks = product?.lbPerks
      || (meta.lbPerks ? JSON.parse(meta.lbPerks) : null);

    if (perks && Array.isArray(perks) && perks.length > 0) {
      lbPerksApplied = applyPerksForPurchase(steamId, perks);
      const appliedCount = lbPerksApplied.filter(r => r.success).length;
      logger.info({ steamId, appliedCount, total: perks.length }, 'LB Master perks applied');
    }
  } catch (err) {
    logger.error({ err: err.message, steamId, productId }, 'Failed to apply LB Master perks');
    lbPerksApplied = [{ type: 'error', success: false, error: err.message }];
  }

  // Record purchase
  const purchase = {
    id: uuid(),
    steamId,
    playerName,
    email: session.customer_details?.email || '',
    productId,
    productName,
    role,
    durationDays,
    amount: session.amount_total || 0,
    currency: session.currency || 'usd',
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent || '',
    status: 'completed',
    priorityEntryId: entry.id,
    lbPerksApplied: lbPerksApplied || undefined,
    purchasedAt: new Date().toISOString(),
  };

  if (!ctx.storePurchases) ctx.storePurchases = [];
  ctx.storePurchases.push(purchase);
  _persistPurchases();

  logger.info({
    purchaseId: purchase.id,
    steamId,
    product: productName,
    amount: purchase.amount,
    role,
    durationDays,
  }, 'VIP purchase completed — priority queue entry created');

  // Fire notification
  addNotification(null, 'priority.purchased', 'VIP Purchased',
    `${playerName} (${steamId}) purchased ${productName}`, 'success');

  // Fire webhook
  const durationLabel = durationDays
    ? `${durationDays} day${durationDays === 1 ? '' : 's'}`
    : 'Permanent';
  const amountFormatted = `${(purchase.amount / 100).toFixed(2)} ${purchase.currency.toUpperCase()}`;

  fireWebhooks('priority.purchased', {
    playerName,
    steamId,
    productName,
    role,
    amount: amountFormatted,
    duration: durationLabel,
  }).catch(err => logger.error({ err }, 'Failed to fire priority.purchased webhook'));

  return purchase;
}

// ─── Store Status ────────────────────────────────────────

/**
 * Get public store status.
 */
function getStoreStatus() {
  const enabled = ctx.CONFIG?.store?.enabled === true;
  const hasStripe = !!ctx.CONFIG?.store?.stripeSecretKey;
  return {
    enabled: enabled && hasStripe,
    storeName: ctx.CONFIG?.store?.storeName || 'VIP Priority Queue',
    currency: ctx.CONFIG?.store?.currency || 'usd',
    stripeConfigured: hasStripe,
    stripeInstalled: !!Stripe,
  };
}

module.exports = {
  // Products
  listProducts,
  listActiveProducts,
  getProduct,
  addProduct,
  updateProduct,
  removeProduct,
  // Purchases
  listPurchases,
  getPurchasesByPlayer,
  // Stripe
  createCheckoutSession,
  handleWebhook,
  // Status
  getStoreStatus,
  isValidSteam64,
};
