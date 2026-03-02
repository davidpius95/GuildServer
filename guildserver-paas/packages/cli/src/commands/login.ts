import { Command } from "commander";
import { saveConfig, loadConfig, clearConfig } from "../config";
import { loginApi, registerApi, trpcCall } from "../api";
import readline from "readline";

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

function questionHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Simple approach - just ask normally (hide password would require raw mode)
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Authenticate with GuildServer")
    .option("--email <email>", "Email address")
    .option("--password <password>", "Password")
    .option("--api-url <url>", "API server URL", "http://localhost:4000")
    .action(async (options) => {
      try {
        const apiUrl = options.apiUrl || loadConfig().apiUrl;

        console.log("\n  🏰 GuildServer Login\n");

        // Check API connectivity
        try {
          const res = await fetch(`${apiUrl}/health`);
          if (!res.ok) throw new Error("unhealthy");
        } catch {
          console.error(`  ❌ Cannot connect to GuildServer at ${apiUrl}`);
          console.error(`  Make sure the API server is running.\n`);
          process.exit(1);
        }

        let email = options.email;
        let password = options.password;

        if (!email || !password) {
          const rl = createRL();
          if (!email) {
            email = await question(rl, "  Email: ");
          }
          if (!password) {
            password = await question(rl, "  Password: ");
          }
          rl.close();
        }

        console.log("\n  Logging in...");

        const result = await loginApi(email, password, apiUrl);

        // Save credentials
        saveConfig({
          apiUrl,
          token: result.token,
          userId: result.user?.id,
          userName: result.user?.name,
        });

        // Try to get user's organizations
        try {
          const orgs = await trpcCall("organization.list");
          if (orgs && orgs.length > 0) {
            const org = orgs[0];
            saveConfig({
              organizationId: org.id,
              organizationName: org.name,
            });
            console.log(`  ✅ Logged in as ${result.user?.name || email}`);
            console.log(`  📁 Organization: ${org.name}\n`);
          } else {
            console.log(`  ✅ Logged in as ${result.user?.name || email}\n`);
          }
        } catch {
          console.log(`  ✅ Logged in as ${result.user?.name || email}\n`);
        }
      } catch (error: any) {
        console.error(`\n  ❌ Login failed: ${error.message}\n`);
        process.exit(1);
      }
    });

  program
    .command("logout")
    .description("Log out and clear saved credentials")
    .action(() => {
      clearConfig();
      console.log("\n  ✅ Logged out successfully.\n");
    });

  program
    .command("whoami")
    .description("Display current authenticated user")
    .action(async () => {
      try {
        const config = loadConfig();
        if (!config.token) {
          console.log("\n  Not logged in. Run `guildserver login` first.\n");
          process.exit(1);
        }

        const profile = await trpcCall("auth.me");
        console.log(`\n  👤 ${profile.name || "Unknown"}`);
        console.log(`  📧 ${profile.email}`);
        if (config.organizationName) {
          console.log(`  📁 Organization: ${config.organizationName}`);
        }
        console.log(`  🔗 API: ${config.apiUrl}\n`);
      } catch (error: any) {
        console.error(`\n  ❌ ${error.message}\n`);
        process.exit(1);
      }
    });
}
