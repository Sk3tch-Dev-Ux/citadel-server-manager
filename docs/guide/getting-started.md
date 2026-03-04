# Getting Started

Get Citadel running in under 10 minutes.

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/Sk3tch-Dev-Ux/DayzServerController.git
cd DayzServerController
```

### 2. Install dependencies

```bash
# Root install (also installs backend + frontend via postinstall)
npm install

# Sidecar (runs on the DayZ server machine)
cd sidecar && npm install && cd ..

# Discord bot (optional)
cd discord-bot && npm install && cd ..
```

### 3. Start Citadel

```bash
# From an Administrator terminal (recommended):
npm start
```

This will:
1. Run the setup wizard (first time only — generates `.env` with secure secrets)
2. Build the frontend for production
3. Start the backend server on port 3001

::: tip Administrator Recommended
Run from an Administrator terminal for automatic Windows Firewall rule management. See [Running as Administrator](/guide/backend-setup#running-as-administrator) for details.
:::

### 4. Complete the setup wizard

On first launch, open **http://localhost:3001** — you'll be redirected to the setup wizard:

1. **Welcome** — Introduction and overview
2. **Admin Account** — Create your admin username and password
3. **SteamCMD** — Configure SteamCMD path for mod and server management
4. **Server Profile** — Add your first DayZ server (install directory, ports, RCON)
5. **Complete** — Ready to use

After completing the wizard, log in with the credentials you created.

### 5. Add your DayZ server

If you didn't configure a server during setup, you can:
- **Add existing server** — Go to the Server Hub and add your DayZ installation
- **Deploy new server** — Use the Deploy page to install a new DayZ server via SteamCMD

## Development Mode

```bash
npm run dev
```

This runs both the backend API and frontend dev server concurrently with hot-reload:
- **Backend API:** `http://localhost:3001`
- **Frontend Dev:** `http://localhost:5173`

## Production Deployment

For production, install Citadel as a Windows Service:

```bash
# From an Administrator terminal:
npm run service:install
npm run service:start
```

The service starts automatically on boot and runs with full admin privileges.

Alternatively, use PM2:

```bash
pm2 start backend/server.js --name citadel
pm2 start discord-bot/bot.js --name citadel-bot
```

See the [Backend Setup](/guide/backend-setup) guide for complete deployment instructions including reverse proxy configuration.

## Project Structure

```
Citadel/
├── backend/           # Express API, RCON, scheduling, business logic
│   ├── lib/           # Core libraries (config, providers, engines)
│   ├── routes/        # API route handlers
│   └── middleware/     # Auth, rate limiting, security
├── web/frontend/      # React + Vite dashboard
│   └── src/
│       ├── pages/     # Dashboard views
│       ├── components/# Reusable UI components (Radix UI)
│       └── contexts/  # React contexts (auth, socket, toast)
├── sidecar/           # Sidecar server (runs on DayZ machine)
├── dayz-mod/          # @CitadelAdmin EnScript mod
├── discord-bot/       # Discord bot with button controls
├── data/              # JSON data store (generated at runtime)
└── docs/              # This documentation site
```

## Next Steps

- [Architecture Overview](/guide/architecture) — Understand how the components fit together
- [Prerequisites](/guide/prerequisites) — System requirements and dependencies
- [Environment Variables](/guide/environment-variables) — Complete configuration reference
- [DayZ Mod Setup](/guide/dayz-mod-setup) — Install the @CitadelAdmin mod
