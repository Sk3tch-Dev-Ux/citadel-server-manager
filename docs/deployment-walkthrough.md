# Deployment Walkthrough — Citadel Cloud + DayzServerController

In-progress walkthrough for going live with both systems.

## Completed Steps

### Step 1: RSA Keypair ✅
Private key already exists at `tools/license-private.pem` (gitignored).

Base64-encode it for the Cloud env var:
```bash
cat tools/license-private.pem | base64 -w0
```
Set output as `LICENSE_PRIVATE_KEY_B64` in Cloud `.env.production`.

Verify public key matches:
```bash
openssl rsa -in tools/license-private.pem -pubout
```
Compare against `LICENSE_PUBLIC_KEY` constant in `backend/lib/license.js`.

## Remaining Steps

### Step 2: Create Stripe Products/Prices
- Create 3 products in Stripe Dashboard: Basic ($4.99/mo), Pro ($9.99/mo), Community ($24.99/mo)
- For each product, create 2 prices: monthly + yearly (yearly at ~20% discount)
- Copy 6 `price_...` IDs into `.env.production`:
  ```
  STRIPE_PRICE_BASIC=price_...
  STRIPE_PRICE_PRO=price_...
  STRIPE_PRICE_COMMUNITY=price_...
  STRIPE_PRICE_BASIC_YEARLY=price_...
  STRIPE_PRICE_PRO_YEARLY=price_...
  STRIPE_PRICE_COMMUNITY_YEARLY=price_...
  ```

### Step 3: Run DB Migration
- Run `0005_license_key.sql` (verify exact migration file in `citadel-cloud/packages/db/migrations/`)

### Step 4: Set API_KEY_SALT
```bash
openssl rand -hex 32
```
Set output as `API_KEY_SALT` in `.env.production`.

### Step 5: Deploy via docker-compose
```bash
docker-compose up -d
```

### Step 6: Configure Stripe Webhook
Point Stripe webhook endpoint to `https://cloud.citadelforge.com/api/stripe/webhook`

## Notes
- SSH access via Termius (not local terminal)
- Copy-paste commands needed for VPS operations

## Recent Changes (Pre-deployment)
- Vercel license server removed — `tools/license-server/` deleted
- License flow simplified — users subscribe on Cloud, paste key into local app
- Steam OpenID hardened — `check_authentication` POST-back added
- UpdateBanner component built for server overview page
- Env var docs updated in `.env.example` and `.env.production.example`
