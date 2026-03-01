import { WebSocketServer } from "ws";
import { createServer } from "http";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";

interface WebSocketClient {
  id: string;
  userId: string;
  organizationId?: string;
  ws: any;
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
      ws.on("message", async (data) => {
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
        clients.delete(clientId);
        logger.info("WebSocket client disconnected", { clientId, userId });
      });

      // Handle connection errors
      ws.on("error", (error) => {
        logger.error("WebSocket error", { error, clientId, userId });
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
    case "ping":
      client.ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      break;
    default:
      logger.warn("Unknown WebSocket message type", { type, clientId: client.id });
  }
}

async function handleSubscription(client: WebSocketClient, payload: any) {
  const { channel, resourceId } = payload;

  // TODO: Validate user has access to the resource
  // For now, just acknowledge the subscription
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