## Citadel v2.7.0 — Admin Team

Closes the gap between what our marketing said shipped and what you actually saw.
All three pillars of the "Admin Power Tools" set now have first-class UI.

### Watchlist (new dedicated page)
- Global list of flagged players with tags, notes, reason, hit tracking
- Real-time alerts when a watched player joins any server — in-app notification + webhook
- Match by SteamID (preferred) or name fallback
- Search, tag filters, bulk delete

### Audit Log (promoted from buried tab to dedicated page)
- Filter by user, action type, date range, and free text — all combinable
- One-click CSV export respecting current filters
- Color-coded action severity for at-a-glance reading
- Accessible at `/audit` (admin/owner only)

### Notifications (enhanced)
- High-severity notifications (warning, error) now pop a toast on arrival — no more missing watchlist hits or crashes because the bell was collapsed
- New `/notifications` page for full history with severity/server/type/search filters
- "View all →" link from the bell panel to the history page
- Per-notification delete in addition to "Clear all"

### Under the hood
- New REST surfaces for filters and facets (audit actions/users, notification severities/types/servers)
- Watchlist bumps hitCount + lastSeenAt on every match, persisted to disk
- Every watchlist add/update/remove now writes an audit log entry

See the full changelog at https://citadels.cc/docs/changelog
