import { deploymentQueue } from "./setup";

export { deploymentQueue };

// Helper functions for deployment jobs
export async function addDeploymentJob(data: {
  deploymentId: string;
  applicationId: string;
  userId: string;
  type?: "application" | "database";
}) {
  return await deploymentQueue.add("deploy-application", data, {
    removeOnComplete: 50,
    removeOnFail: 20,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  });
}

export async function addBuildJob(data: {
  applicationId: string;
  repository: string;
  branch: string;
  commitSha?: string;
}) {
  return await deploymentQueue.add("build-application", data, {
    removeOnComplete: 30,
    removeOnFail: 10,
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  });
}