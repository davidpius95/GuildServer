# GuildServer PaaS Deployment Report

This document outlines the exact steps taken to deploy the GuildServer platform to the remote Ubuntu server, the networking challenges encountered and resolved, and instructions for managing the deployment going forward.

## 1. Codebase Transfer & Setup
- **Source**: Local machine (`/Users/user/GuildServer/guildserver-paas/`)
- **Destination**: Remote Ubuntu Server (`153.67.71.124` / `192.168.8.222`)
- **Method**: The codebase was synchronized to the remote server using `rsync` over SSH on port 5555. This ensured all necessary source code, configuration files, and Dockerfiles were present.

## 2. Environment Configuration
A production `.env` file was securely generated and placed on the remote server (`~/guildserver-paas/.env`). The file includes:
- Randomly generated 64-character hexadecimal secrets for `NEXTAUTH_SECRET` and `JWT_SECRET`.
- Database routing credentials for the internal Postgres and Redis containers.
- Node environments set to `production` and App/API URLs mapped to `https://guildserver.io`.

## 3. Container Orchestration (Docker Compose)
The application was built and launched using the `docker-compose.prod.yml` configuration. The following containers are currently running and healthy:
- **`guildserver-postgres`**: PostgreSQL 15 database
- **`guildserver-redis`**: Redis 7 cache
- **`guildserver-api`**: Node.js backend (listening internally on port 4000)
- **`guildserver-web`**: Next.js frontend (listening internally on port 3000)
- **`guildserver-docs`**: Docusaurus documentation site
- **`guildserver-traefik`**: Traefik Reverse Proxy (handling routing to Web, API, and Docs based on path and host headers)

## 4. Networking & DNS Resolution
During the DNS configuration phase, a critical networking issue was identified:
- **The Problem**: The public IP provided (`153.67.71.124`) belongs to a router/edge gateway that is actively running its own Nginx proxy on ports 80 and 443. Because the Ubuntu VM is behind this router (at local IP `192.168.8.222`) without proper port forwarding, Traefik was unreachable from the outside. This resulted in Cloudflare returning a `503 Service Unavailable: no available server` error.
- **The Solution (Cloudflare Tunnel)**: To bypass the router's Nginx proxy and NAT rules, we installed **Cloudflare Tunnel (`cloudflared`)** directly on the Ubuntu VM as a systemd service.
- The tunnel (`guildserver-paas`) securely connects the VM directly to the Cloudflare edge network.
- DNS `CNAME` records were updated in Cloudflare to route traffic from `guildserver.io` and `www.guildserver.io` through the tunnel.
- The tunnel forwards all HTTP traffic to `localhost:80` (Traefik), which then correctly routes the requests to the Next.js and API containers.

---

## Instructions for Managing Your Server

Below are essential commands you can run from inside the remote server (`ssh -p 5555 usher-node@153.67.71.124`) to manage your platform.

### 1. Viewing Application Logs
To see real-time logs for any of your services, use the `docker logs` command:
```bash
cd ~/guildserver-paas
docker compose -f docker-compose.prod.yml logs -f web       # View Frontend logs
docker compose -f docker-compose.prod.yml logs -f api       # View Backend logs
docker compose -f docker-compose.prod.yml logs -f traefik   # View Proxy routing logs
```

### 2. Pushing Updates (Deploying New Code)
When you make changes to your code locally and want to update the live server:

1. **Sync your code** to the server. From your local machine terminal:
   ```bash
   rsync -avz -e "ssh -p 5555" --exclude 'node_modules' --exclude '.next' --exclude '.git' /Users/user/GuildServer/guildserver-paas/ usher-node@153.67.71.124:~/guildserver-paas/
   ```
2. **Rebuild and restart** the containers. From the remote server terminal:
   ```bash
   cd ~/guildserver-paas
   docker compose -f docker-compose.prod.yml up --build -d
   ```
   *(Docker will only rebuild the containers whose code changed, resulting in minimal downtime).*

### 3. Managing the Cloudflare Tunnel
The Cloudflare tunnel runs automatically in the background as a systemd service. If you ever need to check its status or restart it:
```bash
sudo systemctl status cloudflared
sudo systemctl restart cloudflared
```

### 4. Database Access
If you need to execute SQL commands directly against your production database:
```bash
docker exec -it guildserver-postgres psql -U guildserver -d guildserver
```
