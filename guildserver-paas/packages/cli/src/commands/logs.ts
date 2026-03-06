import { Command } from "commander";
import { trpcCall } from "../api";
import { loadConfig } from "../config";
import WebSocket from "ws";

export function registerLogsCommand(program: Command): void {
  program
    .command("logs <appId>")
    .description("View application logs")
    .option("-n, --lines <number>", "Number of lines to show", "50")
    .option("-f, --follow", "Follow log output in real-time")
    .option("--level <level>", "Filter by level (info, warning, error)")
    .action(async (appId, options) => {
      try {
        const config = loadConfig();
        if (!config.token) {
          console.error("\n  ❌ Not logged in. Run `guildserver login` first.\n");
          process.exit(1);
        }

        if (options.follow) {
          // Use WebSocket for real-time log streaming
          await streamLogs(appId, config);
        } else {
          // Fetch recent logs via API
          const result = await trpcCall("application.getLogs", {
            id: appId,
            lines: parseInt(options.lines),
          });

          // Result could be an array directly or {logs: [...]}
          const logs = Array.isArray(result) ? result : result?.logs || [];
          if (logs.length === 0) {
            console.log("\n  No logs found.\n");
            return;
          }

          console.log();
          for (const log of logs) {
            const ts = log.timestamp
              ? new Date(log.timestamp).toLocaleTimeString()
              : "";
            const level = log.level || "info";
            const levelColor =
              level === "error"
                ? "\x1b[31m"
                : level === "warning"
                ? "\x1b[33m"
                : "\x1b[36m";
            const reset = "\x1b[0m";

            if (options.level && level !== options.level) continue;

            console.log(
              `  ${ts} ${levelColor}[${level.toUpperCase().padEnd(7)}]${reset} ${log.message}`
            );
          }
          console.log();
        }
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });
}

async function streamLogs(
  applicationId: string,
  config: { apiUrl: string; token?: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = config.apiUrl.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsUrl}/ws?token=${config.token}`);

    console.log("\n  📡 Connecting to log stream...\n");

    ws.on("open", () => {
      // Subscribe to logs for this application
      ws.send(
        JSON.stringify({
          type: "subscribe_logs",
          payload: { applicationId },
        })
      );
    });

    ws.on("message", (data: any) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case "connection":
            // Connected
            break;
          case "logs_subscribed":
            console.log("  ✅ Connected. Streaming logs (Ctrl+C to exit)...\n");
            break;
          case "log_line": {
            const ts = msg.timestamp
              ? new Date(msg.timestamp).toLocaleTimeString()
              : "";
            const level = msg.level || "info";
            const levelColor =
              level === "error"
                ? "\x1b[31m"
                : level === "warning"
                ? "\x1b[33m"
                : "\x1b[36m";
            const reset = "\x1b[0m";

            console.log(
              `  ${ts} ${levelColor}[${level.toUpperCase().padEnd(7)}]${reset} ${msg.message}`
            );
            break;
          }
          case "log_error":
            console.error(`  ❌ Log stream error: ${msg.message}`);
            break;
          case "logs_ended":
            console.log("\n  📴 Log stream ended.\n");
            ws.close();
            resolve();
            break;
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on("error", (err) => {
      console.error(`  ❌ WebSocket error: ${err.message}`);
      reject(err);
    });

    ws.on("close", () => {
      console.log("\n  Disconnected.\n");
      resolve();
    });

    // Handle Ctrl+C
    process.on("SIGINT", () => {
      console.log("\n\n  Disconnecting...");
      ws.send(
        JSON.stringify({
          type: "unsubscribe_logs",
          payload: { applicationId },
        })
      );
      ws.close();
    });
  });
}
