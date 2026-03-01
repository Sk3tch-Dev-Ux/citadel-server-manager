# Backend Setup

Complete guide for deploying the Citadel backend API.

## Installation

```bash
cd backend
npm install
```

## Configuration

The backend reads configuration from a `.env` file in the project root. Run the setup wizard to generate it:

```bash
npm run setup
```

Or create `.env` manually — see [Environment Variables](/guide/environment-variables) for the full reference.

### Minimum Configuration

```ini
# Security
JWT_SECRET=your-secure-random-string

# Server
PORT=3000
NODE_ENV=production

# Admin credentials (set during first setup)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
```

## Running

### Development

```bash
npm run dev
```

This starts the server with file watching via the root `concurrently` script, running both backend and frontend.

### Production

```bash
# Direct
node backend/server.js

# With PM2 (recommended)
pm2 start backend/server.js --name citadel
pm2 save
pm2 startup
```

### Using the Deploy Script

Citadel includes deploy scripts for automated deployment:

::: code-group
```bash [Linux/macOS]
cd backend
chmod +x deploy.sh
./deploy.sh
```

```powershell [Windows]
cd backend
.\deploy.ps1
```
:::

The deploy script will:
1. Pull the latest code from Git
2. Install dependencies
3. Build the frontend
4. Restart the PM2 process

## Reverse Proxy

For production, place Citadel behind a reverse proxy like Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name citadel.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/citadel.pem;
    ssl_certificate_key /etc/ssl/private/citadel.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

::: tip WebSocket Support
The `Upgrade` and `Connection` headers are required for Socket.IO real-time communication. Don't forget them!
:::

## Health Check

Verify the backend is running:

```bash
curl http://localhost:3000/api/health
# → { "status": "ok", "version": "2.0.0" }
```
