---
sidebar_position: 19
title: WebSocket API
description: Real-time event streaming via WebSocket for deployment logs and status updates.
---

# WebSocket API

GuildServer provides a WebSocket server for real-time event streaming. The WebSocket connection is used by the dashboard to display live deployment logs, status changes, and notifications.

## Connection

Connect to the WebSocket server at the API server's base URL:

\`\`\`
ws://localhost:3001
\`\`\`

## Authentication

After connecting, authenticate by sending a JSON message with your JWT token:

\`\`\`json
{ "type": "auth", "token": "<jwt-token>" }
\`\`\`

## Events

### Deployment Logs

Subscribe to deployment log events:

\`\`\`json
{ "type": "subscribe", "channel": "deployment:<deployment-id>" }
\`\`\`

Log events are streamed as they occur during the build and deploy process.

### Status Updates

Application and deployment status changes are broadcast to subscribed clients. The dashboard uses these to update status badges and trigger notifications in real time.

## Message Format

All messages are JSON objects with a \`type\` field indicating the event type and additional fields containing the event data.

## Implementation

The WebSocket server is built with the \`ws\` library and initialized alongside the Express HTTP server. It shares the same port and is upgraded from HTTP connections.
