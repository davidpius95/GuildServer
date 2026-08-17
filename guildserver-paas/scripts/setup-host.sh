#!/bin/bash
# =============================================================================
# GuildServer — Host / VM Setup Script
# =============================================================================
# Prepares a fresh Ubuntu server (VM, bare metal, or VPS) to run the
# GuildServer PaaS platform. This is the MAIN server that runs:
#   - Traefik (reverse proxy / SSL)
#   - PostgreSQL (database)
#   - Redis (cache / job queue)
#   - GuildServer API (Express + tRPC)
#   - GuildServer Web (Next.js)
#   - GuildServer Docs (Docusaurus)
#
# Tested on: Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, Debian 12
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<user>/GuildServer/main/guildserver-paas/scripts/setup-host.sh | sudo bash
#   # OR
#   sudo bash scripts/setup-host.sh
#
# Environment variables (set before running):
#   GS_DOMAIN          — Your domain (default: guildserver.localhost)
#   GS_ACME_EMAIL      — Email for Let's Encrypt (default: admin@$GS_DOMAIN)
#   GS_INSTALL_DIR     — Where to clone the repo (default: /opt/guildserver)
#   GS_DB_PASSWORD      — PostgreSQL password (default: auto-generated)
#   GS_JWT_SECRET       — JWT signing secret (default: auto-generated)
#   GS_NEXTAUTH_SECRET  — NextAuth secret (default: auto-generated)
#   GS_REPO_URL         — Git repo URL (default: https://github.com/davidpius95/GuildServer.git)
#   GS_BRANCH           — Git branch to deploy (default: main)
#   GS_SWAP_SIZE        — Swap file size in GB (default: 4, set 0 to skip)
#   GS_SKIP_FIREWALL    — Set to 1 to skip firewall setup
#   GS_SKIP_CLONE       — Set to 1 to skip repo cloning (if already present)
# =============================================================================

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# Configurable defaults
# ---------------------------------------------------------------------------
GS_DOMAIN="${GS_DOMAIN:-guildserver.localhost}"
GS_ACME_EMAIL="${GS_ACME_EMAIL:-admin@${GS_DOMAIN}}"
GS_INSTALL_DIR="${GS_INSTALL_DIR:-/opt/guildserver}"
GS_DB_PASSWORD="${GS_DB_PASSWORD:-$(openssl rand -hex 16)}"
GS_JWT_SECRET="${GS_JWT_SECRET:-$(openssl rand -hex 32)}"
GS_NEXTAUTH_SECRET="${GS_NEXTAUTH_SECRET:-$(openssl rand -hex 32)}"
GS_REPO_URL="${GS_REPO_URL:-https://github.com/davidpius95/GuildServer.git}"
GS_BRANCH="${GS_BRANCH:-main}"
GS_SWAP_SIZE="${GS_SWAP_SIZE:-4}"
GS_SKIP_FIREWALL="${GS_SKIP_FIREWALL:-0}"
GS_SKIP_CLONE="${GS_SKIP_CLONE:-0}"

NODE_MAJOR=20

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo -e "\n\033[1;34m[GuildServer Setup]\033[0m $*"; }
ok()   { echo -e "  \033[1;32m✅ $*\033[0m"; }
warn() { echo -e "  \033[1;33m⚠️  $*\033[0m" >&2; }
die()  { echo -e "\n\033[1;31m❌ FATAL: $*\033[0m" >&2; exit 1; }

check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        die "This script must be run as root (use sudo)"
    fi
}

# =============================================================================
# Step 0: Pre-flight checks
# =============================================================================
check_root

log "Starting GuildServer host setup..."
log "  Domain:      ${GS_DOMAIN}"
log "  Install dir: ${GS_INSTALL_DIR}"
log "  Branch:      ${GS_BRANCH}"
log "  Node.js:     v${NODE_MAJOR}.x"

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    log "  OS:          ${PRETTY_NAME:-$ID $VERSION_ID}"
else
    warn "Cannot detect OS — proceeding anyway"
fi

# =============================================================================
# Step 1: System update & essential packages
# =============================================================================
log "Updating system and installing essential packages..."

apt-get update -qq
apt-get upgrade -y -qq 2>&1 | tail -3

apt-get install -y -qq \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    wget \
    git \
    jq \
    htop \
    iotop \
    net-tools \
    iputils-ping \
    dnsutils \
    unzip \
    zip \
    tar \
    build-essential \
    logrotate \
    cron \
    openssh-server \
    sudo \
    fail2ban \
    ufw \
    openssl \
    software-properties-common \
    2>&1 | tail -1

ok "System packages installed"

# =============================================================================
# Step 2: Swap (for low-memory servers)
# =============================================================================
if [ "${GS_SWAP_SIZE}" -gt 0 ] 2>/dev/null; then
    if [ ! -f /swapfile ]; then
        log "Creating ${GS_SWAP_SIZE}GB swap file..."
        fallocate -l "${GS_SWAP_SIZE}G" /swapfile
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        echo "/swapfile none swap sw 0 0" >> /etc/fstab
        # Reduce swappiness for server workloads
        echo "vm.swappiness=10" >> /etc/sysctl.conf
        sysctl -p 2>/dev/null || true
        ok "Swap configured (${GS_SWAP_SIZE}GB)"
    else
        ok "Swap already exists"
    fi
fi

# =============================================================================
# Step 3: Node.js (via NodeSource)
# =============================================================================
log "Installing Node.js v${NODE_MAJOR}..."

if command -v node >/dev/null 2>&1; then
    CURRENT_NODE=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
    if [ "${CURRENT_NODE}" -ge "${NODE_MAJOR}" ] 2>/dev/null; then
        ok "Node.js already installed ($(node --version))"
    else
        warn "Node.js $(node --version) found but v${NODE_MAJOR}+ required — upgrading"
    fi
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node --version | sed 's/v//' | cut -d. -f1)" -lt "${NODE_MAJOR}" ] 2>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
    apt-get install -y -qq nodejs 2>&1 | tail -1
    ok "Node.js installed ($(node --version))"
fi

# =============================================================================
# Step 4: pnpm
# =============================================================================
log "Installing pnpm..."

if command -v pnpm >/dev/null 2>&1; then
    ok "pnpm already installed ($(pnpm --version))"
else
    npm install -g pnpm@latest 2>&1 | tail -1
    ok "pnpm installed ($(pnpm --version))"
fi

# =============================================================================
# Step 5: Docker
# =============================================================================
log "Installing Docker..."

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ok "Docker already installed ($(docker --version | awk '{print $3}' | tr -d ','))"
else
    # Add Docker official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Add Docker repo
    CODENAME=$(lsb_release -cs 2>/dev/null || echo "jammy")
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>&1 | tail -1

    ok "Docker installed ($(docker --version | awk '{print $3}' | tr -d ','))"
fi

# Configure Docker daemon for production
log "Configuring Docker daemon..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DAEMON'
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "100m",
        "max-file": "5"
    },
    "storage-driver": "overlay2",
    "live-restore": true,
    "userland-proxy": false,
    "default-ulimits": {
        "nofile": {
            "Name": "nofile",
            "Hard": 65536,
            "Soft": 65536
        }
    },
    "metrics-addr": "127.0.0.1:9323"
}
DAEMON

systemctl enable docker
systemctl restart docker
ok "Docker daemon configured"

# Create the shared network for deployed apps + Traefik
if ! docker network inspect guildserver >/dev/null 2>&1; then
    docker network create guildserver
    ok "Docker network 'guildserver' created"
else
    ok "Docker network 'guildserver' already exists"
fi

# =============================================================================
# Step 6: Firewall (UFW)
# =============================================================================
if [ "${GS_SKIP_FIREWALL}" != "1" ]; then
    log "Configuring firewall..."

    ufw --force reset >/dev/null 2>&1
    ufw default deny incoming
    ufw default allow outgoing

    # SSH
    ufw allow 22/tcp comment "SSH"
    # HTTP & HTTPS (Traefik)
    ufw allow 80/tcp comment "HTTP"
    ufw allow 443/tcp comment "HTTPS"
    # Traefik dashboard (restrict to localhost in production)
    ufw allow from 127.0.0.1 to any port 8080 proto tcp comment "Traefik Dashboard"

    # Enable without prompt
    echo "y" | ufw enable
    ok "Firewall configured (SSH, HTTP, HTTPS allowed)"
else
    warn "Firewall setup skipped (GS_SKIP_FIREWALL=1)"
fi

# =============================================================================
# Step 7: Fail2Ban (SSH brute-force protection)
# =============================================================================
log "Configuring Fail2Ban..."

cat > /etc/fail2ban/jail.local <<'JAIL'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port    = ssh
logpath = /var/log/auth.log
maxretry = 3
JAIL

systemctl enable fail2ban
systemctl restart fail2ban
ok "Fail2Ban configured (SSH protection)"

# =============================================================================
# Step 8: System tuning
# =============================================================================
log "Applying system tuning..."

cat > /etc/sysctl.d/99-guildserver.conf <<'SYSCTL'
# GuildServer production tuning
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_fin_timeout = 15
net.core.netdev_max_backlog = 65535
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
vm.overcommit_memory = 1
SYSCTL
sysctl --system 2>/dev/null | tail -1

# File descriptor limits
cat > /etc/security/limits.d/99-guildserver.conf <<'LIMITS'
*    soft    nofile    65536
*    hard    nofile    65536
root soft    nofile    65536
root hard    nofile    65536
LIMITS

ok "System tuning applied"

# =============================================================================
# Step 9: Log rotation
# =============================================================================
log "Setting up log rotation..."

cat > /etc/logrotate.d/guildserver <<'LOGROTATE'
/var/log/guildserver*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    maxsize 100M
}

/var/lib/docker/containers/*/*.log {
    rotate 7
    daily
    compress
    missingok
    notifempty
    delaycompress
    copytruncate
    maxsize 200M
}
LOGROTATE

ok "Log rotation configured"

# =============================================================================
# Step 10: Clone GuildServer repo
# =============================================================================
if [ "${GS_SKIP_CLONE}" != "1" ]; then
    log "Cloning GuildServer repository..."

    if [ -d "${GS_INSTALL_DIR}/.git" ]; then
        log "  Repo already exists — pulling latest..."
        cd "${GS_INSTALL_DIR}"
        git fetch origin "${GS_BRANCH}"
        git checkout "${GS_BRANCH}"
        git reset --hard "origin/${GS_BRANCH}"
    else
        mkdir -p "$(dirname "${GS_INSTALL_DIR}")"
        git clone --branch "${GS_BRANCH}" --depth 1 "${GS_REPO_URL}" "${GS_INSTALL_DIR}"
    fi
    ok "Repository ready at ${GS_INSTALL_DIR}"
else
    warn "Repo cloning skipped (GS_SKIP_CLONE=1)"
fi

# =============================================================================
# Step 11: Create production .env file
# =============================================================================
log "Creating production environment file..."

COMPOSE_DIR="${GS_INSTALL_DIR}/guildserver-paas"
ENV_FILE="${COMPOSE_DIR}/.env"

if [ -f "${ENV_FILE}" ]; then
    warn "  .env already exists — creating backup at .env.bak"
    cp "${ENV_FILE}" "${ENV_FILE}.bak"
fi

cat > "${ENV_FILE}" <<ENVFILE
# =============================================================================
# GuildServer Production Environment
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# =============================================================================

# Domain & SSL
GS_DOMAIN=${GS_DOMAIN}
ACME_EMAIL=${GS_ACME_EMAIL}
BASE_DOMAIN=${GS_DOMAIN}

# Database
POSTGRES_PASSWORD=${GS_DB_PASSWORD}

# Secrets
JWT_SECRET=${GS_JWT_SECRET}
NEXTAUTH_SECRET=${GS_NEXTAUTH_SECRET}

# URLs
FRONTEND_URL=https://${GS_DOMAIN}
API_URL=https://${GS_DOMAIN}
NEXTAUTH_URL=https://${GS_DOMAIN}

# OAuth (fill in your credentials)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=https://${GS_DOMAIN}/auth/github/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Stripe (optional)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Git branch for auto-updates
GS_BRANCH=${GS_BRANCH}
ENVFILE

chmod 600 "${ENV_FILE}"
ok "Environment file created at ${ENV_FILE}"

# =============================================================================
# Step 12: Install dependencies & build
# =============================================================================
if [ -d "${COMPOSE_DIR}" ]; then
    log "Installing project dependencies..."
    cd "${COMPOSE_DIR}"

    pnpm install --frozen-lockfile 2>&1 | tail -3
    ok "Dependencies installed"

    log "Building Docker images (this may take a few minutes)..."
    docker compose -f docker-compose.prod.yml build 2>&1 | tail -5
    ok "Docker images built"
fi

# =============================================================================
# Step 13: Auto-update cron job
# =============================================================================
log "Setting up auto-update cron job..."

CRON_SCRIPT="${COMPOSE_DIR}/scripts/self-update.sh"
if [ -f "${CRON_SCRIPT}" ]; then
    chmod +x "${CRON_SCRIPT}"
    # Run every 5 minutes, log output
    CRON_LINE="*/5 * * * * ${CRON_SCRIPT} >> /var/log/guildserver-update.log 2>&1"
    (crontab -l 2>/dev/null | grep -v "self-update.sh"; echo "${CRON_LINE}") | crontab -
    ok "Auto-update cron job installed (every 5 min)"
else
    warn "self-update.sh not found — skipping cron setup"
fi

# =============================================================================
# Step 14: Systemd service for GuildServer
# =============================================================================
log "Creating systemd service..."

cat > /etc/systemd/system/guildserver.service <<SERVICE
[Unit]
Description=GuildServer PaaS Platform
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${COMPOSE_DIR}
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down
ExecReload=/usr/bin/docker compose -f docker-compose.prod.yml restart
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable guildserver
ok "Systemd service created (guildserver.service)"

# =============================================================================
# Step 15: Start services
# =============================================================================
log "Starting GuildServer services..."

cd "${COMPOSE_DIR}"
docker compose -f docker-compose.prod.yml up -d 2>&1 | tail -5

# Wait for services to be healthy
log "Waiting for services to become healthy..."
sleep 15

# =============================================================================
# Step 16: Run database migrations
# =============================================================================
log "Running database migrations..."

docker exec guildserver-api sh -c 'cd /app && node -e "require(\"child_process\").execSync(\"npx tsx packages/database/src/migrate.ts\", {stdio: \"inherit\", env: {...process.env}})"' 2>/dev/null || {
    warn "Auto-migration failed — you may need to run migrations manually"
}

# =============================================================================
# Final verification
# =============================================================================
log "Running verification checks..."

CHECKS_PASSED=0
CHECKS_TOTAL=8

check() {
    if eval "$2" >/dev/null 2>&1; then
        ok "$1"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
    else
        warn "$1 — FAILED"
    fi
}

check "Node.js $(node --version 2>/dev/null)"   "command -v node"
check "pnpm $(pnpm --version 2>/dev/null)"       "command -v pnpm"
check "Docker $(docker --version 2>/dev/null | awk '{print \$3}' | tr -d ',')"  "docker info"
check "Docker Compose"                            "docker compose version"
check "Git $(git --version 2>/dev/null | awk '{print \$3}')"  "command -v git"
check "Docker network 'guildserver'"              "docker network inspect guildserver"
check "UFW firewall active"                       "ufw status | grep -q 'Status: active'"
check "Fail2Ban running"                          "systemctl is-active fail2ban"

echo ""
log "Verification: ${CHECKS_PASSED}/${CHECKS_TOTAL} checks passed"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================================================="
echo " GuildServer Setup Complete!"
echo "============================================================================="
echo ""
echo " Domain:         ${GS_DOMAIN}"
echo " Install dir:    ${GS_INSTALL_DIR}"
echo " Compose dir:    ${COMPOSE_DIR}"
echo " Environment:    ${ENV_FILE}"
echo ""
echo " Services:"
echo "   Frontend:     https://${GS_DOMAIN}"
echo "   API:          https://${GS_DOMAIN}/trpc"
echo "   Docs:         https://${GS_DOMAIN}/docs"
echo "   Traefik:      http://localhost:8080 (dashboard)"
echo ""
echo " Credentials (saved in ${ENV_FILE}):"
echo "   DB Password:  ${GS_DB_PASSWORD}"
echo "   JWT Secret:   ${GS_JWT_SECRET:0:12}..."
echo ""
echo " Management commands:"
echo "   systemctl start guildserver    # Start all services"
echo "   systemctl stop guildserver     # Stop all services"
echo "   systemctl restart guildserver  # Restart all services"
echo "   systemctl status guildserver   # Check status"
echo ""
echo " Logs:"
echo "   docker compose -f ${COMPOSE_DIR}/docker-compose.prod.yml logs -f"
echo "   tail -f /var/log/guildserver-update.log"
echo ""
echo " Next steps:"
echo "   1. Point your DNS A record for ${GS_DOMAIN} to this server's IP"
echo "   2. Edit ${ENV_FILE} to add OAuth & Stripe keys"
echo "   3. Restart: systemctl restart guildserver"
echo "============================================================================="
