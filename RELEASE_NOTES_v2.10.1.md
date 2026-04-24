## Citadel v2.10.1 — Hotfix: license activation URL

### Fixed
- **Activation failed with HTTP 404** — the desktop client was pointing at `https://citadels.cc/api/v1/license/activate`, but the Fastify API lives on the `api.` subdomain (`https://api.citadels.cc`). Calls to the marketing site's Next.js hit a 404 and activation never landed. Fixed the default URL so fresh installs work out of the box.
- Same root cause as the Paddle webhook bug fixed in the cloud repo — `citadels.cc` (marketing) and `api.citadels.cc` (API) are separate services and `/api/v1/*` routes only exist on the latter.

### For customers already on v2.10.0
If you can't upgrade immediately, add `CITADEL_LICENSE_API=https://api.citadels.cc` to your `.env` in the Citadel install directory and restart the Citadel service.

See the full changelog at https://citadels.cc/docs/changelog
