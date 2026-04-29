## Citadel v2.8.1 — Hotfix: Files editor bundled locally

### Fixed
- **Files browser editor still wasn't loading** on some machines even after the v2.5.1 CSP fix. The real cause: the editor was loading from cdnjs.cloudflare.com over the internet, and many home/corporate firewalls, ad-blockers, and DNS filters block that domain.
- **Monaco editor is now bundled locally** via the `monaco-editor` npm package. Citadel is a local-first tool — the code editor should not depend on a reachable CDN. This permanently fixes the "Code editor failed to load" error.
- Files bundle grew ~3.7 MB, but it's lazy-loaded (only downloaded when you open the Files page), so initial app load stays fast.
- Side effects: cleaner CSP, no more `'unsafe-eval'` exception, editor works fully offline.

See the full changelog at https://citadels.cc/docs/changelog
