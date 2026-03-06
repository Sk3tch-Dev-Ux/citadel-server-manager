# Remote Access & Public Hosting

Expose your Citadel panel to the internet so you can manage your DayZ servers from anywhere — and let players access the VIP store.

## Why Remote Access?

By default, Citadel runs on `localhost:3001` and is only accessible from the machine it's installed on. To enable:

- **Remote management** — Access your panel from your phone, laptop, or anywhere
- **VIP Store** — Let players purchase priority queue access at `yourdomain.com/store`
- **Stripe Webhooks** — Stripe needs a public URL to send payment confirmations
- **Discord Bot Webhooks** — Receive server event notifications

## Option 1: Cloudflare Tunnel (Recommended)

Cloudflare Tunnel is the recommended approach. It's **free**, requires **no port forwarding**, provides **automatic HTTPS**, and is production-grade.

### How It Works

```
Player's Browser → Cloudflare Edge → Encrypted Tunnel → Your Server (localhost:3001)
```

Cloudflare runs a small agent (`cloudflared`) on your server that creates an outbound encrypted tunnel to Cloudflare's network. Traffic is proxied through this tunnel — your server's ports stay closed.

### Prerequisites

- A **domain name** (buy one through [Cloudflare Registrar](https://dash.cloudflare.com/?to=/:account/domains/register) for ~$10/year, or transfer an existing domain)
- A **free Cloudflare account** at [dash.cloudflare.com](https://dash.cloudflare.com)
- Your domain's DNS managed by Cloudflare (Cloudflare walks you through this when you add a domain)

### Step 1 — Install cloudflared

Open an **Administrator PowerShell** and run:

```powershell
winget install Cloudflare.cloudflared
```

Close and reopen your terminal so the `cloudflared` command is available.

Verify the install:

```powershell
cloudflared --version
```

### Step 2 — Authenticate with Cloudflare

```powershell
cloudflared tunnel login
```

This opens your browser. Select the domain you want to use and authorize the tunnel. A certificate is saved to `%USERPROFILE%\.cloudflared\cert.pem`.

### Step 3 — Create a Tunnel

```powershell
cloudflared tunnel create citadel
```

This creates a tunnel and outputs a **Tunnel ID** (a UUID). Note this for the next step.

A credentials file is saved to `%USERPROFILE%\.cloudflared\<TUNNEL-ID>.json`.

### Step 4 — Configure DNS

Route your subdomain to the tunnel:

```powershell
cloudflared tunnel route dns citadel panel.yourdomain.com
```

This creates a CNAME record in Cloudflare DNS pointing `panel.yourdomain.com` to your tunnel.

::: tip Multiple Subdomains
You can create multiple DNS routes for the same tunnel:
```powershell
cloudflared tunnel route dns citadel panel.yourdomain.com
cloudflared tunnel route dns citadel store.yourdomain.com
```
:::

### Step 5 — Create the Config File

Create the file `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: <YOUR-TUNNEL-ID>
credentials-file: C:\Users\<YourUsername>\.cloudflared\<YOUR-TUNNEL-ID>.json

ingress:
  - hostname: panel.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404
```

Replace `<YOUR-TUNNEL-ID>` and `<YourUsername>` with your actual values.

::: warning Important
The final `- service: http_status:404` catch-all rule is **required** by cloudflared.
:::

### Step 6 — Test the Tunnel

```powershell
cloudflared tunnel run citadel
```

Visit `https://panel.yourdomain.com` in your browser. You should see the Citadel login page.

### Step 7 — Install as a Windows Service

To keep the tunnel running permanently (survives reboots):

```powershell
# Run as Administrator
cloudflared service install
```

This installs `cloudflared` as a Windows service that starts automatically. The service reads from the config file created in Step 5.

To manage the service:

```powershell
# Check status
sc query cloudflared

# Stop
sc stop cloudflared

# Start
sc start cloudflared

# Remove (if needed)
cloudflared service uninstall
```

### Verifying It Works

After setup, you should be able to:

1. Visit `https://panel.yourdomain.com` from any device
2. Visit `https://panel.yourdomain.com/store` to see the VIP store
3. Log in and manage your servers remotely

## Option 2: Port Forwarding

If you prefer not to use Cloudflare Tunnel, you can forward port 3001 on your router. This is simpler but **less secure** and doesn't provide free HTTPS.

### Steps

1. **Find your server's local IP** (e.g., `192.168.1.100`):
   ```powershell
   ipconfig
   ```

2. **Forward port 3001** in your router's admin panel:
   - External port: `3001` (or `443` if using HTTPS)
   - Internal IP: Your server's local IP
   - Internal port: `3001`
   - Protocol: TCP

3. **Find your public IP** — visit [whatismyip.com](https://whatismyip.com)

4. **Access your panel** at `http://YOUR_PUBLIC_IP:3001`

::: warning Security Considerations
- Port forwarding exposes your server directly to the internet
- Use a **firewall** to restrict access if possible
- Consider setting up a **reverse proxy** (nginx/Caddy) with HTTPS
- Your public IP may change — use a **Dynamic DNS** service like [DuckDNS](https://www.duckdns.org/) (free)
:::

### Adding HTTPS with Caddy (Optional)

If port forwarding, you should add HTTPS. [Caddy](https://caddyserver.com/) handles this automatically:

1. Install Caddy: `winget install Caddy.Caddy`
2. Create `Caddyfile`:
   ```
   panel.yourdomain.com {
       reverse_proxy localhost:3001
   }
   ```
3. Run: `caddy run`

Caddy automatically obtains and renews Let's Encrypt certificates.

## Setting Up Stripe Webhooks

Once your panel is publicly accessible, configure Stripe to send payment notifications:

### For Cloudflare Tunnel / Production

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Set the endpoint URL to:
   ```
   https://panel.yourdomain.com/api/store/webhook
   ```
4. Under **Events to send**, select:
   - `checkout.session.completed`
5. Click **Add endpoint**
6. Copy the **Signing secret** (`whsec_...`)
7. Paste it into **Citadel → VIP Store → Stripe Configuration → Webhook Secret**
8. Save

### For Local Development (Stripe CLI)

If testing locally without a public URL:

1. Install the Stripe CLI:
   ```powershell
   winget install Stripe.StripeCLI
   ```

2. Login:
   ```powershell
   stripe login
   ```

3. Forward webhooks:
   ```powershell
   stripe listen --forward-to localhost:3001/api/store/webhook --events checkout.session.completed
   ```

4. Copy the `whsec_...` secret from the output
5. Paste it into the **Webhook Secret** field in Citadel
6. Keep the terminal running while testing

Use Stripe's test card `4242 4242 4242 4242` (any future expiry, any CVC) for test purchases.

## CORS Configuration

When accessing Citadel from a public domain, add the domain to your allowed origins:

1. Go to **Settings → System Configuration → Server**
2. Add your domain to **allowedOrigins**:
   ```
   https://panel.yourdomain.com
   ```

Or set it in your `.env`:
```env
CORS_ORIGINS=https://panel.yourdomain.com,http://localhost:3001
```

## Troubleshooting

### Tunnel not connecting

```powershell
# Check tunnel status
cloudflared tunnel info citadel

# Run with debug logging
cloudflared tunnel --loglevel debug run citadel
```

### "502 Bad Gateway" in browser

Citadel isn't running on port 3001. Start it:
```powershell
cd C:\path\to\DayzServerController
npm start
```

### Stripe webhooks failing

1. Check the webhook URL is correct: `https://yourdomain.com/api/store/webhook`
2. Check the signing secret matches what's in Citadel
3. View webhook delivery logs in [Stripe Dashboard → Webhooks → Select endpoint → Attempts](https://dashboard.stripe.com/webhooks)

### SSL certificate errors

If using Cloudflare Tunnel, SSL is handled automatically. If using port forwarding without a reverse proxy, you'll see browser warnings. Use Caddy or nginx for automatic HTTPS.
