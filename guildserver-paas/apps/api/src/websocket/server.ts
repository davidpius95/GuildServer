import { WebSocketServer } from "ws";
import { createServer } from "http";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";
import { getContainerLogs, getAppContainer, getDockerClient } from "../services/docker";

interface Subscription {
  channel: string;
  resourceId: string;
}

interface WebSocketClient {
  id: string;
  userId: string;
  organizationId?: string;
  ws: any;
  subscriptions: Subscription[];
  logStreams: Map<string, any>; // applicationId -> Docker stream
}

const clients = new Map<string, WebSocketClient>();

export function createWebSocketServer(httpServer: any) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
  });

  wss.on("connection", async (ws, request) => {
    try {
      // Extract token from query parameters or headers
      const url = new URL(request.url!, `http://${request.headers.host}`);
      const token = url.searchParams.get("token") || request.headers.authorization?.replace("Bearer ", "");

      if (!token) {
        ws.close(1008, "Authentication required");
        return;
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      const userId = decoded.userId;

      if (!userId) {
        ws.close(1008, "Invalid token");
        return;
      }

      // Create client connection
      const clientId = `${userId}-${Date.now()}`;
      const client: WebSocketClient = {
        id: clientId,
        userId,
        ws,
        subscriptions: [],
        logStreams: new Map(),
      };

      clients.set(clientId, client);
      logger.info("WebSocket client connected", { clientId, userId });

      // Send connection confirmation
      ws.send(JSON.stringify({
        type: "connection",
        status: "connected",
        clientId,
      }));

      // Handle incoming messages
      ws.on("message", async (data: any) => {
        try {
          const message = JSON.parse(data.toString());
          await handleWebSocketMessage(client, message);
        } catch (error) {
          logger.error("WebSocket message error", { error, clientId });
          ws.send(JSON.stringify({
            type: "error",
            message: "Invalid message format",
          }));
        }
      });

      // Handle client disconnect
      ws.on("close", () => {
        // Clean up log streams
        for (const [appId, stream] of client.logStreams) {
          try {
            stream.destroy();
          } catch { /* ignore */ }
        }
        client.logStreams.clear();
        clients.delete(clientId);
        logger.info("WebSocket client disconnected", { clientId, userId });
      });

      // Handle connection errors
      ws.on("error", (error: any) => {
        logger.error("WebSocket error", { error, clientId, userId });
        for (const [appId, stream] of client.logStreams) {
          try { stream.destroy(); } catch { /* ignore */ }
        }
        client.logStreams.clear();
        clients.delete(clientId);
      });

    } catch (error) {
      logger.error("WebSocket connection error", { error });
      ws.close(1008, "Authentication failed");
    }
  });

  logger.info("WebSocket server initialized on /ws");
  return wss;
}

async function handleWebSocketMessage(client: WebSocketClient, message: any) {
  const { type, payload } = message;

  switch (type) {
    case "subscribe":
      await handleSubscription(client, payload);
      break;
    case "unsubscribe":
      await handleUnsubscription(client, payload);
      break;
    case "subscribe_logs":
      await handleLogSubscription(client, payload);
      break;
    case "unsubscribe_logs":
      await handleLogUnsubscription(client, payload);
      break;
    case "ping":
      client.ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      break;
    default:
      logger.warn("Unknown WebSocket message type", { type, clientId: client.id });
  }
}

async function handleSubscription(client: WebSocketClient, payload: any) {
  const { channel, resourceId } = payload;

  // Track the subscription
  client.subscriptions.push({ channel, resourceId });

  client.ws.send(JSON.stringify({
    type: "subscribed",
    channel,
    resourceId,
  }));

  logger.info("Client subscribed to channel", {
    clientId: client.id,
    channel,
    resourceId,
  });
}

async function handleUnsubscription(client: WebSocketClient, payload: any) {
  const { channel, resourceId } = payload;

  // Remove subscription
  client.subscriptions = client.subscriptions.filter(
    (s) => !(s.channel === channel && s.resourceId === resourceId)
  );

  client.ws.send(JSON.stringify({
    type: "unsubscribed",
    channel,
    resourceId,
  }));

  logger.info("Client unsubscribed from channel", {
    clientId: client.id,
    channel,
    resourceId,
  });
}

/**
 * Handle real-time log streaming subscription
 * Client sends: { type: "subscribe_logs", payload: { applicationId: "..." } }
 */
async function handleLogSubscription(client: WebSocketClient, payload: any) {
  const { applicationId } = payload;

  if (!applicationId) {
    client.ws.send(JSON.stringify({
      type: "error",
      message: "applicationId is required for log subscription",
    }));
    return;
  }

  // Clean up existing stream for this app
  if (client.logStreams.has(applicationId)) {
    try {
      client.logStreams.get(applicationId)!.destroy();
    } catch { /* ignore */ }
  }

  try {
    const docker = getDockerClient();

    // Find the container for this application
    const container = await getAppContainer(applicationId);
    if (!container) {
      client.ws.send(JSON.stringify({
        type: "log_error",
        applicationId,
        message: "No running container found for this application",
      }));
      return;
    }

    // Start following logs
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 50,
      timestamps: true,
    });

    // Store stream reference for cleanup
    client.logStreams.set(applicationId, stream);

    // Send confirmation
    client.ws.send(JSON.stringify({
      type: "logs_subscribed",
      applicationId,
    }));

    // Stream log data to client
    stream.on("data", (chunk: Buffer) => {
      try {
        // Parse Docker multiplexed stream
        const lines = parseStreamChunk(chunk);
        for (const line of lines) {
          if (client.ws.readyState === 1) {
            client.ws.send(JSON.stringify({
              type: "log_line",
              applicationId,
              ...line,
            }));
          }
        }
      } catch (e) {
        // ignore parse errors for partial chunks
      }
    });

    stream.on("end", () => {
      client.logStreams.delete(applicationId);
      if (client.ws.readyState === 1) {
        client.ws.send(JSON.stringify({
          type: "logs_ended",
          applicationId,
          message: "Container log stream ended",
        }));
      }
    });

    stream.on("error", (err: any) => {
      client.logStreams.delete(applicationId);
      if (client.ws.readyState === 1) {
        client.ws.send(JSON.stringify({
          type: "log_error",
          applicationId,
          message: err.message,
        }));
      }
    });

    logger.info("Started log streaming", { clientId: client.id, applicationId });
  } catch (error: any) {
    client.ws.send(JSON.stringify({
      type: "log_error",
      applicationId,
      message: `Failed to start log stream: ${error.message}`,
    }));
  }
}

/**
 * Handle log stream unsubscription
 */
async function handleLogUnsubscription(client: WebSocketClient, payload: any) {
  const { applicationId } = payload;

  if (client.logStreams.has(applicationId)) {
    try {
      client.logStreams.get(applicationId)!.destroy();
    } catch { /* ignore */ }
    client.logStreams.delete(applicationId);
  }

  client.ws.send(JSON.stringify({
    type: "logs_unsubscribed",
    applicationId,
  }));
}

/**
 * Parse a Docker multiplexed stream chunk into log lines
 */
function parseStreamChunk(buffer: Buffer): Array<{ timestamp: string; level: string; message: string }> {
  const lines: Array<{ timestamp: string; level: string; message: string }> = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;

    // Read frame header: [stream_type(1), 0(3), size(4)]
    const streamType = buffer[offset]; // 1=stdout, 2=stderr
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;

    if (offset + size > buffer.length) break;

    const rawLine = buffer.subarray(offset, offset + size).toString("utf8").trim();
    offset += size;

    if (!rawLine) continue;

    // Try to parse timestamp from Docker log format: 2024-01-20T14:32:15.123456789Z ...
    const timestampMatch = rawLine.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*(.*)/);
    const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();
    const message = timestampMatch ? timestampMatch[2] : rawLine;

    const level = streamType === 2 ? "error"
      : message.toLowerCase().includes("error") ? "error"
      : message.toLowerCase().includes("warn") ? "warning"
      : "info";

    lines.push({ timestamp, level, message });
  }

  return lines;
}

// Broadcast functions
export function broadcastToUser(userId: string, message: any) {
  const userClients = Array.from(clients.values()).filter(client => client.userId === userId);

  userClients.forEach(client => {
    if (client.ws.readyState === 1) { // WebSocket.OPEN
      client.ws.send(JSON.stringify(message));
    }
  });
}

export function broadcastToOrganization(organizationId: string, message: any) {
  const orgClients = Array.from(clients.values()).filter(
    client => client.organizationId === organizationId
  );

  orgClients.forEach(client => {
    if (client.ws.readyState === 1) { // WebSocket.OPEN
      client.ws.send(JSON.stringify(message));
    }
  });
}

export function broadcastToAll(message: any) {
  clients.forEach(client => {
    if (client.ws.readyState === 1) { // WebSocket.OPEN
      client.ws.send(JSON.stringify(message));
    }
  });
}

/**
 * Broadcast to clients subscribed to a specific channel/resource
 */
export function broadcastToSubscribers(channel: string, resourceId: string, message: any) {
  clients.forEach(client => {
    if (client.ws.readyState !== 1) return;

    const isSubscribed = client.subscriptions.some(
      (s) => s.channel === channel && s.resourceId === resourceId
    );

    if (isSubscribed) {
      client.ws.send(JSON.stringify(message));
    }
  });
}

// Utility functions
export function getConnectedClients() {
  return {
    total: clients.size,
    byUser: Array.from(clients.values()).reduce((acc, client) => {
      acc[client.userId] = (acc[client.userId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}
