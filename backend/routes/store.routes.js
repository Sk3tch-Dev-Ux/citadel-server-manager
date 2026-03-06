/**
 * VIP Store routes — public store + admin product management.
 *
 * Public endpoints (no auth): product listing, checkout, webhook, status.
 * Admin endpoints (auth required): CRUD for products, purchase history.
 */
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
      const { name, description, role, durationDays, price, currency } = req.body;
      const product = addProduct({ name, description, role, durationDays, price, currency });

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
};
