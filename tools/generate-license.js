#!/usr/bin/env node
/**
 * Citadel License Key Generator
 *
 * Generates RSA-signed license keys for customers ($19.99 one-time purchase).
 * KEEP THIS TOOL AND THE PRIVATE KEY SECRET — never ship with the product.
 *
 * Usage:
 *   node generate-license.js --licensee "John Doe" --email john@example.com
 *   node generate-license.js --licensee "John Doe" --email john@example.com --days 365
 *   node generate-license.js --licensee "ACME Corp" --email admin@acme.com --permanent
 *
 * Options:
 *   --licensee   Customer name (required)
 *   --email      Customer email (required)
 *   --days       License validity in days (default: permanent)
 *   --permanent  No expiry (default behavior)
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

// ─── Main ────────────────────────────────────────────────────────
function main() {
  const args = parseArgs();

  // Validate required args
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
    product: 'citadel',
    licensee: args.licensee,
    email: args.email,
  };

  // Sign options
  const signOpts = {
    algorithm: 'RS256',
    issuer: 'citadel-license',
  };

  if (args.days && !args.permanent) {
    const days = parseInt(args.days) || 365;
    signOpts.expiresIn = `${days}d`;
  }
  // Default: permanent (no expiresIn)

  // Generate the key
  const licenseKey = jwt.sign(payload, privateKey, signOpts);

  // Output
  const expires = args.days && !args.permanent ? `${parseInt(args.days) || 365} days` : 'Never';

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              CITADEL LICENSE KEY GENERATED               ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Product:     Citadel (Full Access)                      ║`);
  console.log(`║  Licensee:    ${args.licensee.padEnd(42)}║`);
  console.log(`║  Email:       ${args.email.padEnd(42)}║`);
  console.log(`║  Expires:     ${expires.padEnd(42)}║`);
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
