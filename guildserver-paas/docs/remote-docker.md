# Remote Docker hosts

A **Remote Docker Host** provider deploys applications to a Docker daemon on
another server, instead of the server GuildServer itself runs on. Platform
admins add providers under **Admin → Infrastructure**. Applications are then
assigned to a provider, or pick up their organization's default provider.

## Requirements on the host

- Docker Engine, including the `docker` CLI. SSH connections run
  `docker system dial-stdio` on the host.
- For SSH: a user that can run Docker (root or a member of the `docker` group),
  and either an unencrypted private key or a password. Passphrase-protected keys
  are not supported.
- For TLS: Docker's TLS socket (usually port 2376) with a CA certificate and a
  client certificate and key.
- Reachable from the GuildServer server. Private addresses (LAN, VPN) are fine.
  Loopback, link-local (including cloud metadata at 169.254.169.254) and
  unspecified addresses are refused.

## Security

- **Credentials** (SSH private key, SSH password, TLS client key) are encrypted
  before they are stored and are never returned by the API. When editing a
  provider, leave them empty to keep the stored values.
- **SSH host keys are pinned.** Supply the fingerprint yourself, or let
  GuildServer pin the key it sees on the first successful connection test:

  ```bash
  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
  ```

  From then on, a server presenting a different key is refused, both by the
  connection test and by every deployment. Changing the provider's host or port
  clears the pin, and the new host is pinned on its next successful test.
- A provider whose SSH key has not been pinned yet will not deploy. Run a
  connection test first.

## What happens on deploy

1. Images built by GuildServer from a Git repository (`gs-*`) are copied to the
   host (`docker save` → `docker load`). Registry images are pulled on the host.
2. The container is created on the host with the same settings, labels,
   rolling-update behaviour and health checks as a local deployment.
3. Health checks probe the host's address on the container's published port,
   so that port must be reachable from the GuildServer server.

### Domains

Apps on a remote host are reached at `http://<host>:<port>` by default. To
serve domains from the host, enable **Run GuildServer's proxy on this host**.
GuildServer then starts Traefik (`traefik:v3.1`, container `gs-proxy`) on the
host, bound to ports 80 and 443, with Let's Encrypt HTTP challenges. Point each
domain's DNS at the host. Leave this off if something else already uses ports
80/443 on that server. The proxy's dashboard/API is not enabled.

## Current limits

These work only for applications on GuildServer's own server, not yet for
remote hosts:

- live log streaming over WebSocket (the application's **Logs** view and the
  API still show recent logs, fetched from the remote host);
- log drains;
- database backups and restores;
- persistent storage for applications.
