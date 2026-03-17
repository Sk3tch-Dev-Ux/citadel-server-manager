/**
 * VIP Store routes — public store + admin product management.
 *
 * Public endpoints (no auth): product listing, checkout, webhook, status.
 * Admin endpoints (auth required): CRUD for products, purchase history, Stripe config.
 */
const fs = require('fs');
const path = require('path');
const {
  listActiveProducts, listProducts, getProduct,
  addProduct, updateProduct, removeProduct,
  listPurchases,
  createCheckoutSession, handleWebhook,
  getStoreStatus, isValidSteam64,
} = require('../lib/store');
const auth = require('../middleware/auth');
const { addAudit } = require('../lib/audit');
const logger = require('../lib/logger');
const CONFIG = require('../lib/config');
const { ENV_FILE } = require('../lib/paths');

module.exports = function (app) {

  // ═══════════════════════════════════════════════════════
  //  PUBLIC ENDPOINTS (no auth)
  // ═══════════════════════════════════════════════════════

  // ─── Store status ────────────────────────────────────
  app.get('/api/store/status', (req, res) => {
    const status = getStoreStatus();
    res.json(status);
  });

  // ─── List active products (public) ───────────────────
  app.get('/api/store/products', (req, res) => {
    const status = getStoreStatus();
    if (!status.enabled) {
      return res.json([]);
    }
    res.json(listActiveProducts());
  });

  // ─── Create Stripe Checkout Session ──────────────────
  app.post('/api/store/checkout', async (req, res) => {
    try {
      const status = getStoreStatus();
      if (!status.enabled) {
        return res.status(400).json({ error: 'Store is not enabled' });
      }
      if (!status.stripeInstalled) {
        return res.status(501).json({ error: 'Stripe SDK is not installed on this server' });
      }

      const { productId, steamId, playerName } = req.body;

      if (!productId) return res.status(400).json({ error: 'productId is required' });
      if (!steamId) return res.status(400).json({ error: 'steamId is required' });
      if (!isValidSteam64(steamId)) {
        return res.status(400).json({ error: 'Invalid Steam64 ID. Must be 17 digits starting with 7656119.' });
      }

      // Derive base URL from request
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const baseUrl = `${protocol}://${host}`;

      const result = await createCheckoutSession({
        productId,
        steamId,
        playerName: playerName || '',
        baseUrl,
      });

      res.json(result);
    } catch (err) {
      logger.error({ err: err.message }, 'Checkout session creation failed');
      res.status(400).json({ error: err.message || 'Checkout failed' });
    }
  });

  // ─── Stripe Webhook ──────────────────────────────────
  app.post('/api/store/webhook', async (req, res) => {
    try {
      const signature = req.headers['stripe-signature'];
      if (!signature) {
        return res.status(400).json({ error: 'Missing Stripe-Signature header' });
      }

      // Use raw body preserved by the verify callback in express.json()
      const rawBody = req.rawBody;
      if (!rawBody) {
        logger.error('Stripe webhook: rawBody not available — check express.json verify callback');
        return res.status(500).json({ error: 'Raw body not available for signature verification' });
      }

      const purchase = await handleWebhook(rawBody, signature);

      if (purchase) {
        logger.info({ purchaseId: purchase.id, steamId: purchase.steamId }, 'Stripe webhook processed — VIP provisioned');
      }

      // Always return 200 to acknowledge receipt (even for events we don't handle)
      res.json({ received: true });
    } catch (err) {
      logger.error({ err: err.message }, 'Stripe webhook processing failed');
      // Return 400 so Stripe retries
      res.status(400).json({ error: err.message || 'Webhook processing failed' });
    }
  });

  // ═══════════════════════════════════════════════════════
  //  ADMIN ENDPOINTS (auth required)
  // ═══════════════════════════════════════════════════════

  // ─── List all products (including inactive) ──────────
  app.get('/api/store/admin/products', auth('priority.manage'), (req, res) => {
    res.json(listProducts());
  });

  // ─── Create product ─────────────────────────────────
  app.post('/api/store/admin/products', auth('priority.manage'), (req, res) => {
    try {
      const { name, description, role, durationDays, price, currency, lbPerks } = req.body;
      const product = addProduct({ name, description, role, durationDays, price, currency, lbPerks });

      addAudit(req.user.id, req.user.username, 'store.product.add',
        `Created store product: ${product.name} (${product.role}, $${(product.price / 100).toFixed(2)} ${product.currency.toUpperCase()})`);

      res.json(product);
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to create store product');
      res.status(400).json({ error: err.message || 'Failed to create product' });
    }
  });

  // ─── Update product ─────────────────────────────────
  app.patch('/api/store/admin/products/:id', auth('priority.manage'), (req, res) => {
    try {
      const product = updateProduct(req.params.id, req.body);
      if (!product) return res.status(404).json({ error: 'Product not found' });

      addAudit(req.user.id, req.user.username, 'store.product.update',
        `Updated store product: ${product.name}`);

      res.json(product);
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to update store product');
      res.status(400).json({ error: err.message || 'Failed to update product' });
    }
  });

  // ─── Delete product ─────────────────────────────────
  app.delete('/api/store/admin/products/:id', auth('priority.manage'), (req, res) => {
    try {
      const product = removeProduct(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found' });

      addAudit(req.user.id, req.user.username, 'store.product.delete',
        `Deleted store product: ${product.name}`);

      res.json({ message: `Deleted product: ${product.name}` });
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to delete store product');
      res.status(400).json({ error: err.message || 'Failed to delete product' });
    }
  });

  // ─── Purchase history ───────────────────────────────
  app.get('/api/store/admin/purchases', auth('priority.manage'), (req, res) => {
    res.json(listPurchases());
  });

  // ═══════════════════════════════════════════════════════
  //  STRIPE CONFIGURATION (admin only)
  // ═══════════════════════════════════════════════════════

  /**
   * Get Stripe config status — reveals whether keys are set (not the keys themselves).
   */
  app.get('/api/store/admin/stripe-config', auth('priority.manage'), (req, res) => {
    const secretKey = CONFIG._structured?.store?.stripeSecretKey || '';
    const webhookSecret = CONFIG._structured?.store?.stripeWebhookSecret || '';
    res.json({
      hasSecretKey: !!secretKey,
      hasWebhookSecret: !!webhookSecret,
      secretKeyPrefix: secretKey ? '...' + secretKey.slice(-4) : '',
      webhookSecretPrefix: webhookSecret ? '...' + webhookSecret.slice(-4) : '',
      enabled: CONFIG._structured?.store?.enabled === true,
      storeName: CONFIG._structured?.store?.storeName || 'VIP Priority Queue',
      currency: CONFIG._structured?.store?.currency || 'usd',
    });
  });

  /**
   * Save Stripe config — persists keys to .env and non-sensitive settings to config file.
   * Follows the same pattern as Steam credentials for sensitive key storage.
   */
  app.post('/api/store/admin/stripe-config', auth('priority.manage'), async (req, res) => {
    try {
      const { stripeSecretKey, stripeWebhookSecret, enabled, storeName, currency } = req.body;

      // ── Validate Stripe keys if provided ───────────────────
      if (stripeSecretKey !== undefined && stripeSecretKey !== '') {
        if (!stripeSecretKey.startsWith('sk_')) {
          return res.status(400).json({ error: 'Stripe Secret Key must start with "sk_test_" or "sk_live_"' });
        }
      }
      if (stripeWebhookSecret !== undefined && stripeWebhookSecret !== '') {
        if (!stripeWebhookSecret.startsWith('whsec_')) {
          return res.status(400).json({ error: 'Stripe Webhook Secret must start with "whsec_"' });
        }
      }

      // ── Persist sensitive keys to .env ─────────────────────
      const keysChanged = [];
      if (stripeSecretKey !== undefined) {
        _persistEnvVar('STRIPE_SECRET_KEY', stripeSecretKey);
        CONFIG._structured.store.stripeSecretKey = stripeSecretKey;
        keysChanged.push('stripeSecretKey');
      }
      if (stripeWebhookSecret !== undefined) {
        _persistEnvVar('STRIPE_WEBHOOK_SECRET', stripeWebhookSecret);
        CONFIG._structured.store.stripeWebhookSecret = stripeWebhookSecret;
        keysChanged.push('stripeWebhookSecret');
      }

      // ── Update non-sensitive settings via normal config ────
      const configUpdates = {};
      if (enabled !== undefined) configUpdates.enabled = !!enabled;
      if (storeName !== undefined) configUpdates.storeName = storeName;
      if (currency !== undefined) configUpdates.currency = (currency || 'usd').toLowerCase();

      if (Object.keys(configUpdates).length > 0) {
        CONFIG._applyUpdate({ store: configUpdates });
      }

      addAudit(req.user.id, req.user.username, 'store.config.update',
        `Updated store configuration: ${[...keysChanged, ...Object.keys(configUpdates)].join(', ')}`);

      logger.info({ fields: [...keysChanged, ...Object.keys(configUpdates)] }, 'Store configuration updated');

      res.json({
        success: true,
        hasSecretKey: !!CONFIG._structured.store.stripeSecretKey,
        hasWebhookSecret: !!CONFIG._structured.store.stripeWebhookSecret,
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to update store configuration');
      res.status(500).json({ error: err.message || 'Failed to save configuration' });
    }
  });
};

// ─── Helpers ──────────────────────────────────────────────

/**
 * Persist (or update) a single env var in the .env file.
 * Same pattern used by Steam credential persistence.
 */
function _persistEnvVar(envKey, value) {
  try {
    const envPath = ENV_FILE;
    if (!fs.existsSync(envPath)) return;
    let envContent = fs.readFileSync(envPath, 'utf-8');

    const regex = new RegExp(`^#?\\s*${envKey}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${envKey}=${value}`);
    } else {
      envContent += `\n${envKey}=${value}`;
    }

    fs.writeFileSync(envPath, envContent);
    logger.debug(`Persisted ${envKey} to .env`);
  } catch (err) {
    logger.warn({ err, envKey }, 'Failed to persist env var to .env');
  }
}
