#!/usr/bin/env node
/**
 * Citadel License Key Generator
 *
 * Generates RSA-signed license keys for customers.
 * KEEP THIS TOOL AND THE PRIVATE KEY SECRET — never ship with the product.
 *
 * Usage:
 *   node generate-license.js --tier professional --licensee "John Doe" --email john@example.com --servers 10 --days 365
 *   node generate-license.js --tier enterprise --licensee "ACME Corp" --email admin@acme.com --permanent
 *   node generate-license.js --tier standard --licensee "Small Community" --email user@gmail.com --days 30
 *
 * Options:
 *   --tier       community | standard | professional | enterprise (required)
 *   --licensee   Customer name (required)
 *   --email      Customer email (required)
 *   --servers    Max servers override (optional, defaults to tier limit)
 *   --days       License validity in days (default: 365)
 *   --permanent  No expiry
 */
const fs = require('fs');
const path = require('path');

// Use jsonwebtoken from the backend's node_modules
const jwt = require(path.join(__dirname, '..', 'backend', 'node_modules', 'jsonwebtoken'));

// ─── Parse CLI Arguments ─────────────────────────────────────────
function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (key === 'permanent') {
        args[key] = true;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args[key] = argv[++i];
      }
    }
  }
  return args;
}

const TIER_DEFAULTS = {
  community: { maxServers: 1 },
  standard: { maxServers: 3 },
  professional: { maxServers: 10 },
  enterprise: { maxServers: 999 },
};

// ─── Main ────────────────────────────────────────────────────────
function main() {
  const args = parseArgs();

  // Validate required args
  if (!args.tier || !TIER_DEFAULTS[args.tier]) {
    console.error('Error: --tier is required (community | standard | professional | enterprise)');
    process.exit(1);
  }
  if (!args.licensee) {
    console.error('Error: --licensee is required (customer name)');
    process.exit(1);
  }
  if (!args.email) {
    console.error('Error: --email is required (customer email)');
    process.exit(1);
  }

  // Load private key
  const keyPath = path.join(__dirname, 'license-private.pem');
  if (!fs.existsSync(keyPath)) {
    console.error('Error: Private key not found at', keyPath);
    console.error('Generate a new keypair and update both this tool and backend/lib/license.js');
    process.exit(1);
  }
  const privateKey = fs.readFileSync(keyPath, 'utf8');

  // Build payload
  const payload = {
    tier: args.tier,
    licensee: args.licensee,
    email: args.email,
    maxServers: parseInt(args.servers) || TIER_DEFAULTS[args.tier].maxServers,
  };

  // Sign options
  const signOpts = {
    algorithm: 'RS256',
    issuer: 'citadel-license',
  };

  if (!args.permanent) {
    const days = parseInt(args.days) || 365;
    signOpts.expiresIn = `${days}d`;
  }

  // Generate the key
  const licenseKey = jwt.sign(payload, privateKey, signOpts);

  // Output
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              CITADEL LICENSE KEY GENERATED               ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Tier:        ${payload.tier.padEnd(42)}║`);
  console.log(`║  Licensee:    ${payload.licensee.padEnd(42)}║`);
  console.log(`║  Email:       ${payload.email.padEnd(42)}║`);
  console.log(`║  Max Servers: ${String(payload.maxServers).padEnd(42)}║`);
  console.log(`║  Expires:     ${(args.permanent ? 'Never' : `${parseInt(args.days) || 365} days`).padEnd(42)}║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Add to customer\'s .env file:                           ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`\nCITADEL_LICENSE_KEY=${licenseKey}\n`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Verify it works
  const decoded = jwt.decode(licenseKey);
  console.log('\nDecoded payload:', JSON.stringify(decoded, null, 2));
}

main();
