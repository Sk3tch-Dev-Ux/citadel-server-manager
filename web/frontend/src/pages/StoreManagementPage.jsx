import { useState, useEffect, useCallback } from 'react';
import API from '../api';
import { timeAgo } from '../utils';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import Modal from '../components/ui/Modal';
import {
  ShoppingCart, CreditCard, Plus, Search, Trash2, Edit, Crown,
  AlertTriangle, CheckCircle, Info, Infinity, Calendar, ExternalLink, Copy, Link,
  Save, Eye, EyeOff, Loader, Settings,
} from '../components/Icon';

/** Duration presets for product creation */
const DURATION_PRESETS = [
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
  { label: '1 Year', days: 365 },
  { label: 'Permanent', days: null },
  { label: 'Custom', days: -1 },
];

/** Role options */
const ROLES = ['VIP', 'Supporter', 'Premium'];

/** Role badge colors */
const ROLE_COLORS = {
  VIP: '#f59e0b',
  Supporter: '#8b5cf6',
  Premium: '#ec4899',
};

/** Format price in cents to display string */
function formatPrice(cents, currency = 'usd') {
  const amount = (cents / 100).toFixed(2);
  const sym = { usd: '$', eur: '\u20ac', gbp: '\u00a3' }[currency] || currency.toUpperCase() + ' ';
  return `${sym}${amount}`;
}

/** Format duration display */
function formatDuration(days) {
  if (!days) return 'Permanent';
  if (days === 1) return '1 Day';
  if (days === 30) return '30 Days';
  if (days === 90) return '90 Days';
  if (days === 365) return '1 Year';
  return `${days} Days`;
}

// ═══════════════════════════════════════════════════════════
//  Product Form Modal
// ═══════════════════════════════════════════════════════════

function ProductModal({ product, onSave, onClose }) {
  const isEdit = !!product;
  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [role, setRole] = useState(product?.role || 'VIP');
  const [priceStr, setPriceStr] = useState(product ? (product.price / 100).toFixed(2) : '');
  const [currency, setCurrency] = useState(product?.currency || 'usd');
  const [durationPreset, setDurationPreset] = useState(() => {
    if (!product) return '30';
    if (product.durationDays === null) return 'permanent';
    const match = DURATION_PRESETS.find(p => p.days === product.durationDays);
    return match ? String(product.durationDays) : 'custom';
  });
  const [customDays, setCustomDays] = useState(product?.durationDays || 30);

  const getDurationDays = () => {
    if (durationPreset === 'permanent') return null;
    if (durationPreset === 'custom') return parseInt(customDays) || 30;
    return parseInt(durationPreset);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const priceInCents = Math.round(parseFloat(priceStr || '0') * 100);
    if (priceInCents < 50) {
      window.addToast?.('Price must be at least $0.50 (Stripe minimum)', 'error');
      return;
    }
    onSave({
      name: name.trim(),
      description: description.trim(),
      role,
      durationDays: getDurationDays(),
      price: priceInCents,
      currency: currency.toLowerCase(),
    });
  };

  return (
    <Modal open={true} title={isEdit ? 'Edit Product' : 'Add Product'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <label className="input-label">Product Name *</label>
          <input
            className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="VIP - 30 Days"
            required
          />
        </div>

        <div className="input-group">
          <label className="input-label">Description</label>
          <input
            className="input"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Skip the queue for 30 days"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="input-group">
            <label className="input-label">Role</label>
            <select className="input" value={role} onChange={e => setRole(e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="input-group">
            <label className="input-label">Price *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0.50"
                value={priceStr}
                onChange={e => setPriceStr(e.target.value)}
                placeholder="5.00"
                required
                style={{ flex: 1 }}
              />
              <select
                className="input"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                style={{ width: 80 }}
              >
                <option value="usd">USD</option>
                <option value="eur">EUR</option>
                <option value="gbp">GBP</option>
                <option value="cad">CAD</option>
                <option value="aud">AUD</option>
              </select>
            </div>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">Duration</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DURATION_PRESETS.map(p => {
              const val = p.days === null ? 'permanent' : p.days === -1 ? 'custom' : String(p.days);
              const isActive = durationPreset === val;
              return (
                <button
                  key={val}
                  type="button"
                  className={`btn ${isActive ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={() => setDurationPreset(val)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          {durationPreset === 'custom' && (
            <div style={{ marginTop: 8 }}>
              <input
                className="input"
                type="number"
                min="1"
                max="3650"
                value={customDays}
                onChange={e => setCustomDays(e.target.value)}
                placeholder="Number of days"
                style={{ width: 160 }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>days</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">
            {isEdit ? 'Save Changes' : 'Create Product'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════
//  Main Store Management Page
// ═══════════════════════════════════════════════════════════

export default function StoreManagementPage() {
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [storeStatus, setStoreStatus] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [search, setSearch] = useState('');
  const { confirm, DialogComponent } = useConfirmDialog();

  // ─── Stripe config state ────────────────────────────────
  const [stripeConfig, setStripeConfig] = useState(null);
  const [showStripeConfig, setShowStripeConfig] = useState(false);
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [stripeStoreName, setStripeStoreName] = useState('');
  const [stripeCurrency, setStripeCurrency] = useState('usd');
  const [stripeSaving, setStripeSaving] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);

  const loadStripeConfig = useCallback(async () => {
    try {
      const cfg = await API.get('/api/store/admin/stripe-config');
      setStripeConfig(cfg);
      setStripeEnabled(cfg.enabled || false);
      setStripeStoreName(cfg.storeName || 'VIP Priority Queue');
      setStripeCurrency(cfg.currency || 'usd');
      // Don't overwrite user's typed keys — only set empty placeholders
      setStripeSecretKey('');
      setStripeWebhookSecret('');
      // Auto-show config if Stripe is not configured
      if (!cfg.hasSecretKey) setShowStripeConfig(true);
    } catch { /* ignore */ }
  }, []);

  const saveStripeConfig = async () => {
    setStripeSaving(true);
    try {
      const payload = {
        enabled: stripeEnabled,
        storeName: stripeStoreName,
        currency: stripeCurrency,
      };
      // Only send keys if user actually typed new ones
      if (stripeSecretKey) payload.stripeSecretKey = stripeSecretKey;
      if (stripeWebhookSecret) payload.stripeWebhookSecret = stripeWebhookSecret;

      const result = await API.post('/api/store/admin/stripe-config', payload);
      if (result.error) {
        window.addToast?.(result.error, 'error');
      } else {
        window.addToast?.('Store configuration saved', 'success');
        setStripeSecretKey('');
        setStripeWebhookSecret('');
        // Refresh both stripe config and store status
        await Promise.all([loadStripeConfig(), loadData()]);
      }
    } catch (err) {
      window.addToast?.(err.message || 'Failed to save configuration', 'error');
    }
    setStripeSaving(false);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, status] = await Promise.all([
        API.get('/api/store/admin/products'),
        API.get('/api/store/status'),
      ]);
      setProducts(Array.isArray(prods) ? prods : []);
      setStoreStatus(status);
    } catch { /* fallback empty */ }
    setLoading(false);
  }, []);

  const loadPurchases = useCallback(async () => {
    try {
      const data = await API.get('/api/store/admin/purchases');
      setPurchases(Array.isArray(data) ? data : []);
    } catch { setPurchases([]); }
  }, []);

  useEffect(() => { loadData(); loadStripeConfig(); }, [loadData, loadStripeConfig]);
  useEffect(() => { if (tab === 'purchases') loadPurchases(); }, [tab, loadPurchases]);

  // ─── Product CRUD ──────────────────────────────────────
  const handleAddProduct = async (data) => {
    try {
      const product = await API.post('/api/store/admin/products', data);
      if (product.error) { window.addToast?.(product.error, 'error'); return; }
      setProducts(prev => [...prev, product]);
      setShowAdd(false);
      window.addToast?.(`Product "${product.name}" created`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Failed to create product', 'error');
    }
  };

  const handleUpdateProduct = async (data) => {
    try {
      const product = await API.patch(`/api/store/admin/products/${editProduct.id}`, data);
      if (product.error) { window.addToast?.(product.error, 'error'); return; }
      setProducts(prev => prev.map(p => p.id === editProduct.id ? product : p));
      setEditProduct(null);
      window.addToast?.(`Product "${product.name}" updated`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Failed to update product', 'error');
    }
  };

  const handleDeleteProduct = async (product) => {
    const yes = await confirm(`Delete "${product.name}"?`, 'This product will be permanently removed. Existing purchases are not affected.');
    if (!yes) return;
    try {
      await API.delete(`/api/store/admin/products/${product.id}`);
      setProducts(prev => prev.filter(p => p.id !== product.id));
      window.addToast?.(`Product "${product.name}" deleted`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Failed to delete product', 'error');
    }
  };

  const handleToggleActive = async (product) => {
    try {
      const updated = await API.patch(`/api/store/admin/products/${product.id}`, { active: !product.active });
      if (updated.error) { window.addToast?.(updated.error, 'error'); return; }
      setProducts(prev => prev.map(p => p.id === product.id ? updated : p));
      window.addToast?.(`Product "${product.name}" ${updated.active ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Failed to toggle product', 'error');
    }
  };

  // ─── Search filter ─────────────────────────────────────
  const filteredProducts = products.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q);
  });

  const filteredPurchases = purchases.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.playerName || '').toLowerCase().includes(q) ||
      (p.steamId || '').toLowerCase().includes(q) ||
      (p.productName || '').toLowerCase().includes(q)
    );
  });

  // ─── Stripe status ──────────────────────────────────────
  const storeEnabled = storeStatus?.enabled;

  return (
    <div style={{ maxWidth: 900 }}>
      {/* ═══ Stripe Configuration Section ═══ */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        marginBottom: 16,
        overflow: 'hidden',
      }}>
        {/* Config header — always visible */}
        <button
          onClick={() => setShowStripeConfig(!showStripeConfig)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%',
            padding: '14px 18px',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-primary)', fontFamily: 'var(--font-display)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Settings size={16} style={{ color: 'var(--accent-purple)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Stripe Configuration</span>
            {stripeConfig?.hasSecretKey ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                background: stripeEnabled && storeEnabled
                  ? 'rgba(92,184,92,0.12)' : stripeConfig?.hasSecretKey
                    ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.12)',
                color: stripeEnabled && storeEnabled
                  ? 'var(--accent-green)' : stripeConfig?.hasSecretKey
                    ? 'var(--accent-blue)' : '#f59e0b',
              }}>
                {stripeEnabled && storeEnabled ? <><CheckCircle size={10} /> Live</> :
                 stripeConfig?.hasSecretKey ? <><Info size={10} /> Configured</> :
                 <><AlertTriangle size={10} /> Not configured</>}
              </span>
            ) : (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
              }}>
                <AlertTriangle size={10} /> Not configured
              </span>
            )}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{showStripeConfig ? '▲ Hide' : '▼ Show'}</span>
        </button>

        {/* Config body — collapsible */}
        {showStripeConfig && (
          <div style={{ padding: '0 18px 18px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '14px 0', lineHeight: 1.5 }}>
              Enter your Stripe API keys to enable the VIP store. Get your keys from{' '}
              <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                Stripe Dashboard → API Keys <ExternalLink size={9} />
              </a>
            </div>

            {/* Secret Key */}
            <div className="input-group" style={{ marginBottom: 12 }}>
              <label className="input-label">Stripe Secret Key</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showSecretKey ? 'text' : 'password'}
                  value={stripeSecretKey}
                  onChange={e => setStripeSecretKey(e.target.value)}
                  placeholder={stripeConfig?.hasSecretKey ? `Current: ${stripeConfig.secretKeyPrefix}` : 'sk_test_... or sk_live_...'}
                  autoComplete="off"
                  style={{ paddingRight: 36 }}
                />
                <button
                  type="button"
                  onClick={() => setShowSecretKey(!showSecretKey)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                >
                  {showSecretKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {stripeConfig?.hasSecretKey && !stripeSecretKey && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  ✓ Key is saved. Leave blank to keep current key.
                </div>
              )}
            </div>

            {/* Webhook Secret */}
            <div className="input-group" style={{ marginBottom: 12 }}>
              <label className="input-label">Webhook Secret</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showWebhookSecret ? 'text' : 'password'}
                  value={stripeWebhookSecret}
                  onChange={e => setStripeWebhookSecret(e.target.value)}
                  placeholder={stripeConfig?.hasWebhookSecret ? `Current: ${stripeConfig.webhookSecretPrefix}` : 'whsec_...'}
                  autoComplete="off"
                  style={{ paddingRight: 36 }}
                />
                <button
                  type="button"
                  onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                >
                  {showWebhookSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {stripeConfig?.hasWebhookSecret && !stripeWebhookSecret && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  ✓ Secret is saved. Leave blank to keep current secret.
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                <Info size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                Create a webhook endpoint in Stripe pointing to <code style={{ fontSize: 10 }}>{window.location.origin}/api/store/webhook</code> for event <code style={{ fontSize: 10 }}>checkout.session.completed</code>.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              {/* Store Name */}
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Store Name</label>
                <input
                  className="input"
                  value={stripeStoreName}
                  onChange={e => setStripeStoreName(e.target.value)}
                  placeholder="VIP Priority Queue"
                />
              </div>

              {/* Currency */}
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Default Currency</label>
                <select className="input" value={stripeCurrency} onChange={e => setStripeCurrency(e.target.value)}>
                  <option value="usd">USD ($)</option>
                  <option value="eur">EUR (€)</option>
                  <option value="gbp">GBP (£)</option>
                  <option value="cad">CAD ($)</option>
                  <option value="aud">AUD ($)</option>
                </select>
              </div>
            </div>

            {/* Enable toggle + Save */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={stripeEnabled}
                  onChange={e => setStripeEnabled(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <span style={{ fontWeight: 600 }}>Enable Store</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— make the public store page accessible to players</span>
              </label>
              <button
                className="btn btn-primary btn-sm"
                onClick={saveStripeConfig}
                disabled={stripeSaving}
                style={{ minWidth: 120 }}
              >
                {stripeSaving ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : <><Save size={14} /> Save Config</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Store live banner with share links */}
      {storeEnabled && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'rgba(92,184,92,0.08)',
          border: '1px solid rgba(92,184,92,0.2)',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 13,
          color: 'var(--text-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle size={16} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
            <div>
              Store is <strong style={{ color: 'var(--accent-green)' }}>live</strong>.
              Share the link below with your players so they can purchase VIP access.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const url = `${window.location.origin}/store`;
                navigator.clipboard.writeText(url).then(() => {
                  window.addToast?.('Store link copied to clipboard!', 'success');
                }).catch(() => {
                  window.addToast?.(url, 'info');
                });
              }}
              title="Copy public store URL"
            >
              <Copy size={12} /> Copy Store Link
            </button>
            <a
              href="/store"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ textDecoration: 'none' }}
              title="Open store in new tab"
            >
              <ExternalLink size={12} /> Preview
            </a>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Tab Switcher */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
            <button
              className={`btn btn-sm ${tab === 'products' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setTab('products'); setSearch(''); }}
              style={{ border: 'none' }}
            >
              <ShoppingCart size={13} /> Products ({products.length})
            </button>
            <button
              className={`btn btn-sm ${tab === 'purchases' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setTab('purchases'); setSearch(''); }}
              style={{ border: 'none' }}
            >
              <CreditCard size={13} /> Purchases ({purchases.length})
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'products' && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add Product
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          className="input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tab === 'products' ? 'Search products...' : 'Search by player name or Steam ID...'}
          style={{ paddingLeft: 34 }}
        />
      </div>

      {/* ═══ Products Tab ═══ */}
      {tab === 'products' && (
        loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>Loading products...</div>
        ) : filteredProducts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <ShoppingCart size={48} style={{ opacity: 0.15, marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
              {search ? 'No matching products' : 'No products yet'}
            </div>
            <div style={{ fontSize: 13, marginBottom: 16, maxWidth: 360, margin: '0 auto' }}>
              {search ? 'Try a different search term.' : 'Create VIP tier products that players can purchase from the public store.'}
            </div>
            {!search && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
                <Plus size={14} /> Create First Product
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredProducts.map(product => (
              <div
                key={product.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  opacity: product.active ? 1 : 0.5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
                  <Crown size={18} style={{ color: ROLE_COLORS[product.role] || '#f59e0b' }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{product.name}</div>
                    {product.description && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{product.description}</div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {/* Role Badge */}
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: `${ROLE_COLORS[product.role] || '#f59e0b'}18`,
                    border: `1px solid ${ROLE_COLORS[product.role] || '#f59e0b'}40`,
                    color: ROLE_COLORS[product.role] || '#f59e0b',
                    fontSize: 11,
                    fontWeight: 600,
                  }}>
                    {product.role}
                  </span>

                  {/* Duration */}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', minWidth: 80 }}>
                    {product.durationDays ? <Calendar size={12} /> : <Infinity size={12} />}
                    {formatDuration(product.durationDays)}
                  </span>

                  {/* Price */}
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--accent-green)',
                    minWidth: 60,
                    textAlign: 'right',
                  }}>
                    {formatPrice(product.price, product.currency)}
                  </span>

                  {/* Status toggle */}
                  <button
                    className={`btn btn-xs ${product.active ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleToggleActive(product)}
                    style={{ minWidth: 60 }}
                  >
                    {product.active ? 'Active' : 'Inactive'}
                  </button>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-icon btn-xs" title="Edit" onClick={() => setEditProduct(product)}>
                      <Edit size={13} />
                    </button>
                    <button className="btn btn-icon btn-xs" title="Delete" onClick={() => handleDeleteProduct(product)}
                      style={{ color: 'var(--accent-red)' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ═══ Purchases Tab ═══ */}
      {tab === 'purchases' && (
        filteredPurchases.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <CreditCard size={48} style={{ opacity: 0.15, marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
              {search ? 'No matching purchases' : 'No purchases yet'}
            </div>
            <div style={{ fontSize: 13 }}>
              {search ? 'Try a different search term.' : 'Purchases will appear here when players buy VIP access.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Player</th>
                  <th style={thStyle}>Steam ID</th>
                  <th style={thStyle}>Product</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.slice().reverse().map(purchase => (
                  <tr key={purchase.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {timeAgo(purchase.purchasedAt)}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{purchase.playerName || 'Unknown'}</span>
                      {purchase.email && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{purchase.email}</div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                        {purchase.steamId}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Crown size={13} style={{ color: ROLE_COLORS[purchase.role] || '#f59e0b' }} />
                        <span style={{ fontSize: 13 }}>{purchase.productName}</span>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-green)', fontSize: 13 }}>
                        {formatPrice(purchase.amount, purchase.currency)}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: purchase.status === 'completed' ? 'rgba(92,184,92,0.12)' : 'rgba(245,158,11,0.12)',
                        color: purchase.status === 'completed' ? 'var(--accent-green)' : '#f59e0b',
                      }}>
                        {purchase.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Modals */}
      {showAdd && (
        <ProductModal
          onSave={handleAddProduct}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editProduct && (
        <ProductModal
          product={editProduct}
          onSave={handleUpdateProduct}
          onClose={() => setEditProduct(null)}
        />
      )}
      {DialogComponent}
    </div>
  );
}

// ─── Table Styles ────────────────────────────────────────

const thStyle = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-card)',
};

const tdStyle = {
  padding: '10px 12px',
  fontSize: 13,
  verticalAlign: 'middle',
};
