/**
 * License key email delivery via SMTP.
 *
 * Configure via environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 */
const nodemailer = require('nodemailer');

const EMAIL_FROM = process.env.EMAIL_FROM || 'Citadel Licenses <licenses@citadel.gg>';

/**
 * Send the license key to the customer.
 * Falls back to console.log if SMTP is not configured.
 */
async function sendLicenseEmail(email, name, licenseKey) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.log('─── LICENSE KEY (SMTP not configured) ───');
    console.log(`To: ${email} (${name})`);
    console.log(`Key: ${licenseKey}`);
    console.log('──────────────────────────────────────────');
    return;
  }

  const port = parseInt(process.env.SMTP_PORT || '587');
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="background: #0a0e17; border-radius: 12px; padding: 32px; color: #e5e7eb;">
        <h1 style="color: #00ff6a; margin: 0 0 8px; font-size: 24px;">Your Citadel License</h1>
        <p style="color: #9ca3af; margin: 0 0 24px; font-size: 14px;">Thank you for your purchase, ${name || 'there'}!</p>

        <div style="background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <div style="color: #9ca3af; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">License Key</div>
          <div style="font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 11px; word-break: break-all; color: #00ff6a; line-height: 1.5;">${licenseKey}</div>
        </div>

        <h3 style="color: #e5e7eb; margin: 0 0 12px; font-size: 16px;">How to Activate</h3>
        <ol style="color: #9ca3af; font-size: 14px; line-height: 1.8; padding-left: 20px; margin: 0 0 24px;">
          <li>Open your Citadel dashboard</li>
          <li>Go to <strong style="color: #e5e7eb;">Settings &rarr; License</strong></li>
          <li>Paste the license key above and click <strong style="color: #e5e7eb;">Activate</strong></li>
        </ol>

        <p style="color: #9ca3af; font-size: 14px; margin: 0 0 8px;">
          Alternatively, add it to your <code style="background: #111827; padding: 2px 6px; border-radius: 4px; font-size: 12px;">.env</code> file:
        </p>
        <div style="background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: #00ff6a; margin-bottom: 24px;">
          CITADEL_LICENSE_KEY=${licenseKey}
        </div>

        <hr style="border: none; border-top: 1px solid #1f2937; margin: 24px 0;">
        <p style="color: #6b7280; font-size: 12px; margin: 0;">
          This is a permanent license for all Citadel features. Keep this email safe.<br>
          Questions? Reply to this email or visit our documentation.
        </p>
      </div>
    </div>
  `;

  const text = [
    `Your Citadel License Key`,
    ``,
    `Thank you for your purchase, ${name || 'there'}!`,
    ``,
    `License Key:`,
    licenseKey,
    ``,
    `How to Activate:`,
    `1. Open your Citadel dashboard`,
    `2. Go to Settings → License`,
    `3. Paste the key and click Activate`,
    ``,
    `Or add to your .env file:`,
    `CITADEL_LICENSE_KEY=${licenseKey}`,
    ``,
    `This is a permanent license for all features. Keep this email safe.`,
  ].join('\n');

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: 'Your Citadel License Key',
    html,
    text,
  });

  console.log(`License key emailed to ${email}`);
}

module.exports = { sendLicenseEmail };
