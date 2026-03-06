#!/bin/bash

# Production build script for GuildServer

set -e

echo "Building GuildServer for production..."

# Clean previous builds
echo "Cleaning previous builds..."
pnpm run clean

# Install production dependencies
echo "Installing dependencies..."
pnpm install --frozen-lockfile

# Build all packages
echo "Building packages..."
pnpm run build

# Build Docker images
echo "Building Docker images..."
docker compose build

echo "Build complete!"
echo ""
echo "To deploy:"
echo "  docker compose up -d"
