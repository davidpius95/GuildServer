import { logger } from "../utils/logger";

export interface Pipeline {
  id: string;
  name: string;
  applicationId: string;
  organizationId: string;
  repository: {
    provider: "github" | "gitlab" | "bitbucket";
    url: string;
    branch: string;
    token?: string;
  };
  stages: PipelineStage[];
  triggers: PipelineTrigger[];
  environment: Record<string, string>;
  status: "active" | "paused" | "disabled";
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineStage {
  id: string;
  name: string;
  type: "build" | "test" | "deploy" | "approval" | "custom";
  order: number;
  configuration: Record<string, any>;
  conditions?: {
    onSuccess?: boolean;
    onFailure?: boolean;
    manual?: boolean;
  };
}

export interface PipelineTrigger {
  id: string;
  type: "push" | "pull_request" | "schedule" | "manual";
  configuration: {
    branches?: string[];
    schedule?: string; // cron expression
    paths?: string[];
  };
  enabled: boolean;
}

export interface PipelineExecution {
  id: string;
  pipelineId: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled" | "waiting_approval";
  trigger: {
    type: string;
    source: string;
    commit?: {
      sha: string;
      message: string;
      author: string;
    };
  };
  stages: StageExecution[];
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  logs: string[];
}

export interface StageExecution {
  id: string;
  stageId: string;
  name: string;
  status: "pending" | "running" | "success" | "failed" | "skipped" | "waiting_approval";
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  logs: string[];
  artifacts?: string[];
}

export interface DeploymentStrategy {
  type: "rolling" | "blue_green" | "canary" | "recreate";
  configuration: {
    maxUnavailable?: string;
    maxSurge?: string;
    canaryWeight?: number;
    canaryDuration?: number;
    autoPromote?: boolean;
  };
}

class CICDService {
  private pipelines: Map<string, Pipeline> = new Map();
  private executions: Map<string, PipelineExecution> = new Map();

  async createPipeline(config: {
    name: string;
    applicationId: string;
    organizationId: string;
    repository: Pipeline["repository"];
    stages: Omit<PipelineStage, "id">[];
    triggers: Omit<PipelineTrigger, "id">[];
    environment?: Record<string, string>;
  }): Promise<Pipeline> {
    const pipeline: Pipeline = {
      id: `pipeline-${Date.now()}`,
      name: config.name,
      applicationId: config.applicationId,
      organizationId: config.organizationId,
      repository: config.repository,
      stages: config.stages.map((stage, index) => ({
        ...stage,
        id: `stage-${Date.now()}-${index}`,
      })),
      triggers: config.triggers.map((trigger, index) => ({
        ...trigger,
        id: `trigger-${Date.now()}-${index}`,
      })),
      environment: config.environment || {},
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.pipelines.set(pipeline.id, pipeline);
    logger.info("CI/CD pipeline created", { pipelineId: pipeline.id, applicationId: config.applicationId });

    return pipeline;
  }

  async getPipelines(organizationId: string): Promise<Pipeline[]> {
    return Array.from(this.pipelines.values()).filter(
      pipeline => pipeline.organizationId === organizationId
    );
  }

  async getPipeline(pipelineId: string): Promise<Pipeline | null> {
    return this.pipelines.get(pipelineId) || null;
  }

  async updatePipeline(pipelineId: string, updates: Partial<Pipeline>): Promise<Pipeline> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error("Pipeline not found");
    }

    Object.assign(pipeline, updates, { updatedAt: new Date() });
    logger.info("CI/CD pipeline updated", { pipelineId });

    return pipeline;
  }

  async deletePipeline(pipelineId: string): Promise<void> {
    const deleted = this.pipelines.delete(pipelineId);
    if (!deleted) {
      throw new Error("Pipeline not found");
    }

    logger.info("CI/CD pipeline deleted", { pipelineId });
  }

  async triggerPipeline(pipelineId: string, trigger: {
    type: string;
    source: string;
    commit?: {
      sha: string;
      message: string;
      author: string;
    };
  }): Promise<PipelineExecution> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error("Pipeline not found");
    }

    if (pipeline.status !== "active") {
      throw new Error("Pipeline is not active");
    }

    const execution: PipelineExecution = {
      id: `execution-${Date.now()}`,
      pipelineId,
      status: "queued",
      trigger,
      stages: pipeline.stages.map(stage => ({
        id: `stage-exec-${Date.now()}-${stage.id}`,
        stageId: stage.id,
        name: stage.name,
        status: "pending",
        logs: [],
      })),
      startedAt: new Date(),
      logs: [`Pipeline execution started: ${execution.id}`],
    };

    this.executions.set(execution.id, execution);
    logger.info("Pipeline execution triggered", { pipelineId, executionId: execution.id });

    // Start execution asynchronously
    this.executePipeline(execution.id);

    return execution;
  }

  private async executePipeline(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      return;
    }

    const pipeline = this.pipelines.get(execution.pipelineId);
    if (!pipeline) {
      return;
    }

    try {
      execution.status = "running";
      execution.logs.push("Pipeline execution started");

      for (const stageExecution of execution.stages) {
        const stage = pipeline.stages.find(s => s.id === stageExecution.stageId);
        if (!stage) {
          continue;
        }

        // Check stage conditions
        if (stage.conditions?.manual) {
          stageExecution.status = "waiting_approval";
          execution.status = "waiting_approval";
          execution.logs.push(`Stage ${stage.name} waiting for manual approval`);
          return; // Wait for manual approval
        }

        stageExecution.status = "running";
        stageExecution.startedAt = new Date();
        execution.logs.push(`Starting stage: ${stage.name}`);

        await this.executeStage(stage, stageExecution);

        stageExecution.completedAt = new Date();
        stageExecution.duration = stageExecution.completedAt.getTime() - (stageExecution.startedAt?.getTime() || 0);

        if (stageExecution.status === "failed") {
          execution.status = "failed";
          execution.logs.push(`Pipeline failed at stage: ${stage.name}`);
          break;
        }

        execution.logs.push(`Stage completed: ${stage.name}`);
      }

      if (execution.status === "running") {
        execution.status = "success";
        execution.logs.push("Pipeline execution completed successfully");
      }

    } catch (error) {
      execution.status = "failed";
      execution.logs.push(`Pipeline execution failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      logger.error("Pipeline execution failed", { executionId, error });
    } finally {
      execution.completedAt = new Date();
      execution.duration = execution.completedAt.getTime() - execution.startedAt.getTime();
    }
  }

  private async executeStage(stage: PipelineStage, stageExecution: StageExecution): Promise<void> {
    stageExecution.logs.push(`Executing stage: ${stage.name}`);

    try {
      switch (stage.type) {
        case "build":
          await this.executeBuildStage(stage, stageExecution);
          break;
        case "test":
          await this.executeTestStage(stage, stageExecution);
          break;
        case "deploy":
          await this.executeDeployStage(stage, stageExecution);
          break;
        case "custom":
          await this.executeCustomStage(stage, stageExecution);
          break;
        default:
          throw new Error(`Unknown stage type: ${stage.type}`);
      }

      stageExecution.status = "success";
    } catch (error) {
      stageExecution.status = "failed";
      stageExecution.logs.push(`Stage failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      throw error;
    }
  }

  private async executeBuildStage(stage: PipelineStage, stageExecution: StageExecution): Promise<void> {
    stageExecution.logs.push("Starting build process...");
    
    // Simulate build process
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    stageExecution.logs.push("Building Docker image...");
    stageExecution.logs.push("Image built successfully: registry.guildserver.com/app:latest");
    stageExecution.artifacts = ["registry.guildserver.com/app:latest"];
  }

  private async executeTestStage(stage: PipelineStage, stageExecution: StageExecution): Promise<void> {
    stageExecution.logs.push("Running tests...");
    
    // Simulate test execution
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    stageExecution.logs.push("Unit tests: 45 passed, 0 failed");
    stageExecution.logs.push("Integration tests: 12 passed, 0 failed");
    stageExecution.logs.push("All tests passed");
  }

  private async executeDeployStage(stage: PipelineStage, stageExecution: StageExecution): Promise<void> {
    const environment = stage.configuration.environment || "staging";
    const strategy = stage.configuration.strategy || "rolling";

    stageExecution.logs.push(`Deploying to ${environment} environment using ${strategy} strategy...`);
    
    // Simulate deployment
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    stageExecution.logs.push("Deployment successful");
    stageExecution.logs.push(`Application available at: https://${environment}.app.com`);
  }

  private async executeCustomStage(stage: PipelineStage, stageExecution: StageExecution): Promise<void> {
    const script = stage.configuration.script;
    if (!script) {
      throw new Error("Custom stage requires a script configuration");
    }

    stageExecution.logs.push(`Executing custom script: ${script}`);
    
    // Simulate custom script execution
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    stageExecution.logs.push("Custom script executed successfully");
  }

  async getExecutions(pipelineId: string): Promise<PipelineExecution[]> {
    return Array.from(this.executions.values())
      .filter(execution => execution.pipelineId === pipelineId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  async getExecution(executionId: string): Promise<PipelineExecution | null> {
    return this.executions.get(executionId) || null;
  }

  async cancelExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error("Execution not found");
    }

    if (execution.status !== "running" && execution.status !== "queued") {
      throw new Error("Cannot cancel execution in current state");
    }

    execution.status = "cancelled";
    execution.completedAt = new Date();
    execution.logs.push("Pipeline execution cancelled");

    logger.info("Pipeline execution cancelled", { executionId });
  }

  async approveStage(executionId: string, stageId: string, approver: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error("Execution not found");
    }

    const stageExecution = execution.stages.find(s => s.stageId === stageId);
    if (!stageExecution) {
      throw new Error("Stage not found");
    }

    if (stageExecution.status !== "waiting_approval") {
      throw new Error("Stage is not waiting for approval");
    }

    stageExecution.status = "pending";
    execution.status = "running";
    execution.logs.push(`Stage ${stageExecution.name} approved by ${approver}`);

    logger.info("Pipeline stage approved", { executionId, stageId, approver });

    // Continue pipeline execution
    this.executePipeline(executionId);
  }

  async rejectStage(executionId: string, stageId: string, approver: string, reason?: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error("Execution not found");
    }

    const stageExecution = execution.stages.find(s => s.stageId === stageId);
    if (!stageExecution) {
      throw new Error("Stage not found");
    }

    if (stageExecution.status !== "waiting_approval") {
      throw new Error("Stage is not waiting for approval");
    }

    stageExecution.status = "failed";
    execution.status = "failed";
    execution.completedAt = new Date();
    execution.logs.push(`Stage ${stageExecution.name} rejected by ${approver}${reason ? `: ${reason}` : ""}`);

    logger.info("Pipeline stage rejected", { executionId, stageId, approver, reason });
  }

  async retryExecution(executionId: string): Promise<PipelineExecution> {
    const originalExecution = this.executions.get(executionId);
    if (!originalExecution) {
      throw new Error("Original execution not found");
    }

    const pipeline = this.pipelines.get(originalExecution.pipelineId);
    if (!pipeline) {
      throw new Error("Pipeline not found");
    }

    // Create new execution based on original
    const newExecution = await this.triggerPipeline(pipeline.id, originalExecution.trigger);
    
    logger.info("Pipeline execution retried", { originalExecutionId: executionId, newExecutionId: newExecution.id });

    return newExecution;
  }

  async getExecutionLogs(executionId: string, stageId?: string): Promise<string[]> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error("Execution not found");
    }

    if (stageId) {
      const stageExecution = execution.stages.find(s => s.stageId === stageId);
      return stageExecution?.logs || [];
    }

    return execution.logs;
  }

  async getPipelineMetrics(pipelineId: string, days: number = 30): Promise<{
    totalExecutions: number;
    successRate: number;
    averageDuration: number;
    failureReasons: { reason: string; count: number }[];
    executionTrend: { date: string; success: number; failed: number }[];
  }> {
    const executions = await this.getExecutions(pipelineId);
    const recentExecutions = executions.filter(
      e => e.startedAt >= new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    );

    const totalExecutions = recentExecutions.length;
    const successfulExecutions = recentExecutions.filter(e => e.status === "success").length;
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

    const completedExecutions = recentExecutions.filter(e => e.duration);
    const averageDuration = completedExecutions.length > 0
      ? completedExecutions.reduce((sum, e) => sum + (e.duration || 0), 0) / completedExecutions.length
      : 0;

    // Mock failure reasons and trend data
    const failureReasons = [
      { reason: "Build failed", count: 3 },
      { reason: "Tests failed", count: 2 },
      { reason: "Deployment timeout", count: 1 },
    ];

    const executionTrend = Array.from({ length: days }, (_, i) => {
      const date = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000);
      return {
        date: date.toISOString().split('T')[0],
        success: Math.floor(Math.random() * 5),
        failed: Math.floor(Math.random() * 2),
      };
    });

    return {
      totalExecutions,
      successRate: Math.round(successRate),
      averageDuration: Math.round(averageDuration / 1000), // Convert to seconds
      failureReasons,
      executionTrend,
    };
  }

  // Git webhook handlers
  async handleGitWebhook(payload: {
    provider: "github" | "gitlab" | "bitbucket";
    event: string;
    repository: string;
    branch: string;
    commit?: {
      sha: string;
      message: string;
      author: string;
    };
  }): Promise<PipelineExecution[]> {
    const triggeredExecutions: PipelineExecution[] = [];

    // Find pipelines that match this repository and have relevant triggers
    const matchingPipelines = Array.from(this.pipelines.values()).filter(pipeline => 
      pipeline.repository.url === payload.repository &&
      pipeline.status === "active" &&
      pipeline.triggers.some(trigger => 
        trigger.enabled &&
        (trigger.type === "push" && payload.event === "push") &&
        (!trigger.configuration.branches || trigger.configuration.branches.includes(payload.branch))
      )
    );

    for (const pipeline of matchingPipelines) {
      try {
        const execution = await this.triggerPipeline(pipeline.id, {
          type: payload.event,
          source: "webhook",
          commit: payload.commit,
        });
        triggeredExecutions.push(execution);
      } catch (error) {
        logger.error("Failed to trigger pipeline from webhook", { 
          pipelineId: pipeline.id, 
          error 
        });
      }
    }

    return triggeredExecutions;
  }
}

export const cicdService = new CICDService();