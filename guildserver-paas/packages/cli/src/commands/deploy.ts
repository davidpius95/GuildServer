import { Command } from "commander";
import { trpcCall } from "../api";
import { loadConfig } from "../config";
import path from "path";
import fs from "fs";

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description("Deploy an application")
    .argument("[directory]", "Directory to deploy (default: current directory)")
    .option("--name <name>", "Application name")
    .option("--image <image>", "Docker image to deploy (skip build)")
    .option("--project <project>", "Project ID or name")
    .option("--env <env>", "Environment (production, preview, development)", "production")
    .option("--port <port>", "Container port", "3000")
    .option("--no-wait", "Don't wait for deployment to complete")
    .action(async (directory, options) => {
      try {
        const config = loadConfig();
        if (!config.token) {
          console.error("\n  ❌ Not logged in. Run `guildserver login` first.\n");
          process.exit(1);
        }

        const dir = directory ? path.resolve(directory) : process.cwd();
        console.log("\n  🚀 GuildServer Deploy\n");

        // Determine app name
        let appName = options.name;
        if (!appName) {
          // Try to get from package.json
          const pkgPath = path.join(dir, "package.json");
          if (fs.existsSync(pkgPath)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
              appName = pkg.name?.replace(/^@[^/]+\//, ""); // strip scope
            } catch {}
          }
          if (!appName) {
            appName = path.basename(dir);
          }
        }

        // Sanitize name
        appName = appName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();

        console.log(`  📦 Application: ${appName}`);
        console.log(`  📁 Directory: ${dir}`);

        // Get or create project
        let projectId = options.project;
        if (!projectId) {
          // List projects and use first one, or create one
          const projects = await trpcCall("project.list", {
            organizationId: config.organizationId,
          });

          if (projects && projects.length > 0) {
            projectId = projects[0].id;
            console.log(`  📂 Project: ${projects[0].name}`);
          } else {
            console.log("  📂 Creating default project...");
            const newProject = await trpcCall(
              "project.create",
              {
                name: "Default Project",
                organizationId: config.organizationId,
              },
              "mutation"
            );
            projectId = newProject.id;
            console.log(`  📂 Project: Default Project`);
          }
        }

        // Check if app already exists
        let app: any = null;
        try {
          const apps = await trpcCall("application.list", {
            projectId,
          });
          app = apps?.find((a: any) => a.name === appName);
        } catch {}

        if (app) {
          console.log(`  📱 Found existing application: ${app.name} (${app.status})`);
        } else {
          // Determine deploy type
          const hasDockerfile = fs.existsSync(path.join(dir, "Dockerfile"));
          const sourceType = options.image ? "docker" : hasDockerfile ? "docker" : "docker";
          const buildType = hasDockerfile ? "dockerfile" : "dockerfile";
          const image = options.image || (hasDockerfile ? undefined : "nginx:alpine");

          console.log(`  🔧 Creating application...`);
          app = await trpcCall(
            "application.create",
            {
              name: appName,
              projectId,
              sourceType,
              buildType,
              dockerImage: image,
              containerPort: parseInt(options.port),
            },
            "mutation"
          );
          console.log(`  ✅ Application created: ${app.name}`);
        }

        // Trigger deployment
        console.log(`\n  🏗️  Deploying...`);

        const deployment = await trpcCall(
          "application.deploy",
          {
            id: app.id,
          },
          "mutation"
        );

        const depId = deployment?.id || "pending";
        const depStatus = deployment?.status || "queued";
        console.log(`  📋 Deployment ID: ${depId}`);
        console.log(`  ⏳ Status: ${depStatus}`);

        if (options.wait !== false) {
          // Poll for deployment status
          console.log("\n  Waiting for deployment to complete...\n");
          let lastStatus = depStatus;
          let attempts = 0;
          const maxAttempts = 60; // 2 minutes

          while (attempts < maxAttempts) {
            await new Promise((r) => setTimeout(r, 2000));
            attempts++;

            try {
              // Poll app status since we may not have a deployment ID
              const updated = depId !== "pending"
                ? await trpcCall("deployment.getById", { id: depId })
                : await trpcCall("application.getById", { id: app.id });

              if (updated.status !== lastStatus) {
                const statusIcon =
                  updated.status === "running"
                    ? "✅"
                    : updated.status === "failed"
                    ? "❌"
                    : updated.status === "building"
                    ? "🔨"
                    : updated.status === "deploying"
                    ? "📦"
                    : "⏳";
                console.log(`  ${statusIcon} Status: ${updated.status}`);
                lastStatus = updated.status;
              }

              if (["running", "ready", "failed", "error"].includes(updated.status)) {
                break;
              }
            } catch {
              // retry
            }
          }

          if (lastStatus === "running" || lastStatus === "ready") {
            // Get application info for URL
            try {
              const appInfo = await trpcCall("application.getById", {
                id: app.id,
              });
              if (appInfo.url) {
                console.log(`\n  🌐 URL: ${appInfo.url}`);
              }
            } catch {}
            console.log(`\n  ✅ Deployment complete!\n`);
          } else if (lastStatus === "failed" || lastStatus === "error") {
            console.error(`\n  ❌ Deployment failed.\n`);
            // Try to get build logs
            try {
              const logs = await trpcCall("application.getLogs", {
                id: app.id,
                lines: 20,
              });
              if (logs?.logs?.length > 0) {
                console.log("  Last logs:");
                logs.logs.slice(-10).forEach((log: any) => {
                  console.log(`    ${log.message || log}`);
                });
              }
            } catch {}
            process.exit(1);
          } else {
            console.log(
              `\n  ⏳ Deployment is still in progress (${lastStatus}). Use 'guildserver status' to check.\n`
            );
          }
        } else {
          console.log(`\n  Deployment started. Use 'guildserver status' to check progress.\n`);
        }
      } catch (error: any) {
        console.error(`\n  ❌ Deploy failed: ${error.message}\n`);
        process.exit(1);
      }
    });
}
