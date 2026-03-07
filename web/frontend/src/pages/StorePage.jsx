/* eslint-disable no-shadow-restricted-names */
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crown, ShoppingCart, CheckCircle, AlertTriangle, Loader, ExternalLink, Infinity, Calendar, Tag } from '../components/Icon';
import API from '../api';

/**
 * Public VIP Store — standalone page (no auth required).
 * Players select a VIP tier, enter their Steam64 ID, and checkout via Stripe.
 */
export default function StorePage() {
  const [searchParams] = useSearchParams();
  const isSuccess = searchParams.get('success') === 'true';
  const isCancelled = searchParams.get('cancelled') === 'true';

  const [status, setStatus] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [steamId, setSteamId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);

  const fetchStore = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, productsRes] = await Promise.all([
        API.get('/api/store/status'),
        API.get('/api/store/products'),
      ]);
      setStatus(statusRes);
      setProducts(productsRes || []);
    } catch (err) {
      setError('Failed to load store');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStore(); }, [fetchStore]);

  const isValidSteam64 = (id) => /^7656119\d{10}$/.test(id);

  const handleCheckout = async () => {
    if (!selectedProduct) return;
    if (!isValidSteam64(steamId)) {
      setError('Invalid Steam64 ID. Must be 17 digits starting with 7656119.');
      return;
    }
    setError('');
    setCheckingOut(true);
    try {
      const result = await API.post('/api/store/checkout', {
        productId: selectedProduct.id,
        steamId,
        playerName: playerName || '',
      });
      if (result.url) {
        window.location.href = result.url;
      } else {
        setError(result.error || 'Failed to create checkout session');
        setCheckingOut(false);
      }
    } catch (err) {
      setError(err.message || 'Checkout failed');
      setCheckingOut(false);
    }
  };

  const formatPrice = (price, currency) => {
    const amount = (price / 100).toFixed(2);
    const sym = { usd: '$', eur: '\u20ac', gbp: '\u00a3' }[currency] || currency.toUpperCase() + ' ';
    return `${sym}${amount}`;
  };

  const formatDuration = (days) => {
    if (!days) return 'Permanent';
    if (days === 1) return '1 Day';
    if (days < 30) return `${days} Days`;
    if (days === 30) return '30 Days';
    if (days === 90) return '90 Days';
    if (days === 365) return '1 Year';
    return `${days} Days`;
  };

  // ─── Loading State ────────────────────────────────────
  if (loading) {
    return (
      <div className="login-screen">
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <Loader size={32} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
          <div style={{ fontSize: 14 }}>Loading store...</div>
        </div>
      </div>
    );
  }

  // ─── Store Disabled ───────────────────────────────────
  if (!status?.enabled) {
    return (
      <div className="login-screen">
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <img src="/citadel-logo.svg" alt="Citadel" style={{ width: 48, height: 48, marginBottom: 16 }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Store Not Available</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
            The VIP store is currently not active. Please contact the server owner for more information.
          </p>
        </div>
      </div>
    );
  }

  // ─── Success State ────────────────────────────────────
  if (isSuccess) {
    return (
      <div className="login-screen">
        <div style={{ textAlign: 'center', maxWidth: 420, padding: 40 }}>
          <CheckCircle size={56} style={{ color: 'var(--accent-green)', marginBottom: 16 }} />
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Purchase Complete!</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
            Your purchase has been activated. All perks have been applied to your account.
          </p>
          <div style={{
            background: 'rgba(92,184,92,0.08)',
            border: '1px solid rgba(92,184,92,0.2)',
            borderRadius: 8,
            padding: '14px 18px',
            fontSize: 13,
            color: 'var(--text-secondary)',
          }}>
            <CheckCircle size={16} style={{ color: 'var(--accent-green)', verticalAlign: 'middle', marginRight: 6 }} />
            Your Steam ID has been processed. Changes take effect immediately.
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => window.location.href = '/store'}
            style={{ marginTop: 20 }}
          >
            Back to Store
          </button>
        </div>
      </div>
    );
  }

  // ─── Cancelled State ──────────────────────────────────
  if (isCancelled) {
    return (
      <div className="login-screen">
        <div style={{ textAlign: 'center', maxWidth: 400, padding: 40 }}>
          <AlertTriangle size={48} style={{ color: 'var(--accent-yellow)', marginBottom: 16 }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Payment Cancelled</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
            Your payment was cancelled. No charges have been made.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => window.location.href = '/store'}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ─── Main Store ───────────────────────────────────────
  return (
    <div className="login-screen" style={{ padding: 20, alignItems: 'flex-start', paddingTop: '6vh', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 640 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/citadel-logo.svg" alt="Citadel" style={{ width: 44, height: 44, marginBottom: 12 }} />
          <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 6 }}>
            {status?.storeName || 'VIP Priority Queue'}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Purchase VIP perks and priority queue access
          </p>
        </div>

        {/* Steam ID Input */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          marginBottom: 20,
        }}>
          <div className="input-group" style={{ marginBottom: 12 }}>
            <label className="input-label" htmlFor="store-steamid">Steam64 ID *</label>
            <input
              id="store-steamid"
              className="input"
              type="text"
              value={steamId}
              onChange={e => setSteamId(e.target.value.replace(/\D/g, '').slice(0, 17))}
              placeholder="76561198012345678"
              maxLength={17}
              style={{
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.5px',
                ...(steamId && !isValidSteam64(steamId)
                  ? { borderColor: 'var(--accent-red)', boxShadow: '0 0 0 1px rgba(224,108,117,0.2)' }
                  : steamId && isValidSteam64(steamId)
                    ? { borderColor: 'var(--accent-green)', boxShadow: '0 0 0 1px rgba(92,184,92,0.2)' }
                    : {}
                ),
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              Find your Steam64 ID at{' '}
              <a href="https://steamid.io" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                steamid.io <ExternalLink size={9} />
              </a>
            </div>
          </div>

          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label" htmlFor="store-playername">Player Name <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-muted)' }}>(optional)</span></label>
            <input
              id="store-playername"
              className="input"
              type="text"
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Your in-game name"
            />
          </div>
        </div>

        {/* Product Cards */}
        {products.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--text-muted)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
          }}>
            <ShoppingCart size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontSize: 14 }}>No products available</div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: products.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}>
            {products.map(product => {
              const isSelected = selectedProduct?.id === product.id;
              return (
                <button
                  key={product.id}
                  onClick={() => setSelectedProduct(product)}
                  style={{
                    background: isSelected ? 'rgba(108,180,240,0.08)' : 'var(--bg-card)',
                    border: isSelected ? '2px solid var(--accent-blue)' : '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: isSelected ? 19 : 20,
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-display)',
                    width: '100%',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {product.role
                        ? <Crown size={16} style={{ color: isSelected ? 'var(--accent-blue)' : 'var(--accent-yellow)' }} />
                        : <Tag size={16} style={{ color: isSelected ? 'var(--accent-blue)' : 'var(--accent-purple)' }} />
                      }
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{product.name}</span>
                    </div>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 18,
                      fontWeight: 700,
                      color: isSelected ? 'var(--accent-blue)' : 'var(--accent-green)',
                    }}>
                      {formatPrice(product.price, product.currency)}
                    </span>
                  </div>

                  {product.description && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.4 }}>
                      {product.description}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    {product.role && (
                      <>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {product.durationDays ? <Calendar size={11} /> : <Infinity size={11} />}
                          {formatDuration(product.durationDays)}
                        </span>
                        <span style={{
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: 'rgba(196,155,255,0.1)',
                          border: '1px solid rgba(196,155,255,0.2)',
                          color: 'var(--accent-purple)',
                          fontSize: 10,
                          fontWeight: 600,
                        }}>
                          {product.role}
                        </span>
                      </>
                    )}
                    {product.lbPerks?.some(p => p.type === 'chatPrefix') && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '1px 6px', borderRadius: 4,
                        background: 'rgba(139,92,246,0.1)',
                        border: '1px solid rgba(139,92,246,0.2)',
                        color: 'var(--accent-purple)',
                        fontSize: 10, fontWeight: 600,
                      }}>
                        <Tag size={9} /> Chat Prefix
                      </span>
                    )}
                    {product.lbPerks?.some(p => p.type === 'tagColor') && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '1px 6px', borderRadius: 4,
                        background: 'rgba(56,189,248,0.1)',
                        border: '1px solid rgba(56,189,248,0.2)',
                        color: '#38bdf8',
                        fontSize: 10, fontWeight: 600,
                      }}>
                        <Tag size={9} /> Tag Color
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            background: 'rgba(224,108,117,0.1)',
            border: '1px solid rgba(224,108,117,0.2)',
            borderRadius: 'var(--radius)',
            marginBottom: 16,
            fontSize: 13,
            color: 'var(--accent-red)',
          }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {/* Checkout Button */}
        <button
          className="btn btn-primary"
          onClick={handleCheckout}
          disabled={!selectedProduct || !isValidSteam64(steamId) || checkingOut}
          style={{
            width: '100%',
            justifyContent: 'center',
            padding: '12px 20px',
            fontSize: 15,
            fontWeight: 700,
          }}
        >
          {checkingOut ? (
            <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Redirecting to payment...</>
          ) : selectedProduct ? (
            <><ShoppingCart size={16} /> Purchase {selectedProduct.name} &mdash; {formatPrice(selectedProduct.price, selectedProduct.currency)}</>
          ) : (
            <><ShoppingCart size={16} /> Select a tier to continue</>
          )}
        </button>

        {/* Powered by Stripe notice */}
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--text-muted)' }}>
          Secure payments powered by Stripe. We never store your card information.
        </div>
      </div>
    </div>
  );
}
