/**
 * License key and subscription email delivery via SMTP.
 *
 * Configure via environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 */
const nodemailer = require('nodemailer');

const EMAIL_FROM = process.env.EMAIL_FROM || 'Citadel Licenses <licenses@citadel.gg>';

const TIER_NAMES = {
  basic: 'Basic',
  pro: 'Pro',
  community: 'Community',
};

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  const port = parseInt(process.env.SMTP_PORT || '587');
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/**
 * Send the initial license key email after subscription purchase.
 */
async function sendLicenseEmail(email, name, licenseKey, tier) {
  const transporter = getTransporter();
  const tierName = TIER_NAMES[tier] || tier;

  if (!transporter) {
    console.log('--- LICENSE KEY (SMTP not configured) ---');
    console.log(`To: ${email} (${name})`);
    console.log(`Tier: ${tierName}`);
    console.log(`Key: ${licenseKey}`);
    console.log('-----------------------------------------');
    return;
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="background: #0a0e17; border-radius: 12px; padding: 32px; color: #e5e7eb;">
        <h1 style="color: #00ff6a; margin: 0 0 8px; font-size: 24px;">Welcome to Citadel ${tierName}</h1>
        <p style="color: #9ca3af; margin: 0 0 24px; font-size: 14px;">Thank you for subscribing, ${name || 'there'}!</p>

        <h3 style="color: #e5e7eb; margin: 0 0 12px; font-size: 16px;">Your License Key</h3>
        <div style="background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <div style="color: #9ca3af; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Citadel ${tierName} Subscription Key</div>
          <div style="font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 11px; word-break: break-all; color: #00ff6a; line-height: 1.5;">${licenseKey}</div>
        </div>

        <h3 style="color: #e5e7eb; margin: 0 0 12px; font-size: 16px;">Quick Start</h3>
        <ol style="color: #9ca3af; font-size: 14px; line-height: 1.8; padding-left: 20px; margin: 0 0 16px;">
          <li>Download and install Citadel from citadel.gg/download</li>
          <li>Complete the setup wizard</li>
          <li>Go to <strong style="color: #e5e7eb;">License</strong> in the sidebar</li>
          <li>Paste the license key above and click <strong style="color: #e5e7eb;">Activate</strong></li>
        </ol>

        <hr style="border: none; border-top: 1px solid #1f2937; margin: 24px 0;">
        <p style="color: #6b7280; font-size: 12px; margin: 0;">
          Your license key will auto-renew with your subscription. Manage your subscription at any time from the License page in your Citadel dashboard.<br>
          Questions? Reply to this email or visit <a href="https://citadel.gg/docs" style="color: #00ff6a;">citadel.gg/docs</a>.
        </p>
      </div>
    </div>
  `;

  const text = [
    `Welcome to Citadel ${tierName}`,
    '',
    `Thank you for subscribing, ${name || 'there'}!`,
    '',
    'Your License Key:',
    licenseKey,
    '',
    'Quick Start:',
    '1. Download and install Citadel from citadel.gg/download',
    '2. Complete the setup wizard',
    '3. Go to License in the sidebar',
    '4. Paste the key and click Activate',
    '',
    'Your license key will auto-renew with your subscription.',
    'Docs: https://citadel.gg/docs',
  ].join('\n');

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: `Welcome to Citadel ${tierName} — Your License Key`,
    html,
    text,
  });

  console.log(`License key emailed to ${email} (tier: ${tier})`);
}

/**
 * Send subscription lifecycle emails (renewal, update, cancellation).
 */
async function sendSubscriptionEmail(email, licenseKey, tier, action) {
  const transporter = getTransporter();
  const tierName = tier ? (TIER_NAMES[tier] || tier) : '';

  if (!transporter) {
    console.log(`--- SUBSCRIPTION ${action.toUpperCase()} (SMTP not configured) ---`);
    console.log(`To: ${email} | Tier: ${tierName} | Key: ${licenseKey ? 'yes' : 'none'}`);
    console.log('--------------------------------------------------');
    return;
  }

  let subject, bodyHtml, bodyText;

  if (action === 'renewed') {
    subject = `Citadel ${tierName} — Subscription Renewed`;
    bodyHtml = `
      <h1 style="color: #00ff6a; margin: 0 0 8px; font-size: 24px;">Subscription Renewed</h1>
      <p style="color: #9ca3af; margin: 0 0 24px; font-size: 14px;">Your Citadel ${tierName} subscription has been renewed.</p>
      <h3 style="color: #e5e7eb; margin: 0 0 12px; font-size: 16px;">Updated License Key</h3>
      <div style="background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <div style="font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 11px; word-break: break-all; color: #00ff6a; line-height: 1.5;">${licenseKey}</div>
      </div>
      <p style="color: #9ca3af; font-size: 14px;">Your Citadel instance will auto-refresh within 24 hours, or you can paste this key manually in the License page.</p>
    `;
    bodyText = `Subscription Renewed\n\nYour Citadel ${tierName} subscription has been renewed.\n\nUpdated License Key:\n${licenseKey}\n\nYour instance will auto-refresh within 24 hours.`;
  } else if (action === 'updated') {
    subject = `Citadel — Plan Changed to ${tierName}`;
    bodyHtml = `
      <h1 style="color: #00ff6a; margin: 0 0 8px; font-size: 24px;">Plan Updated</h1>
      <p style="color: #9ca3af; margin: 0 0 24px; font-size: 14px;">Your subscription has been changed to Citadel ${tierName}.</p>
      <h3 style="color: #e5e7eb; margin: 0 0 12px; font-size: 16px;">Updated License Key</h3>
      <div style="background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <div style="font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 11px; word-break: break-all; color: #00ff6a; line-height: 1.5;">${licenseKey}</div>
      </div>
      <p style="color: #9ca3af; font-size: 14px;">Paste this key in your License page to update your tier immediately.</p>
    `;
    bodyText = `Plan Updated\n\nYour subscription has been changed to Citadel ${tierName}.\n\nUpdated License Key:\n${licenseKey}\n\nPaste this key in your License page to update immediately.`;
  } else if (action === 'canceled') {
    subject = 'Citadel — Subscription Canceled';
    bodyHtml = `
      <h1 style="color: #f87171; margin: 0 0 8px; font-size: 24px;">Subscription Canceled</h1>
      <p style="color: #9ca3af; margin: 0 0 24px; font-size: 14px;">Your Citadel subscription has been canceled.</p>
      <p style="color: #9ca3af; font-size: 14px;">Your current license will remain active until its expiry date. After that, your instance will revert to the Free tier (1 server, limited features).</p>
      <p style="color: #9ca3af; font-size: 14px;">You can resubscribe at any time from the License page in your Citadel dashboard or at <a href="https://citadel.gg/purchase" style="color: #00ff6a;">citadel.gg/purchase</a>.</p>
    `;
    bodyText = 'Subscription Canceled\n\nYour Citadel subscription has been canceled.\n\nYour current license will remain active until its expiry date. After that, your instance will revert to the Free tier.\n\nResubscribe at: https://citadel.gg/purchase';
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="background: #0a0e17; border-radius: 12px; padding: 32px; color: #e5e7eb;">
        ${bodyHtml}
        <hr style="border: none; border-top: 1px solid #1f2937; margin: 24px 0;">
        <p style="color: #6b7280; font-size: 12px; margin: 0;">
          Questions? Reply to this email or visit <a href="https://citadel.gg/docs" style="color: #00ff6a;">citadel.gg/docs</a>.
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject,
    html,
    text: bodyText,
  });

  console.log(`Subscription ${action} email sent to ${email}`);
}

module.exports = { sendLicenseEmail, sendSubscriptionEmail };
