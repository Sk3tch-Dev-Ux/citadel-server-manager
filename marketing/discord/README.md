# Discord Marketing Embeds

Five-embed showcase sequence — feature post for `#announcements` or a pinned
welcome message. Brand-purple (`#7c3aed`), professional but community-warm,
with both a website CTA and a Discord-invite CTA.

## Files

- `embeds.json` — the full Discord webhook payload (5 embeds)
- `post.js` — small Node script to POST it to a webhook
- `.env.example` — copy to `.env` and fill in `WEBHOOK_URL`

## Quick send

Get a webhook URL from your Discord server:
**Server Settings → Integrations → Webhooks → New Webhook**

Then either:

```bash
# One-off — paste the URL directly
node post.js https://discord.com/api/webhooks/<id>/<token>
```

Or set it up persistently:

```bash
echo 'WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>' > .env
node post.js
```

You'll see:

```
✓ Sent 5 embeds in 1 message
```

## Single message vs. split

By default all 5 embeds post as **one message** (Discord allows up to 10
embeds per message). They render top-to-bottom as a clean cohesive post.

If you'd rather have each embed as its own message — better for
scrollable storytelling, easier to react to individually — pass `--split`:

```bash
node post.js --split
```

## Don't have Node handy?

Paste `embeds.json` into [discohook.org](https://discohook.org/) — it has a
WYSIWYG preview, lets you tweak fields, and posts to your webhook from the
browser. Same JSON format.

## Replacing the placeholder URLs

Two URLs in `embeds.json` you should swap before sending:

- `https://citadels.cc/citadel-logo.png` — your brand logo (used for
  webhook avatar, author icon, and embed thumbnail)
- `https://citadels.cc/og-banner.png` — a wide marketing banner image
  shown at the bottom of the final embed (1200×630 OG-image style works
  well — same image as your Open Graph tag if you have one)
- `https://discord.gg/citadel` — your Discord invite. Replace with your
  actual permanent invite, or set up `https://citadels.cc/discord` as a
  redirect to a never-expiring invite (recommended — survives
  re-invitation).

If you don't have those images yet, just remove the `thumbnail` and
`image` blocks from the relevant embeds — the text content stands on
its own.

## Re-using for future versions

The 5th embed has a "What's New" field that calls out the latest
release. Update that string before each major-version push and re-post.
Keep the rest unchanged — it's evergreen.
