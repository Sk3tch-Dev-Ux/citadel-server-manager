# VIP Store

Monetize your DayZ server with automated VIP priority queue purchases powered by Stripe.

## Overview

The VIP Store lets players purchase priority queue access directly from a public store page. When a player completes a purchase, the system automatically:

1. Provisions a priority queue entry with the correct role and expiration
2. Syncs the entry to `priority.txt` for all connected servers
3. Records the transaction in purchase history
4. Fires a webhook notification (Discord, HTTP, etc.)

No manual intervention required — everything is automated.

## How It Works

```
Player visits /store
  → Selects a VIP tier
  → Enters their Steam64 ID
  → Clicks "Purchase"
  → Redirected to Stripe Checkout (hosted by Stripe)
  → Completes payment with card
  → Stripe sends webhook to your server
  → Citadel verifies payment & auto-provisions priority queue
  → Player can skip the queue immediately
```

**Key points:**
- No credit card data ever touches your server — Stripe Checkout is fully hosted by Stripe
- Webhook signature verification ensures payment authenticity
- Players can use any payment method Stripe supports (cards, Apple Pay, Google Pay, etc.)

## Prerequisites

Before setting up the store, you need:

1. **A Stripe account** — Sign up at [stripe.com](https://stripe.com) (free to create, Stripe takes a small fee per transaction)
2. **A public URL** — Your Citadel panel must be accessible from the internet. See the [Remote Access Guide](/guide/remote-access) for setup instructions.
3. **Priority Queue configured** — The store builds on the Priority Queue system. Ensure it's working first.

## Setup

### Step 1 — Get Your Stripe API Keys

1. Log in to [Stripe Dashboard](https://dashboard.stripe.com)
2. Go to **Developers → API Keys**
3. Copy your **Secret Key** (`sk_test_...` for testing, `sk_live_...` for production)

::: tip Test Mode
Start with **test mode** keys to verify everything works. Toggle "Test mode" in the Stripe Dashboard. Test mode transactions use fake cards and no real money is charged.
:::

### Step 2 — Configure Stripe in Citadel

1. Go to **VIP Store** in the Citadel sidebar
2. Open the **Stripe Configuration** panel
3. Paste your **Stripe Secret Key**
4. Set your **Store Name** (shown to players on the checkout page)
5. Set your **Default Currency** (USD, EUR, GBP, etc.)
6. **Don't enable the store yet** — set up the webhook first

### Step 3 — Create the Stripe Webhook

Stripe needs to notify Citadel when a payment completes. This requires a webhook endpoint.

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Set the **Endpoint URL** to:
   ```
   https://yourdomain.com/api/store/webhook
   ```
   Replace `yourdomain.com` with your actual public domain.
4. Under **Listen to** → **Events on your account**
5. Click **Select events** and check:
   - `checkout.session.completed`
6. Click **Add endpoint**
7. On the endpoint details page, click **Reveal** under **Signing secret**
8. Copy the `whsec_...` value
9. Back in Citadel, paste it as the **Webhook Secret**
10. Click **Save Config**

### Step 4 — Create Products

1. In the **VIP Store** page, click **Add Product**
2. Fill in the product details:
   - **Product Name** — e.g., "VIP - 30 Days"
   - **Description** — e.g., "Skip the queue for 30 days"
   - **Role** — VIP, Supporter, or Premium (this maps to the priority queue role)
   - **Price** — Minimum $0.50 (Stripe requirement)
   - **Currency** — Defaults to the store's default currency
   - **Duration** — 30 Days, 90 Days, 1 Year, Permanent, or Custom

3. Create as many tiers as you want. Players will see all active products on the store page.

::: tip Pricing Strategy
Common DayZ server VIP pricing:
- **VIP 30 Days** — $5-10
- **VIP 90 Days** — $12-20
- **VIP Lifetime** — $25-50
- **Premium Lifetime** — $50-100
:::

### Step 5 — Enable the Store

1. Check the **Enable Store** checkbox in Stripe Configuration
2. Click **Save Config**
3. The status badge should change to **Live**
4. Click **Copy Store Link** or **Preview** to verify the public store page

### Step 6 — Share With Players

Share the store URL with your players:
- `https://yourdomain.com/store`

You can embed this in:
- Your Discord server (use the Discord bot's announcement feature)
- Your server's MOTD/loading screen
- Your community website

## Testing

### Test Mode (Recommended First)

1. Use your **test mode** Stripe keys (`sk_test_...`)
2. Create a test product
3. Visit `/store`, enter any valid Steam64 ID
4. Use Stripe's test card: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., `12/34`)
   - CVC: Any 3 digits (e.g., `123`)
5. Complete the checkout
6. Verify:
   - The purchase appears in the **Purchases** tab
   - A priority queue entry was created in **Priority Queue**
   - A notification appeared in the Notification Center
   - Your webhook was fired (check Discord or your webhook endpoint)

### Local Testing (Without Public URL)

If you haven't set up remote access yet, use the **Stripe CLI** to forward webhooks locally:

```powershell
# Install
winget install Stripe.StripeCLI

# Login
stripe login

# Forward webhooks
stripe listen --forward-to localhost:3001/api/store/webhook --events checkout.session.completed
```

Use the `whsec_...` from the CLI output as your Webhook Secret.

### Going Live

When ready for real transactions:

1. Switch to **live mode** in Stripe Dashboard
2. Update your Stripe Secret Key to the live key (`sk_live_...`)
3. Create a new webhook endpoint with your production URL
4. Update the Webhook Secret to the live signing secret
5. Save and verify with a small real purchase

## Managing the Store

### Products

- **Toggle Active/Inactive** — Temporarily hide products without deleting them
- **Edit** — Change name, price, duration, etc. (doesn't affect existing purchases)
- **Delete** — Permanently remove a product (existing purchases are unaffected)

### Purchases

The **Purchases** tab shows a read-only history of all completed transactions:
- Player name and Steam64 ID
- Product purchased
- Amount paid
- Transaction date and status

### Priority Queue Integration

Each purchase automatically creates a priority queue entry:
- **Role** matches the product's role (VIP, Supporter, Premium)
- **Expiration** is calculated from the product's duration
- **Source** is marked as `purchase` to distinguish from manually-added entries
- Entries appear in the Priority Queue page and are synced to `priority.txt`

Expired entries are automatically cleaned up by the priority queue's expiration system (runs every 60 seconds).

## Stripe Fees

Stripe charges per successful transaction (no monthly fees):
- **US**: 2.9% + $0.30
- **EU**: 1.5% + €0.25
- **UK**: 1.5% + £0.20

For example, a $5.00 VIP purchase costs you ~$0.45 in Stripe fees, netting $4.55.

See [stripe.com/pricing](https://stripe.com/pricing) for current rates in your country.

## Troubleshooting

### Store shows "Store Not Available"

The store is either disabled or Stripe isn't configured:
1. Check **VIP Store → Stripe Configuration** — is the Secret Key saved?
2. Is **Enable Store** checked?
3. Save the config and try again

### Purchase completes but no priority queue entry

The webhook isn't reaching Citadel:
1. Check [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) for delivery failures
2. Verify the endpoint URL matches your public domain
3. Verify the webhook secret in Citadel matches Stripe
4. Check the Citadel backend logs for errors

### "Stripe SDK is not installed"

Run in the backend directory:
```powershell
cd backend
npm install stripe
```

### Player's Steam64 ID rejected

Steam64 IDs must be exactly 17 digits starting with `7656119`. Players can find theirs at [steamid.io](https://steamid.io).
