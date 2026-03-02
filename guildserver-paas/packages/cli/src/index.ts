#!/usr/bin/env node

import { Command } from "commander";
import { registerLoginCommand } from "./commands/login";
import { registerDeployCommand } from "./commands/deploy";
import { registerAppsCommand } from "./commands/apps";
import { registerEnvCommand } from "./commands/env";
import { registerLogsCommand } from "./commands/logs";
import { registerStatusCommand } from "./commands/status";

const program = new Command();

program
  .name("guildserver")
  .description("GuildServer CLI - Deploy and manage applications from your terminal")
  .version("1.0.0")
  .option("--api-url <url>", "Override API server URL");

// Register all commands
registerLoginCommand(program);
registerDeployCommand(program);
registerAppsCommand(program);
registerEnvCommand(program);
registerLogsCommand(program);
registerStatusCommand(program);

// Parse and execute
program.parseAsync(process.argv).catch((err) => {
  console.error(`\n  ❌ ${err.message}\n`);
  process.exit(1);
});
