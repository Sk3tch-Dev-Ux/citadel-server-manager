# Frontend Setup

The Citadel web dashboard is a React + Vite single-page application.

## Development

```bash
cd web/frontend
npm install
npm run dev
```

The dev server starts at `http://localhost:5173` with hot module replacement.

::: info API Proxy
The Vite dev server is configured to proxy `/api` requests to `http://localhost:3001` (the backend). See `vite.config.js` for proxy settings.
:::

## Production Build

```bash
cd web/frontend
npm run build
```

This generates optimized static assets in `web/frontend/dist/`. The backend serves these files automatically in production mode.

## Customization

### Theme

The dashboard uses CSS custom properties for theming. To modify colors, edit the CSS variables in your component styles. The primary brand colors are:

- **Primary:** `#6366F1` (Indigo)
- **Accent:** `#0EA5E9` (Sky Blue)

### Logo

Replace the SVG files in `web/frontend/public/`:
- `citadel-logo.svg` — Main logo (sidebar, login, loading screens)
- `favicon.svg` — Browser tab icon
