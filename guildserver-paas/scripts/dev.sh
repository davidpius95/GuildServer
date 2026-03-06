#!/bin/bash

# Development setup script for GuildServer

set -e

echo "🚀 Starting GuildServer development environment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Create environment files if they don't exist
if [ ! -f "apps/web/.env.local" ]; then
    echo "📝 Creating web environment file..."
    cp apps/web/.env.local.example apps/web/.env.local 2>/dev/null || true
fi

if [ ! -f "apps/api/.env" ]; then
    echo "📝 Creating API environment file..."
    cat > apps/api/.env << EOF
NODE_ENV=development
DATABASE_URL=postgresql://guildserver:password123@localhost:5432/guildserver
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-development-jwt-secret-key-here-please-change-in-production
PORT=4000
LOG_LEVEL=debug
EOF
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Start services
echo "🐳 Starting Docker services..."
docker compose up -d postgres redis

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 10

# Run database migrations
echo "🗄️ Running database migrations..."
pnpm --filter @guildserver/database db:migrate

# Start development servers
echo "🔥 Starting development servers..."
pnpm run dev

echo "✅ GuildServer is running!"
echo ""
echo "🌐 Frontend: http://localhost:3000"
echo "🔧 Backend API: http://localhost:4000"
echo "📊 Database: postgresql://guildserver:password123@localhost:5432/guildserver"
echo "📦 Redis: redis://localhost:6379"
echo ""
echo "To stop the services, run: docker compose down"