import { Command } from "commander";
import { trpcCall } from "../api";
import fs from "fs";
import path from "path";

export function registerEnvCommand(program: Command): void {
  const env = program.command("env").description("Manage environment variables");

  env
    .command("list <appId>")
    .alias("ls")
    .description("List environment variables for an application")
    .option("--scope <scope>", "Filter by scope (production, preview, development)")
    .option("--show-values", "Show actual values (hidden by default)")
    .action(async (appId, options) => {
      try {
        const envVars = await trpcCall("environment.list", {
          applicationId: appId,
          scope: options.scope,
        });

        if (!envVars || envVars.length === 0) {
          console.log("\n  No environment variables found.\n");
          return;
        }

        console.log(`\n  🔑 Environment Variables\n`);

        const grouped: Record<string, any[]> = {};
        for (const v of envVars) {
          const scope = v.scope || "all";
          if (!grouped[scope]) grouped[scope] = [];
          grouped[scope].push(v);
        }

        for (const [scope, vars] of Object.entries(grouped)) {
          console.log(`  📌 ${scope.toUpperCase()}`);
          console.log(`  ${"─".repeat(50)}`);

          for (const v of vars) {
            const value = options.showValues ? v.value : "••••••••";
            console.log(`  ${v.key}=${value}`);
          }
          console.log();
        }
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });

  env
    .command("set <appId> <key> <value>")
    .description("Set an environment variable")
    .option("--scope <scope>", "Variable scope (production, preview, development)", "production")
    .action(async (appId, key, value, options) => {
      try {
        await trpcCall(
          "environment.set",
          {
            applicationId: appId,
            key,
            value,
            scope: options.scope,
          },
          "mutation"
        );
        console.log(`\n  ✅ Set ${key} for ${options.scope}\n`);
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });

  env
    .command("remove <appId> <key>")
    .alias("rm")
    .description("Remove an environment variable")
    .option("--scope <scope>", "Variable scope", "production")
    .action(async (appId, key, options) => {
      try {
        await trpcCall(
          "environment.delete",
          {
            applicationId: appId,
            key,
            scope: options.scope,
          },
          "mutation"
        );
        console.log(`\n  ✅ Removed ${key}\n`);
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });

  env
    .command("pull <appId>")
    .description("Download env vars to a local .env file")
    .option("--scope <scope>", "Variable scope", "development")
    .option("--file <file>", "Output file path", ".env.local")
    .action(async (appId, options) => {
      try {
        const envVars = await trpcCall("environment.list", {
          applicationId: appId,
          scope: options.scope,
        });

        if (!envVars || envVars.length === 0) {
          console.log("\n  No environment variables found.\n");
          return;
        }

        const content = envVars
          .map((v: any) => `${v.key}=${v.value}`)
          .join("\n");

        const filePath = path.resolve(options.file);
        fs.writeFileSync(filePath, content + "\n");
        console.log(`\n  ✅ Downloaded ${envVars.length} variables to ${options.file}\n`);
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });

  env
    .command("push <appId>")
    .description("Upload local .env file as environment variables")
    .option("--scope <scope>", "Variable scope", "production")
    .option("--file <file>", "Input .env file path", ".env")
    .action(async (appId, options) => {
      try {
        const filePath = path.resolve(options.file);
        if (!fs.existsSync(filePath)) {
          console.error(`\n  ❌ File not found: ${filePath}\n`);
          process.exit(1);
        }

        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

        let count = 0;
        for (const line of lines) {
          const eqIndex = line.indexOf("=");
          if (eqIndex === -1) continue;

          const key = line.substring(0, eqIndex).trim();
          const value = line.substring(eqIndex + 1).trim();

          if (!key) continue;

          await trpcCall(
            "environment.set",
            {
              applicationId: appId,
              key,
              value,
              scope: options.scope,
            },
            "mutation"
          );
          count++;
        }

        console.log(`\n  ✅ Uploaded ${count} variables to ${options.scope}\n`);
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });
}
