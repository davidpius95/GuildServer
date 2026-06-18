import Docker from "dockerode";
import { logger } from "../../utils/logger";
import { docker, NETWORK_NAME } from "./client";

export async function ensureNetwork(dockerClient?: Docker): Promise<void> {
  const d = dockerClient || docker;
  try {
    const network = d.getNetwork(NETWORK_NAME);
    await network.inspect();
  } catch {
    logger.info(`Creating Docker network: ${NETWORK_NAME}`);
    await d.createNetwork({
      Name: NETWORK_NAME,
      Driver: "bridge",
    });
  }
}
