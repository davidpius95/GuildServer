const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function deploy() {
  try {
    console.log("Connecting to server...");
    await ssh.connect({
      host: '153.67.71.124',
      port: 5555,
      username: 'usher-node',
      password: 'usher'
    });
    console.log("Connected successfully!");

    // Find the GuildServer directory
    console.log("Locating GuildServer directory...");
    const findResult = await ssh.execCommand('find ~ -maxdepth 3 -type d -name "GuildServer" | head -n 1');
    const path = findResult.stdout.trim();
    
    if (!path) {
      console.error("Could not find GuildServer directory on the remote server.");
      process.exit(1);
    }
    console.log(`Found GuildServer at: ${path}`);

    // Pull the latest code
    console.log("Pulling latest code from GitHub...");
    const pullResult = await ssh.execCommand('git pull origin feat/docker-hub-search', { cwd: path });
    console.log(pullResult.stdout);
    if (pullResult.stderr) console.error(pullResult.stderr);

    // Run docker compose
    console.log("Rebuilding and starting docker containers...");
    const composePath = `${path}/guildserver-paas`;
    const dockerResult = await ssh.execCommand('docker compose -f docker-compose.prod.yml up -d --build baas-api baas-web', { cwd: composePath });
    console.log(dockerResult.stdout);
    if (dockerResult.stderr) console.error(dockerResult.stderr);

    console.log("Deployment complete!");
  } catch (error) {
    console.error("Error during deployment:", error);
  } finally {
    ssh.dispose();
  }
}

deploy();
