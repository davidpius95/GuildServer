#!/usr/bin/env bash
# ── GuildServer BaaS — Compute Node Setup ────────────────────────────────────
# Run this once on each compute node to pre-pull all Supabase images so that
# project provisioning skips the slow image-download step.
#
# Usage:
#   chmod +x setup-node.sh
#   sudo ./setup-node.sh
#
# Idempotent: safe to re-run to refresh images to latest pinned versions.
set -euo pipefail

IMAGES=(
  "supabase/postgres:17.6.1.136"
  "supabase/supavisor:2.9.5"
  "kong:3.9.1"
  "supabase/gotrue:v2.189.0"
  "postgrest/postgrest:v14.12"
  "supabase/realtime:v2.102.3"
  "supabase/storage-api:v1.60.4"
  "darthsim/imgproxy:v3.30.1"
  "supabase/postgres-meta:v0.96.6"
  "supabase/edge-runtime:v1.74.0"
  "supabase/studio:2026.06.03-sha-0bca601"
)

echo "[setup-node] Starting GuildServer BaaS node setup"
echo "[setup-node] Pulling ${#IMAGES[@]} Supabase images..."

for img in "${IMAGES[@]}"; do
  echo ""
  echo "  ↓ $img"
  docker pull "$img"
done

echo ""
echo "[setup-node] All images pulled successfully."
echo "[setup-node] Node is ready to provision BaaS projects."

# Ensure base directory exists
mkdir -p /opt/baas
echo "[setup-node] Base directory /opt/baas ready."
