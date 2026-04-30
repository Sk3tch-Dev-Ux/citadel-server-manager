/**
 * Post the Citadel showcase embed sequence to a Discord webhook.
 *
 * Usage:
 *   WEBHOOK_URL=https://discord.com/api/webhooks/.../... node post.js
 *
 *   Or pass it as an arg:
 *     node post.js https://discord.com/api/webhooks/.../...
 *
 *   Or set up a permanent .env in this folder:
 *     echo 'WEBHOOK_URL=https://discord.com/api/webhooks/.../...' > .env
 *     node post.js
 *
 * Discord caps a single message at 10 embeds. We only send 5, so this
 * goes through as one message — the entire showcase appears as one
 * cohesive post in your channel.
 *
 * If you'd prefer them as separate sequential messages (e.g. for
 * scrollable storytelling), pass --split.
 */
const fs = require('fs');
const path = require('path');

const PAYLOAD_FILE = path.join(__dirname, 'embeds.json');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) process.env[m[1]] = process.env[m[1]] || m[2];
  }
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord ${res.status}: ${text || res.statusText}`);
  }
}

async function main() {
  loadEnv();
  const url = process.argv.find((a) => a.startsWith('https://discord.com/api/webhooks/'))
    || process.env.WEBHOOK_URL;
  const split = process.argv.includes('--split');

  if (!url) {
    console.error('No webhook URL provided.\n\nUsage:');
    console.error('  WEBHOOK_URL=https://... node post.js');
    console.error('  node post.js https://...');
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(PAYLOAD_FILE, 'utf-8'));

  if (!split) {
    await post(url, payload);
    console.log(`✓ Sent ${payload.embeds.length} embeds in 1 message`);
    return;
  }

  // Split mode — each embed becomes its own message. Keep avatar/username.
  for (let i = 0; i < payload.embeds.length; i++) {
    await post(url, {
      username: payload.username,
      avatar_url: payload.avatar_url,
      embeds: [payload.embeds[i]],
    });
    console.log(`✓ Sent embed ${i + 1}/${payload.embeds.length}`);
    // Discord rate limits webhooks at ~5 req/2s — be polite.
    if (i < payload.embeds.length - 1) await new Promise((r) => setTimeout(r, 600));
  }
}

main().catch((err) => {
  console.error('✗ Failed:', err.message);
  process.exit(1);
});
