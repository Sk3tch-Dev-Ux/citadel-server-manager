# Deployment script for DayZ Server Controller (Windows)

# Stop running server
try { Stop-Process -Name node -Force } catch {}

# Pull latest code
git pull

# Install dependencies
npm install

# Build frontend (if applicable)
if (Test-Path ../web/package.json) {
    cd ../web
    npm install
    npm run build
    cd ../backend
}

# Start server
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js"
