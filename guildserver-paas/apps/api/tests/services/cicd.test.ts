import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { cicdService } from '../../src/services/cicd';

describe('CICDService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createPipeline', () => {
    it('should create a new CI/CD pipeline', async () => {
      const config = {
        name: 'Test Pipeline',
        applicationId: 'app-123',
        organizationId: 'org-123',
        repository: {
          provider: 'github' as const,
          url: 'https://github.com/test/repo',
          branch: 'main',
        },
        stages: [
          {
            name: 'Build',
            type: 'build' as const,
            order: 1,
            configuration: {},
          },
          {
            name: 'Test',
            type: 'test' as const,
            order: 2,
            configuration: {},
          },
        ],
        triggers: [
          {
            type: 'push' as const,
            configuration: { branches: ['main'] },
            enabled: true,
          },
        ],
      };

      const pipeline = await cicdService.createPipeline(config);

      expect(pipeline).toMatchObject({
        name: config.name,
        applicationId: config.applicationId,
        organizationId: config.organizationId,
        repository: config.repository,
        status: 'active',
      });
      expect(pipeline.id).toBeDefined();
      expect(pipeline.stages).toHaveLength(2);
      expect(pipeline.triggers).toHaveLength(1);
      expect(pipeline.createdAt).toBeInstanceOf(Date);
    });

    it('should assign unique IDs to stages and triggers', async () => {
      const config = {
        name: 'Test Pipeline',
        applicationId: 'app-123',
        organizationId: 'org-123',
        repository: {
          provider: 'github' as const,
          url: 'https://github.com/test/repo',
          branch: 'main',
        },
        stages: [
          { name: 'Build', type: 'build' as const, order: 1, configuration: {} },
          { name: 'Deploy', type: 'deploy' as const, order: 2, configuration: {} },
        ],
        triggers: [
          { type: 'push' as const, configuration: {}, enabled: true },
        ],
      };

      const pipeline = await cicdService.createPipeline(config);

      expect(pipeline.stages[0].id).toBeDefined();
      expect(pipeline.stages[1].id).toBeDefined();
      expect(pipeline.stages[0].id).not.toBe(pipeline.stages[1].id);
      expect(pipeline.triggers[0].id).toBeDefined();
    });
  });

  describe('triggerPipeline', () => {
    it('should trigger a pipeline execution', async () => {
      const pipeline = await cicdService.createPipeline({
        name: 'Test Pipeline',
        applicationId: 'app-123',
        organizationId: 'org-123',
        repository: {
          provider: 'github' as const,
          url: 'https://github.com/test/repo',
          branch: 'main',
        },
        stages: [
          { name: 'Build', type: 'build' as const, order: 1, configuration: {} },
        ],
        triggers: [
          { type: 'push' as const, configuration: {}, enabled: true },
        ],
      });

      const execution = await cicdService.triggerPipeline(pipeline.id, {
        type: 'push',
        source: 'webhook',
        commit: {
          sha: 'abc123',
          message: 'Test commit',
          author: 'test@example.com',
        },
      });

      expect(execution).toMatchObject({
        pipelineId: pipeline.id,
        status: 'queued',
        trigger: {
          type: 'push',
          source: 'webhook',
          commit: {
            sha: 'abc123',
            message: 'Test commit',
            author: 'test@example.com',
          },
        },
      });
      expect(execution.id).toBeDefined();
      expect(execution.stages).toHaveLength(1);
      expect(execution.startedAt).toBeInstanceOf(Date);
    });

    it('should not trigger inactive pipeline', async () => {
      const pipeline = await cicdService.createPipeline({
        name: 'Test Pipeline',
        applicationId: 'app-123',
        organizationId: 'org-123',
        repository: {
          provider: 'github' as const,
          url: 'https://github.com/test/repo',
          branch: 'main',
        },
        stages: [],
        triggers: [],
      });

      await cicdService.updatePipeline(pipeline.id, { status: 'paused' });

      await expect(cicdService.triggerPipeline(pipeline.id, {
        type: 'push',
        source: 'manual',
      })).rejects.toThrow('Pipeline is not active');
    });
  });

  describe('getPipelineMetrics', () => {
    it('should return pipeline metrics', async () => {
      const pipeline = await cicdService.createPipeline({
        name: 'Test Pipeline',
        applicationId: 'app-123',
        organizationId: 'org-123',
        repository: {
          provider: 'github' as const,
          url: 'https://github.com/test/repo',
          branch: 'main',
        },
        stages: [
          { name: 'Build', type: 'build' as const, order: 1, configuration: {} },
        ],
        triggers: [],
      });

      const metrics = await cicdService.getPipelineMetrics(pipeline.id, 30);

      expect(metrics).toMatchObject({
        totalExecutions: expect.any(Number),
        successRate: expect.any(Number),
        averageDuration: expect.any(Number),
        failureReasons: expect.any(Array),
        executionTrend: expect.any(Array),
      });

      expect(metrics.successRate).toBeGreaterThanOrEqual(0);
      expect(metrics.successRate).toBeLessThanOrEqual(100);
      expect(metrics.executionTrend).toHaveLength(30);
    });
  });

  describe('handleGitWebhook', () => {
    it('should trigger matching pipelines from webhook', async () => {
      const repoUrl = 'https://github.com/test/repo';
      
      await cicdService.createPipeline({
        name: 'Pipeline 1',
        applicationId: 'app-1',
        organizationId: 'org-123',
        repository: {
          provider: 'github',
          url: repoUrl,
          branch: 'main',
        },
        stages: [
          { name: 'Build', type: 'build' as const, order: 1, configuration: {} },
        ],
        triggers: [
          {
            type: 'push' as const,
            configuration: { branches: ['main'] },
            enabled: true,
          },
        ],
      });

      await cicdService.createPipeline({
        name: 'Pipeline 2',
        applicationId: 'app-2',
        organizationId: 'org-123',
        repository: {
          provider: 'github',
          url: repoUrl,
          branch: 'develop',
        },
        stages: [
          { name: 'Build', type: 'build' as const, order: 1, configuration: {} },
        ],
        triggers: [
          {
            type: 'push' as const,
            configuration: { branches: ['develop'] },
            enabled: true,
          },
        ],
      });

      const executions = await cicdService.handleGitWebhook({
        provider: 'github',
        event: 'push',
        repository: repoUrl,
        branch: 'main',
        commit: {
          sha: 'abc123',
          message: 'Test commit',
          author: 'test@example.com',
        },
      });

      expect(executions).toHaveLength(1);
      expect(executions[0].trigger.source).toBe('webhook');
    });

    it('should not trigger pipelines for non-matching branches', async () => {
      const repoUrl = 'https://github.com/test/repo';
      
      await cicdService.createPipeline({
        name: 'Main Pipeline',
        applicationId: 'app-1',
        organizationId: 'org-123',
        repository: {
          provider: 'github',
          url: repoUrl,
          branch: 'main',
        },
        stages: [],
        triggers: [
          {
            type: 'push' as const,
            configuration: { branches: ['main'] },
            enabled: true,
          },
        ],
      });

      const executions = await cicdService.handleGitWebhook({
        provider: 'github',
        event: 'push',
        repository: repoUrl,
        branch: 'feature-branch',
      });

      expect(executions).toHaveLength(0);
    });
  });

  describe('execution management', () => {
    it('should cancel running execution', async () => {
      const pipeline = await cicdService.createPipeline({
        name: 'Test Pipeline',
        applicationId: 'app-123',
        organizationId: 'org-123',
        repository: {
          provider: 'github' as const,
          url: 'https://github.com/test/repo',
          branch: 'main',
        },
        stages: [
          { name: 'Build', type: 'build' as const, order: 1, configuration: {} },
        ],
        triggers: [],
      });

      const execution = await cicdService.triggerPipeline(pipeline.id, {
        type: 'manual',
        source: 'user',
      });

      await cicdService.cancelExecution(execution.id);

      const updatedExecution = await cicdService.getExecution(execution.id);
      expect(updatedExecution?.status).toBe('cancelled');
    });

    it('should retry failed execution', async () => {
      const pipeline = await cicdService.createPipeline({
        name: 'Test Pipeline',
        applicationId: 'app-123',
        organizationId: 'org-123',
        repository: {
          provider: 'github' as const,
          url: 'https://github.com/test/repo',
          branch: 'main',
        },
        stages: [
          { name: 'Build', type: 'build' as const, order: 1, configuration: {} },
        ],
        triggers: [],
      });

      const originalExecution = await cicdService.triggerPipeline(pipeline.id, {
        type: 'manual',
        source: 'user',
      });

      const retryExecution = await cicdService.retryExecution(originalExecution.id);

      expect(retryExecution.id).not.toBe(originalExecution.id);
      expect(retryExecution.pipelineId).toBe(pipeline.id);
      expect(retryExecution.trigger).toEqual(originalExecution.trigger);
    });
  });
});