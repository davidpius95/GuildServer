#!/bin/bash

# Production build script for GuildServer

set -e

echo "🏗️ Building GuildServer for production..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
npm run clean

# Install production dependencies
echo "📦 Installing production dependencies..."
npm ci --production=false

# Build all packages
echo "🔨 Building packages..."
npm run build

# Build Docker images
echo "🐳 Building Docker images..."
docker-compose build

echo "✅ Build complete!"
echo ""
echo "To deploy:"
echo "  docker-compose up -d"