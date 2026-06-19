---
id: custom-domains
title: Custom Domains
sidebar_label: Custom Domains
---

# Custom Domains

GuildServer handles custom domains using **Registrar-Level Redirects**. Instead of updating DNS records to point to our servers (which can be complex and error-prone), you configure your domain registrar to forward traffic from your custom domain to your app's canonical `*.guildserver.io` address.

## Why We Use Redirects

GuildServer routes all traffic through a secure Cloudflare Tunnel that exclusively listens on `*.guildserver.io`. We do not expose a public IP address for direct DNS A-record mapping, and we do not terminate TLS for arbitrary third-party domains on our edge.

By using registrar-level forwarding:
- **Instant SSL:** Your registrar handles the TLS certificate for your custom domain, and Cloudflare handles the TLS certificate for your `*.guildserver.io` app. No waiting for Let's Encrypt provisioning.
- **Zero Downtime Routing:** Traffic is seamlessly forwarded to your canonical URL.
- **No Complex DNS:** You don't need to manage CNAME flattening, ALIAS records, or complex verification TXT records.

## How to Set It Up

1. Go to your application dashboard in GuildServer and navigate to the **Domains** tab.
2. Click **Add Custom Domain** and enter your domain (e.g., `myapp.example.com`).
3. The dashboard will generate specific **Forwarding Instructions** tailored to your domain type (apex vs. subdomain).
4. Select your registrar from the dropdown (e.g., Namecheap, GoDaddy, Cloudflare, Porkbun, Google Domains/Squarespace) for step-by-step instructions.
5. Apply the forwarding rule at your registrar.
6. Click **Verify** in the GuildServer dashboard.

### Verification

When you click Verify, GuildServer automatically tests the redirect by following the HTTP chain from your custom domain to ensure it lands exactly on your `*.guildserver.io` canonical URL. Once verified, the domain will be marked as Active.

## Limitations

> [!WARNING]
> **Masking is Not Supported**
> 
> "URL Masking" or "Frame Forwarding" (keeping the custom domain in the address bar while loading the destination content in a hidden iframe) is **not supported** and strongly discouraged. Modern browsers block iframed content for security reasons, and it ruins SEO and mobile responsiveness. 
> 
> When users visit your custom domain, their browser's address bar will update to your canonical `*.guildserver.io` URL (a standard HTTP 301/302 redirect).
