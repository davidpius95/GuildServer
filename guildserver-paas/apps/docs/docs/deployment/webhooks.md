---
sidebar_position: 6
title: Webhooks
description: Configure webhooks from Git providers to trigger automatic deployments and preview environments.
---

# Webhooks

Webhooks enable **automatic deployments** when code is pushed to a Git repository. GuildServer receives webhook events from Git providers, validates them, and triggers the appropriate deployment or preview environment.

## How Webhooks Work

1. You configure a webhook URL on your Git provider pointing to GuildServer.
2. When a push event occurs, the provider sends an HTTP POST to GuildServer.
3. GuildServer validates the webhook payload and signature.
4. If the push is to the configured branch, a standard deployment is triggered.
5. If preview deployments are enabled and the push is to a different branch, a preview deployment is created.

## Webhook Endpoint

```
POST {API_URL}/webhooks/{provider}
```

Supported providers: `github`, `gitlab`, `bitbucket`, `gitea`.

## GitHub Webhooks

For GitHub, webhooks are automatically configured when you connect a repository through the OAuth integration. GuildServer validates the webhook using the `X-Hub-Signature-256` header.

## Manual Webhook Setup

For other providers, configure the webhook manually:

1. Go to your repository's webhook settings.
2. Add a new webhook with the URL: `{API_URL}/webhooks/{provider}`.
3. Set the content type to `application/json`.
4. Configure the secret for payload verification.
5. Select `push` events at minimum.

## Webhook Delivery Tracking

GuildServer records every webhook delivery in the `webhook_deliveries` table with provider, event type, full payload, headers, status code, delivery status, error messages, and processing time.

## Stripe Webhooks

In addition to Git webhooks, GuildServer handles Stripe webhooks for billing events at `{API_URL}/webhooks/stripe`. This endpoint uses raw body parsing for Stripe signature verification.

## Related Pages

- [Git Deployments](./git-deployments) -- Webhook-triggered deployments
- [Preview Deployments](./preview-deployments) -- Branch-based previews
- [Webhooks API](/api/webhooks) -- API reference
