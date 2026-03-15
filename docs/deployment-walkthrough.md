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

### Step 2: Create Stripe Products/Prices ✅
Created via Stripe CLI (live mode):

| Plan | Product ID | Monthly Price ID | Yearly Price ID |
|------|-----------|-----------------|----------------|
| Basic ($4.99/mo) | prod_U9PBwzO5Ca9bjj | price_1TB6MtA4kXoqX4AwNJ36YuV1 | price_1TB6N6A4kXoqX4AwQvz6sKlj |
| Pro ($9.99/mo) | prod_U9PBmevCUBcKuI | price_1TB6NUA4kXoqX4AwiWReoWvc | price_1TB6NYA4kXoqX4AwvoqUzJge |
| Community ($24.99/mo) | prod_U9PBZ6rsNcqSui | price_1TB6NbA4kXoqX4Aw63EaW5px | price_1TB6NgA4kXoqX4AwMohepvUu |

Env vars for `.env.production`:
```
STRIPE_PRICE_BASIC=price_1TB6MtA4kXoqX4AwNJ36YuV1
STRIPE_PRICE_PRO=price_1TB6NUA4kXoqX4AwiWReoWvc
STRIPE_PRICE_COMMUNITY=price_1TB6NbA4kXoqX4Aw63EaW5px
STRIPE_PRICE_BASIC_YEARLY=price_1TB6N6A4kXoqX4AwQvz6sKlj
STRIPE_PRICE_PRO_YEARLY=price_1TB6NYA4kXoqX4AwvoqUzJge
STRIPE_PRICE_COMMUNITY_YEARLY=price_1TB6NgA4kXoqX4AwMohepvUu
```

### Step 3: Run DB Migration ✅
```bash
docker exec -i docker-postgres-1 psql -U citadel -d citadel < packages/api/src/db/migrations/0005_license_key.sql
```
Adds `license_key` and `license_key_generated_at` columns to `teams` table.

### Step 4: Set API_KEY_SALT ✅
Generated via `openssl rand -hex 32` and added to `.env.production`.

### Step 5: Deploy via docker-compose ✅
```bash
cd /opt/citadel-cloud && docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

### Step 6: Configure Stripe Webhook ✅
Created via Stripe CLI:
- Endpoint: `https://citadels.cc/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Signing secret added as `STRIPE_WEBHOOK_SECRET` in `.env.production`

## Notes
- SSH access via Termius (not local terminal)
- Copy-paste commands needed for VPS operations

## Recent Changes (Pre-deployment)
- Vercel license server removed — `tools/license-server/` deleted
- License flow simplified — users subscribe on Cloud, paste key into local app
- Steam OpenID hardened — `check_authentication` POST-back added
- UpdateBanner component built for server overview page
- Env var docs updated in `.env.example` and `.env.production.example`
