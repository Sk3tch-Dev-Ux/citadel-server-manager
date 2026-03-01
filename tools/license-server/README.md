# Citadel License Server (Vercel)

Stripe-powered serverless license fulfillment for Citadel. Deployed on Vercel's free tier.

**This runs on YOUR infrastructure. It is NOT shipped to customers.**

## Architecture

```
Customer's Citadel Instance         Vercel (your license server)         Stripe
┌─────────────────────┐       ┌───────────────────────────┐       ┌──────────┐
│  License Page        │       │  /api/create-checkout     │       │          │
│  [Purchase — $19.99] ├──────►│  (or Stripe Payment Link) ├──────►│ Checkout │
│                      │       │                           │       │          │
│                      │       │  /api/webhook             │◄──────┤ Webhook  │
│  [Paste Key]         │       │    ├─ generate RSA key    │       │          │
│  [Activate]          │       │    └─ email to buyer      │       └──────────┘
└─────────────────────┘       └───────────────────────────┘
```

## Quick Start

### 1. Encode your private key

The RSA private key can't live on Vercel's filesystem, so it's stored as a base64-encoded environment variable:

```bash
cat tools/license-private.pem | base64 | tr -d '\n'
```

Copy that output — you'll paste it into Vercel as `LICENSE_PRIVATE_KEY_B64`.

### 2. Create Stripe product

- Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products)
- Create: **Citadel License** — One-time — **$19.99**
- Copy the Price ID (`price_...`)

### 3. Set up Stripe webhook

- Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
- Add endpoint: `https://your-app.vercel.app/api/webhook`
- Select event: `checkout.session.completed`
- Copy the Webhook Signing Secret (`whsec_...`)

### 4. Deploy to Vercel

```bash
cd tools/license-server
npm install
npx vercel
```

When prompted, set the project root to `tools/license-server`.

### 5. Add environment variables

In the [Vercel Dashboard → Settings → Environment Variables](https://vercel.com/dashboard), add:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `STRIPE_PRICE_ID` | `price_...` (only if using `/api/create-checkout`) |
| `LICENSE_PRIVATE_KEY_B64` | Base64-encoded RSA private key (from step 1) |
| `SMTP_HOST` | SMTP server (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password or app password |
| `EMAIL_FROM` | `Citadel Licenses <licenses@citadel.gg>` |
| `SUCCESS_URL` | `https://your-app.vercel.app/success` |
| `CANCEL_URL` | `https://citadel.gg/purchase` |

### 6. Point customer instances to the purchase URL

In each customer's Citadel `.env`:

```env
PURCHASE_URL=https://buy.stripe.com/your-payment-link
```

Or if using `/api/create-checkout`, point to your Vercel app URL.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/webhook` | Stripe webhook → key generation → email delivery |
| `POST` | `/api/create-checkout` | Create Stripe Checkout Session (optional) |
| `GET` | `/api/health` | Health check |
| `GET` | `/success` | Post-purchase "check your email" page |

## Two Purchase Flow Options

### Option A: Stripe Payment Link (recommended)

1. Create a [Payment Link](https://dashboard.stripe.com/payment-links) in the Stripe Dashboard
2. Set "After payment" redirect to `https://your-app.vercel.app/success`
3. Set `PURCHASE_URL` in customer instances to the Payment Link URL
4. The `/api/webhook` endpoint handles key generation + email automatically

Zero code required — configured entirely in the Stripe Dashboard.

### Option B: API-created Checkout Sessions

1. Frontend calls `POST /api/create-checkout` with optional `{ "email": "..." }`
2. Server creates a Checkout Session and returns `{ "url": "https://checkout.stripe.com/..." }`
3. Customer pays → webhook fires → key generated + emailed

## Local Development

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login

# Forward webhooks to local dev server
stripe listen --forward-to localhost:3000/api/webhook

# In another terminal
cd tools/license-server
npx vercel dev

# Trigger a test payment
stripe trigger checkout.session.completed
```

## Sales Logging

All sales are logged to Vercel's runtime logs (visible in the [Vercel Dashboard → Deployments → Logs](https://vercel.com/dashboard)). Each sale appears as:

```json
{"timestamp":"2026-03-01T12:00:00.000Z","sessionId":"cs_live_...","email":"buyer@example.com","name":"John","amount":1999,"currency":"usd"}
```
