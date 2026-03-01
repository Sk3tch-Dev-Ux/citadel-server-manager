# Getting Started

Get Citadel running in under 10 minutes.

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/your-org/Citadel.git
cd Citadel
```

### 2. Install dependencies

```bash
# Root installs (also installs backend + frontend via postinstall)
npm install

# Sidecar (runs on the DayZ server machine)
cd sidecar && npm install && cd ..

# Discord bot (optional)
cd discord-bot && npm install && cd ..
```

### 3. Run the setup wizard

```bash
npm run setup
```

This launches an interactive wizard that:
- Creates your `.env` configuration file
- Sets up the initial admin user
- Configures your first DayZ server profile
- Generates JWT secrets

### 4. Start in development mode

```bash
npm run dev
```

This runs both the backend API and frontend dev server concurrently:
- **Backend API:** `http://localhost:3000`
- **Frontend Dev:** `http://localhost:5173`

### 5. Open the dashboard

Navigate to `http://localhost:5173` and log in with the admin credentials you set during setup.

## Production Deployment

For production, build the frontend and run the backend directly:

```bash
npm run build
npm start
```

Or use PM2 for process management:

```bash
pm2 start backend/server.js --name citadel
pm2 start discord-bot/bot.js --name citadel-bot
```

See the [Backend Setup](/guide/backend-setup) and [DayZ Mod Setup](/guide/dayz-mod-setup) guides for complete deployment instructions.

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
│       ├── components/# Reusable UI components
│       └── contexts/  # React contexts (auth, theme, etc.)
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
