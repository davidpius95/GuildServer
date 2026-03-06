import { Command } from "commander";
import { trpcCall } from "../api";
import { loadConfig } from "../config";

export function registerAppsCommand(program: Command): void {
  const apps = program
    .command("apps")
    .alias("ls")
    .description("List and manage applications");

  apps
    .command("list")
    .alias("ls")
    .description("List all applications")
    .option("--project <id>", "Filter by project ID")
    .action(async (options) => {
      try {
        const config = loadConfig();
        if (!config.token) {
          console.error("\n  ❌ Not logged in. Run `guildserver login` first.\n");
          process.exit(1);
        }

        // Get projects first
        const projects = await trpcCall("project.list", {
          organizationId: config.organizationId,
        });

        if (!projects || projects.length === 0) {
          console.log("\n  No projects found.\n");
          return;
        }

        console.log(`\n  📦 Applications (${config.organizationName || "org"})\n`);

        let totalApps = 0;
        for (const project of projects) {
          if (options.project && project.id !== options.project) continue;

          const apps = await trpcCall("application.list", {
            projectId: project.id,
          });

          if (!apps || apps.length === 0) continue;

          console.log(`  📂 ${project.name}`);
          console.log(`  ${"─".repeat(50)}`);

          for (const app of apps) {
            const statusIcon =
              app.status === "running"
                ? "🟢"
                : app.status === "stopped"
                ? "🔴"
                : app.status === "deploying"
                ? "🟡"
                : app.status === "building"
                ? "🔨"
                : "⚪";

            const typeLabel =
              app.deploymentType === "docker" ? "Docker" : app.deploymentType === "git" ? "Git" : app.deploymentType;

            console.log(`  ${statusIcon} ${app.name}`);
            console.log(`     Status: ${app.status} | Type: ${typeLabel} | Port: ${app.containerPort || "—"}`);
            if (app.dockerImage) {
              console.log(`     Image: ${app.dockerImage}`);
            }
            if (app.url) {
              console.log(`     URL: ${app.url}`);
            }
            console.log();
            totalApps++;
          }
        }

        if (totalApps === 0) {
          console.log("  No applications found. Deploy one with `guildserver deploy`.\n");
        }
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });

  apps
    .command("info <appId>")
    .description("Get detailed info about an application")
    .action(async (appId) => {
      try {
        const app = await trpcCall("application.getById", { id: appId });
        console.log(`\n  📦 ${app.name}\n`);
        console.log(`  ID:          ${app.id}`);
        console.log(`  Status:      ${app.status}`);
        console.log(`  Type:        ${app.deploymentType}`);
        console.log(`  Image:       ${app.dockerImage || "—"}`);
        console.log(`  Port:        ${app.containerPort || "—"}`);
        console.log(`  Git URL:     ${app.gitUrl || "—"}`);
        console.log(`  Branch:      ${app.gitBranch || "—"}`);
        console.log(`  URL:         ${app.url || "—"}`);
        console.log(`  Created:     ${new Date(app.createdAt).toLocaleString()}`);
        console.log(`  Updated:     ${new Date(app.updatedAt).toLocaleString()}`);
        console.log();
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });

  apps
    .command("restart <appId>")
    .description("Restart an application")
    .action(async (appId) => {
      try {
        console.log("\n  🔄 Restarting application...");
        await trpcCall("application.restart", { id: appId }, "mutation");
        console.log("  ✅ Application restarted.\n");
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });

  apps
    .command("stop <appId>")
    .description("Stop an application")
    .action(async (appId) => {
      try {
        console.log("\n  🛑 Stopping application...");
        await trpcCall(
          "application.update",
          { id: appId, status: "stopped" },
          "mutation"
        );
        console.log("  ✅ Application stopped.\n");
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });

  apps
    .command("delete <appId>")
    .description("Delete an application")
    .option("--yes", "Skip confirmation")
    .action(async (appId, options) => {
      try {
        if (!options.yes) {
          const readline = await import("readline");
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const answer = await new Promise<string>((resolve) => {
            rl.question(
              "\n  ⚠️  Are you sure you want to delete this application? (y/N): ",
              resolve
            );
          });
          rl.close();
          if (answer.toLowerCase() !== "y") {
            console.log("  Cancelled.\n");
            return;
          }
        }

        console.log("\n  🗑️  Deleting application...");
        await trpcCall("application.delete", { id: appId }, "mutation");
        console.log("  ✅ Application deleted.\n");
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });

  // Default action for `apps` with no subcommand shows list
  apps.action(async () => {
    await apps.commands.find((c) => c.name() === "list")?.parseAsync([], { from: "user" });
  });
}
