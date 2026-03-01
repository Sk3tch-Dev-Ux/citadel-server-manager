#!/bin/bash
# Deployment script for Citadel

set -e

# Stop running server
pm2 stop citadel || true

# Pull latest code
git pull

# Install dependencies
npm install

# Build frontend (if applicable)
cd ../web && npm install && npm run build || true
cd ../backend

# Start server with PM2
pm2 start server.js --name citadel --watch

# Show status
pm2 status citadel
