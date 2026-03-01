---
layout: page
title: Purchase Citadel
---

<script setup>
// Replace with your actual Stripe Payment Link or Checkout URL
const PURCHASE_URL = 'https://buy.stripe.com/YOUR_PAYMENT_LINK';
</script>

<style>
.purchase-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 24px;
  text-align: center;
}
.purchase-page h1 {
  font-size: 2.4rem;
  font-weight: 800;
  margin-bottom: 8px;
}
.purchase-page .tagline {
  color: var(--vp-c-text-2);
  font-size: 1.1rem;
  margin-bottom: 48px;
}
.price-card {
  background: var(--vp-c-bg-soft);
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 16px;
  padding: 40px 32px;
  margin-bottom: 48px;
}
.price-card .badge {
  display: inline-block;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 12px;
  border-radius: 20px;
  margin-bottom: 16px;
}
.price-card .price {
  font-size: 3.5rem;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 4px;
}
.price-card .price-sub {
  color: var(--vp-c-text-2);
  font-size: 0.95rem;
  margin-bottom: 24px;
}
.price-card .buy-btn {
  display: inline-block;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-weight: 700;
  font-size: 1.1rem;
  padding: 14px 40px;
  border-radius: 10px;
  text-decoration: none;
  transition: opacity 0.2s;
}
.price-card .buy-btn:hover {
  opacity: 0.9;
}
.features-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  text-align: left;
  margin-bottom: 48px;
}
@media (max-width: 640px) {
  .features-grid { grid-template-columns: 1fr; }
}
.features-grid .feat {
  background: var(--vp-c-bg-soft);
  border-radius: 10px;
  padding: 20px;
}
.features-grid .feat .feat-icon {
  font-size: 1.4rem;
  margin-bottom: 8px;
}
.features-grid .feat h3 {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0 0 6px;
}
.features-grid .feat p {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin: 0;
  line-height: 1.5;
}
.how-it-works {
  text-align: left;
  margin-bottom: 48px;
}
.how-it-works h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 20px;
  text-align: center;
}
.how-it-works ol {
  list-style: none;
  padding: 0;
  counter-reset: step;
}
.how-it-works ol li {
  counter-increment: step;
  position: relative;
  padding: 16px 16px 16px 56px;
  background: var(--vp-c-bg-soft);
  border-radius: 10px;
  margin-bottom: 12px;
}
.how-it-works ol li::before {
  content: counter(step);
  position: absolute;
  left: 16px;
  top: 16px;
  width: 28px;
  height: 28px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-weight: 700;
  font-size: 0.85rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.how-it-works ol li strong {
  display: block;
  margin-bottom: 4px;
}
.how-it-works ol li span {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}
.faq {
  text-align: left;
  margin-bottom: 48px;
}
.faq h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 20px;
  text-align: center;
}
.faq details {
  background: var(--vp-c-bg-soft);
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 8px;
}
.faq details summary {
  font-weight: 600;
  cursor: pointer;
}
.faq details p {
  color: var(--vp-c-text-2);
  margin: 12px 0 0;
  font-size: 0.9rem;
  line-height: 1.6;
}
</style>

<div class="purchase-page">

<h1>Get Citadel</h1>
<p class="tagline">The all-in-one DayZ server management platform. One purchase, lifetime access.</p>

<div class="price-card">
  <div class="badge">Lifetime License</div>
  <div class="price">$34.99</div>
  <div class="price-sub">One-time payment · No subscriptions · All features included</div>
  <a :href="PURCHASE_URL" class="buy-btn">Purchase Now</a>
</div>

<div class="features-grid">
  <div class="feat">
    <div class="feat-icon">🖥️</div>
    <h3>Web Dashboard</h3>
    <p>Real-time monitoring, RCON console, file editor, player management, and scheduler.</p>
  </div>
  <div class="feat">
    <div class="feat-icon">🤖</div>
    <h3>Discord Bot</h3>
    <p>Control servers from Discord with button commands, live embeds, and kill feed.</p>
  </div>
  <div class="feat">
    <div class="feat-icon">🎮</div>
    <h3>In-Game Admin Mod</h3>
    <p>@CitadelAdmin DayZ mod for server-side commands, tracking, and vehicle management.</p>
  </div>
  <div class="feat">
    <div class="feat-icon">📦</div>
    <h3>Mod Manager</h3>
    <p>Install, update, and manage Steam Workshop mods with dependency resolution.</p>
  </div>
  <div class="feat">
    <div class="feat-icon">🔄</div>
    <h3>Automated Backups</h3>
    <p>Scheduled backups with retention policies, one-click restore, and offsite support.</p>
  </div>
  <div class="feat">
    <div class="feat-icon">⚡</div>
    <h3>Lifetime Updates</h3>
    <p>Every future update, feature, and improvement — included forever.</p>
  </div>
</div>

<div class="how-it-works">
  <h2>How It Works</h2>
  <ol>
    <li>
      <strong>Purchase</strong>
      <span>Complete checkout via Stripe. You'll enter your GitHub username during payment.</span>
    </li>
    <li>
      <strong>Get Access</strong>
      <span>You'll receive a GitHub repository invitation and a license key via email within minutes.</span>
    </li>
    <li>
      <strong>Clone &amp; Deploy</strong>
      <span>Clone the private repo to your server and follow the setup guide.</span>
    </li>
    <li>
      <strong>Activate</strong>
      <span>Paste your license key in the Citadel dashboard or .env file. You're live.</span>
    </li>
  </ol>
</div>

<div class="faq">
  <h2>FAQ</h2>
  <details>
    <summary>What do I need to run Citadel?</summary>
    <p>A Windows or Linux server with Node.js 18+, a DayZ server, and optionally a Discord bot token. See the <a href="/DayzServerController/guide/prerequisites">prerequisites guide</a>.</p>
  </details>
  <details>
    <summary>Is this a subscription?</summary>
    <p>No. It's a one-time purchase of $34.99. You get lifetime access to the repository, all features, and future updates.</p>
  </details>
  <details>
    <summary>How do I receive the software?</summary>
    <p>After purchase, you'll be auto-invited to the private GitHub repository. Clone it, follow the README, and you're up and running.</p>
  </details>
  <details>
    <summary>What if the GitHub invite doesn't arrive?</summary>
    <p>Check your GitHub notifications at github.com/notifications. If it's still missing, contact support with your purchase receipt and GitHub username.</p>
  </details>
  <details>
    <summary>Can I get a refund?</summary>
    <p>We offer refunds within 48 hours of purchase if you haven't cloned the repository. Contact support with your receipt.</p>
  </details>
  <details>
    <summary>Do I need a license key?</summary>
    <p>Yes. The license key is emailed to you after purchase and activates all features in your Citadel dashboard. The GitHub repo gives you the code; the key unlocks it.</p>
  </details>
</div>

<div class="price-card" style="border-color: var(--vp-c-divider);">
  <div class="price">$34.99</div>
  <div class="price-sub">Ready to take control of your DayZ servers?</div>
  <a :href="PURCHASE_URL" class="buy-btn">Purchase Citadel</a>
</div>

</div>
