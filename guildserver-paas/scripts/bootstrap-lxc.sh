#!/bin/bash
# =============================================================================
# GuildServer — LXC Container Bootstrap Script
# =============================================================================
# This script prepares a fresh Ubuntu LXC container for running deployed apps.
# It installs Docker, essential tools, configures networking, logging, and
# security. Run once per container after creation.
#
# Usage:
#   ssh root@<lxc-ip> 'bash -s' < bootstrap-lxc.sh
#   # OR called automatically by ProxmoxProvider.bootstrapDockerViaSSH()
#
# Exit codes:
#   0  — Success (prints BOOTSTRAP_OK at the end)
#   1  — Fatal error during setup
# =============================================================================

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# Configurable defaults (override with env vars before running)
# ---------------------------------------------------------------------------
DOCKER_TCP_PORT="${DOCKER_TCP_PORT:-2375}"
LOG_MAX_SIZE="${LOG_MAX_SIZE:-50m}"
LOG_MAX_FILES="${LOG_MAX_FILES:-3}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "[bootstrap] $*"; }
warn() { echo "[bootstrap] WARNING: $*" >&2; }
die()  { echo "[bootstrap] FATAL: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Fix DNS (DHCP inside LXC sometimes fails to set resolvers)
# ---------------------------------------------------------------------------
log "Configuring DNS resolution..."
if ! grep -q "nameserver" /etc/resolv.conf 2>/dev/null; then
    log "  No nameservers found — adding Google + Cloudflare DNS"
fi
# Always ensure reliable resolvers are present
grep -q "8.8.8.8" /etc/resolv.conf 2>/dev/null || echo "nameserver 8.8.8.8" >> /etc/resolv.conf
grep -q "1.1.1.1" /etc/resolv.conf 2>/dev/null || echo "nameserver 1.1.1.1" >> /etc/resolv.conf

# Verify DNS works
if ! getent hosts google.com >/dev/null 2>&1; then
    warn "DNS resolution still failing — retrying with direct resolv.conf overwrite"
    echo -e "nameserver 8.8.8.8\nnameserver 1.1.1.1" > /etc/resolv.conf
fi

# ---------------------------------------------------------------------------
# 2. System update & essential packages
# ---------------------------------------------------------------------------
log "Updating package lists..."
apt-get update -qq

log "Installing essential packages..."
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
    net-tools \
    iputils-ping \
    dnsutils \
    unzip \
    logrotate \
    cron \
    openssh-server \
    sudo \
    2>&1 | tail -1

# ---------------------------------------------------------------------------
# 3. Install Docker (official repo for latest stable)
# ---------------------------------------------------------------------------
log "Installing Docker..."

# Check if Docker is already installed and running
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    log "  Docker already installed and running — skipping install"
else
    # Try official Docker repo first, fall back to docker.io
    if curl -fsSL https://download.docker.com/linux/ubuntu/gpg 2>/dev/null | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg 2>/dev/null; then
        CODENAME=$(lsb_release -cs 2>/dev/null || echo "jammy")
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $CODENAME stable" \
            > /etc/apt/sources.list.d/docker.list
        apt-get update -qq
        apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>&1 | tail -1 || {
            warn "Official Docker install failed — falling back to docker.io"
            apt-get install -y -qq docker.io 2>&1 | tail -1
        }
    else
        log "  Cannot reach Docker repo — installing docker.io from Ubuntu repos"
        apt-get install -y -qq docker.io 2>&1 | tail -1
    fi
fi

# ---------------------------------------------------------------------------
# 4. Configure Docker daemon
# ---------------------------------------------------------------------------
log "Configuring Docker daemon..."

# Create daemon.json with production-ready settings
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<DAEMON_JSON
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "${LOG_MAX_SIZE}",
        "max-file": "${LOG_MAX_FILES}"
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
    }
}
DAEMON_JSON

# Create systemd override to expose Docker on TCP (for remote management)
# and remove the default -H fd:// flag that conflicts with daemon.json
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/override.conf <<OVERRIDE
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H unix:///var/run/docker.sock -H tcp://0.0.0.0:${DOCKER_TCP_PORT}
OVERRIDE

# Reload and restart Docker
systemctl daemon-reload
systemctl enable docker
systemctl restart docker

# Wait for Docker to be fully ready
log "Waiting for Docker to start..."
RETRIES=0
MAX_RETRIES=15
while ! docker info >/dev/null 2>&1; do
    RETRIES=$((RETRIES + 1))
    if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
        die "Docker failed to start after ${MAX_RETRIES} attempts"
    fi
    sleep 2
done
log "  Docker is running (took ~${RETRIES}x2s)"

# ---------------------------------------------------------------------------
# 5. Docker Compose plugin (if not already present)
# ---------------------------------------------------------------------------
if ! docker compose version >/dev/null 2>&1; then
    log "Installing Docker Compose plugin..."
    COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest 2>/dev/null | jq -r '.tag_name // "v2.27.0"')
    ARCH=$(dpkg --print-architecture)
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-${ARCH}" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null || true
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 6. Configure log rotation for container logs
# ---------------------------------------------------------------------------
log "Setting up log rotation..."
cat > /etc/logrotate.d/docker-containers <<'LOGROTATE'
/var/lib/docker/containers/*/*.log {
    rotate 7
    daily
    compress
    missingok
    notifempty
    delaycompress
    copytruncate
    maxsize 100M
}
LOGROTATE

# ---------------------------------------------------------------------------
# 7. System tuning for container workloads
# ---------------------------------------------------------------------------
log "Applying system tuning..."

# Increase file descriptor limits
cat > /etc/security/limits.d/99-guildserver.conf <<'LIMITS'
*    soft    nofile    65536
*    hard    nofile    65536
root soft    nofile    65536
root hard    nofile    65536
LIMITS

# Kernel tuning for networking (if sysctl is writable — may not be in LXC)
if [ -w /proc/sys/net/ipv4/ip_forward ]; then
    cat >> /etc/sysctl.conf <<'SYSCTL'
# GuildServer: container networking tuning
net.ipv4.ip_forward = 1
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 1024 65535
vm.overcommit_memory = 1
SYSCTL
    sysctl -p 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 8. Cleanup
# ---------------------------------------------------------------------------
log "Cleaning up..."
apt-get autoremove -y -qq 2>/dev/null || true
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# ---------------------------------------------------------------------------
# 9. Verification
# ---------------------------------------------------------------------------
log "Running verification checks..."

CHECKS_PASSED=0
CHECKS_TOTAL=4

# Docker running
if docker info >/dev/null 2>&1; then
    log "  ✅ Docker engine running"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
    warn "  ❌ Docker engine NOT running"
fi

# Docker TCP socket
if curl -sf "http://127.0.0.1:${DOCKER_TCP_PORT}/version" >/dev/null 2>&1; then
    log "  ✅ Docker TCP socket on port ${DOCKER_TCP_PORT}"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
    # Fallback: check with docker -H
    if docker -H "tcp://127.0.0.1:${DOCKER_TCP_PORT}" info >/dev/null 2>&1; then
        log "  ✅ Docker TCP socket on port ${DOCKER_TCP_PORT}"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
    else
        warn "  ❌ Docker TCP socket NOT responding on port ${DOCKER_TCP_PORT}"
    fi
fi

# DNS resolution
if getent hosts google.com >/dev/null 2>&1; then
    log "  ✅ DNS resolution working"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
    warn "  ❌ DNS resolution FAILED"
fi

# Git available
if command -v git >/dev/null 2>&1; then
    log "  ✅ Git installed ($(git --version 2>/dev/null | head -1))"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
    warn "  ❌ Git NOT installed"
fi

log "Verification: ${CHECKS_PASSED}/${CHECKS_TOTAL} checks passed"

# Docker version summary
log "Docker version: $(docker --version 2>/dev/null || echo 'unknown')"
if docker compose version >/dev/null 2>&1; then
    log "Compose version: $(docker compose version --short 2>/dev/null || echo 'unknown')"
fi

if [ "$CHECKS_PASSED" -ge 3 ]; then
    echo "BOOTSTRAP_OK"
else
    echo "BOOTSTRAP_PARTIAL"
fi
