# This folder is deprecated

The Citadel Discord bot was extracted into its own repository in May 2026
as part of the Citadel Agent / Citadel Cloud product split.

- **New repo:** [citadel-bot](https://github.com/Sk3tch-Dev-Ux/citadel-bot)
  *(local: `~/Documents/GitHub/citadel-bot/`)*
- **Why:** The bot's uptime shouldn't depend on the customer's home PC.
  Citadel Cloud will host the bot going forward; self-hosters can also
  run the standalone repo separately from the Agent.

## What's still here

These files are kept in this folder **for one release only** so existing
self-hosters who upgrade the Agent don't immediately break. Citadel Agent
no longer launches the bot by default — set `CITADEL_AGENT_SPAWN_BOT=1`
in `.env` to restore the legacy in-Agent spawn behavior.

## What lives where now

| Concern | Location |
|---|---|
| Bot code (slash commands, button panels, handlers) | `citadel-bot` repo |
| Bot's HTTP client (calls `/api/discord/*`) | `citadel-bot` repo |
| API surface the bot calls into | This repo: [backend/routes/discord.routes.js](../backend/routes/discord.routes.js) |
| Discord-user-to-role mapping | This repo: [backend/routes/discord-user-roles.routes.js](../backend/routes/discord-user-roles.routes.js) |
| Bot auth (`DISCORD_BOT_API_KEY`) | Both — Agent issues the key, bot includes it on every call |

## When will this folder be removed?

After the next Citadel Agent release ships and customers have had a chance
to migrate. Track it via the project board / `ROADMAP.md`.
