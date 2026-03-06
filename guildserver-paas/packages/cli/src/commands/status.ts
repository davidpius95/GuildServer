import { Command } from "commander";
import { trpcCall } from "../api";
import { loadConfig } from "../config";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show organization overview and system status")
    .action(async () => {
      try {
        const config = loadConfig();
        if (!config.token) {
          console.error("\n  ❌ Not logged in. Run `guildserver login` first.\n");
          process.exit(1);
        }

        console.log(`\n  🏰 GuildServer Status\n`);
        console.log(`  API: ${config.apiUrl}`);

        // Get org info
        if (config.organizationId) {
          try {
            const org = await trpcCall("organization.getById", {
              id: config.organizationId,
            });
            console.log(`  Org: ${org.name} (${org.slug})`);
          } catch {}
        }

        // Get projects and apps
        try {
          const projects = await trpcCall("project.list", {
            organizationId: config.organizationId,
          });

          let totalApps = 0;
          let runningApps = 0;
          let stoppedApps = 0;

          for (const project of projects || []) {
            const apps = await trpcCall("application.list", {
              projectId: project.id,
            });
            for (const app of apps || []) {
              totalApps++;
              if (app.status === "running") runningApps++;
              if (app.status === "stopped") stoppedApps++;
            }
          }

          console.log(`\n  📊 Overview`);
          console.log(`  ${"─".repeat(40)}`);
          console.log(`  Projects:     ${projects?.length || 0}`);
          console.log(`  Applications: ${totalApps}`);
          console.log(`    🟢 Running: ${runningApps}`);
          console.log(`    🔴 Stopped: ${stoppedApps}`);
        } catch (error: any) {
          console.log(`\n  Could not fetch status: ${error.message}`);
        }

        // Get system health
        try {
          const health = await trpcCall("monitoring.getSystemHealth", {
            organizationId: config.organizationId,
          });
          console.log(`\n  🏥 System Health`);
          console.log(`  ${"─".repeat(40)}`);
          console.log(`  Docker:     ${health.docker?.status || "unknown"}`);
          console.log(`  API:        ${health.api?.status || "unknown"}`);
          console.log(`  Containers: ${health.containers?.running || 0}/${health.containers?.total || 0} running`);
        } catch {
          // monitoring might not be available
        }

        console.log();
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });
}
