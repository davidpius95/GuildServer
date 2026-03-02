// Load env vars BEFORE any other imports (import hoisting workaround)
import "dotenv/config";

import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";
import { logger } from "./utils/logger";
import { createWebSocketServer } from "./websocket/server";
import { initializeQueues } from "./queues/setup";
import { setupSwagger } from "./swagger";
import { webhookRouter } from "./routes/webhooks";

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for development
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));

// General middleware
app.use(compression());
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Swagger API docs
setupSwagger(app);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    environment: process.env.NODE_ENV || "development",
  });
});

// Webhook routes (before tRPC, these are plain Express routes)
app.use("/webhooks", webhookRouter);

// tRPC middleware
app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError: ({ error, path, input }) => {
      logger.error("tRPC Error:", {
        path,
        input,
        error: error.message,
        stack: error.stack,
      });
    },
  })
);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
  });
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error("Unhandled error:", {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : "Something went wrong",
  });
});

async function startServer() {
  try {
    // Initialize background queues
    await initializeQueues();
    logger.info("✅ Background queues initialized");

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 GuildServer API running on port ${PORT}`);
      logger.info(`📚 tRPC endpoint: http://localhost:${PORT}/trpc`);
      logger.info(`🔍 Health check: http://localhost:${PORT}/health`);
      logger.info(`📖 Swagger docs: http://localhost:${PORT}/api-docs`);
    });

    // Initialize WebSocket server
    createWebSocketServer(server);
    logger.info("🔌 WebSocket server initialized");

    // Graceful shutdown
    process.on("SIGTERM", () => {
      logger.info("Received SIGTERM, shutting down gracefully");
      server.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
    });

    process.on("SIGINT", () => {
      logger.info("Received SIGINT, shutting down gracefully");
      server.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();