/**
 * License key email delivery via SMTP.
 *
 * Configure via environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 */
const nodemailer = require('nodemailer');

const EMAIL_FROM = process.env.EMAIL_FROM || 'Citadel Licenses <licenses@citadel.gg>';
const REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'Sk3tch-Dev-Ux';
const REPO_NAME = process.env.GITHUB_REPO_NAME || 'DayzServerController';

/**
 * Send the license key + repo access instructions to the customer.
 * Falls back to console.log if SMTP is not configured.
 *
 * @param {string} email
 * @param {string} name
 * @param {string} licenseKey
 * @param {string} githubUsername - GitHub username (may be empty)
 * @param {boolean} githubInvited - Whether the GitHub invite was sent successfully
 */
async function sendLicenseEmail(email, name, licenseKey, githubUsername = '', githubInvited = false) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const repoUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
  const cloneUrl = `${repoUrl}.git`;
  const inviteUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/invitations`;

  if (!host || !user || !pass) {
    console.log('─── LICENSE KEY (SMTP not configured) ───');
    console.log(`To: ${email} (${name})`);
    console.log(`Key: ${licenseKey}`);
    console.log(`GitHub: ${githubUsername || 'N/A'} (invited: ${githubInvited})`);
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

  // Build GitHub section (HTML)
  const githubHtml = githubInvited
    ? `
        <h3 style="color: #e5e7eb; margin: 0 0 12px; font-size: 16px;">📦 Repository Access</h3>
        <p style="color: #9ca3af; font-size: 14px; margin: 0 0 12px;">
          A GitHub invitation has been sent to <strong style="color: #e5e7eb;">@${githubUsername}</strong>. Accept it to get access to the private Citadel repository.
        </p>
        <ol style="color: #9ca3af; font-size: 14px; line-height: 1.8; padding-left: 20px; margin: 0 0 16px;">
          <li>Check your GitHub notifications or <a href="${inviteUrl}" style="color: #00ff6a;">click here to accept</a></li>
          <li>Clone the repository:</li>
        </ol>
        <div style="background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: #00ff6a; margin-bottom: 24px;">
          git clone ${cloneUrl}
        </div>
      `
    : githubUsername
      ? `
        <div style="background: #1c1917; border: 1px solid #78350f; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="color: #fbbf24; font-size: 14px; margin: 0;">
            ⚠️ We couldn't invite <strong>@${githubUsername}</strong> to the repository automatically.
            Please contact support with your purchase receipt and GitHub username.
          </p>
        </div>
      `
      : '';

  // Build GitHub section (plain text)
  const githubText = githubInvited
    ? [
        '',
        'Repository Access:',
        `A GitHub invitation has been sent to @${githubUsername}.`,
        `Accept it here: ${inviteUrl}`,
        '',
        'Then clone the repository:',
        `  git clone ${cloneUrl}`,
        '',
      ].join('\n')
    : githubUsername
      ? [
          '',
          `Note: We couldn't invite @${githubUsername} to the repository automatically.`,
          'Please contact support with your purchase receipt and GitHub username.',
          '',
        ].join('\n')
      : '';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="background: #0a0e17; border-radius: 12px; padding: 32px; color: #e5e7eb;">
        <h1 style="color: #00ff6a; margin: 0 0 8px; font-size: 24px;">Welcome to Citadel</h1>
        <p style="color: #9ca3af; margin: 0 0 24px; font-size: 14px;">Thank you for your purchase, ${name || 'there'}!</p>

        ${githubHtml}

        <h3 style="color: #e5e7eb; margin: 0 0 12px; font-size: 16px;">🔑 License Key</h3>
        <div style="background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <div style="color: #9ca3af; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Your Permanent License Key</div>
          <div style="font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 11px; word-break: break-all; color: #00ff6a; line-height: 1.5;">${licenseKey}</div>
        </div>

        <h3 style="color: #e5e7eb; margin: 0 0 12px; font-size: 16px;">⚡ Quick Start</h3>
        <ol style="color: #9ca3af; font-size: 14px; line-height: 1.8; padding-left: 20px; margin: 0 0 16px;">
          <li>Clone the repository (see above)</li>
          <li>Follow the setup guide in the README</li>
          <li>Open your Citadel dashboard &rarr; <strong style="color: #e5e7eb;">Settings &rarr; License</strong></li>
          <li>Paste the license key above and click <strong style="color: #e5e7eb;">Activate</strong></li>
        </ol>

        <p style="color: #9ca3af; font-size: 14px; margin: 0 0 8px;">
          Or add it to your <code style="background: #111827; padding: 2px 6px; border-radius: 4px; font-size: 12px;">.env</code> file:
        </p>
        <div style="background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: #00ff6a; margin-bottom: 24px;">
          CITADEL_LICENSE_KEY=${licenseKey}
        </div>

        <hr style="border: none; border-top: 1px solid #1f2937; margin: 24px 0;">
        <p style="color: #6b7280; font-size: 12px; margin: 0;">
          This is a permanent license for all Citadel features. Keep this email safe.<br>
          Questions? Reply to this email or visit our <a href="https://sk3tch-dev-ux.github.io/DayzServerController/" style="color: #00ff6a;">documentation</a>.
        </p>
      </div>
    </div>
  `;

  const text = [
    `Welcome to Citadel`,
    ``,
    `Thank you for your purchase, ${name || 'there'}!`,
    githubText,
    `License Key:`,
    licenseKey,
    ``,
    `Quick Start:`,
    `1. Clone the repository`,
    `2. Follow the setup guide in the README`,
    `3. Open your Citadel dashboard → Settings → License`,
    `4. Paste the key and click Activate`,
    ``,
    `Or add to your .env file:`,
    `CITADEL_LICENSE_KEY=${licenseKey}`,
    ``,
    `This is a permanent license for all features. Keep this email safe.`,
    `Docs: https://sk3tch-dev-ux.github.io/DayzServerController/`,
  ].join('\n');

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: 'Welcome to Citadel — License Key & Repository Access',
    html,
    text,
  });

  console.log(`License key emailed to ${email}`);
}

module.exports = { sendLicenseEmail };
