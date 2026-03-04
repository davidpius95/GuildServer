import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../src/services/docker', () => ({
  deployContainer: jest.fn(),
  getAppContainerInfo: jest.fn(),
  getContainerLogs: jest.fn(),
  getContainerStats: jest.fn(),
  restartContainer: jest.fn(),
  stopContainer: jest.fn(),
  removeExistingContainers: jest.fn(),
  testDockerConnection: jest.fn(),
}));

// Mock the logger to suppress output during tests
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { DockerLocalProvider } from '../../src/providers/docker-local';
import * as dockerService from '../../src/services/docker';
import type { DeployConfig } from '../../src/providers/types';

const mockedDeployContainer = dockerService.deployContainer as jest.MockedFunction<typeof dockerService.deployContainer>;
const mockedGetAppContainerInfo = dockerService.getAppContainerInfo as jest.MockedFunction<typeof dockerService.getAppContainerInfo>;
const mockedGetContainerLogs = dockerService.getContainerLogs as jest.MockedFunction<typeof dockerService.getContainerLogs>;
const mockedGetContainerStats = dockerService.getContainerStats as jest.MockedFunction<typeof dockerService.getContainerStats>;
const mockedRestartContainer = dockerService.restartContainer as jest.MockedFunction<typeof dockerService.restartContainer>;
const mockedStopContainer = dockerService.stopContainer as jest.MockedFunction<typeof dockerService.stopContainer>;
const mockedRemoveExistingContainers = dockerService.removeExistingContainers as jest.MockedFunction<typeof dockerService.removeExistingContainers>;
const mockedTestDockerConnection = dockerService.testDockerConnection as jest.MockedFunction<typeof dockerService.testDockerConnection>;

const deployConfig: DeployConfig = {
  deploymentId: 'deploy-001',
  applicationId: 'app-001',
  appName: 'test-app',
  projectId: 'proj-001',
  userId: 'user-001',
  dockerImage: 'nginx',
  dockerTag: 'latest',
  environment: { NODE_ENV: 'production' },
  memoryLimit: 512,
  cpuLimit: 1,
  containerPort: 3000,
  sourceType: 'docker',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DockerLocalProvider', () => {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('should have type "docker-local"', () => {
      const provider = new DockerLocalProvider();
      expect(provider.type).toBe('docker-local');
    });
  });

  // -------------------------------------------------------------------------
  // deploy()
  // -------------------------------------------------------------------------

  describe('deploy()', () => {
    it('should call deployContainer with mapped DeployOptions and return correct result', async () => {
      mockedDeployContainer.mockResolvedValue({
        containerId: 'abc',
        containerName: 'gs-test',
        hostPort: 8080,
        logs: ['deployed'],
      });

      const provider = new DockerLocalProvider();
      const result = await provider.deploy(deployConfig);

      expect(mockedDeployContainer).toHaveBeenCalledTimes(1);

      // Verify the options passed to deployContainer map correctly
      const calledWith = mockedDeployContainer.mock.calls[0][0];
      expect(calledWith.deploymentId).toBe('deploy-001');
      expect(calledWith.applicationId).toBe('app-001');
      expect(calledWith.appName).toBe('test-app');
      expect(calledWith.projectId).toBe('proj-001');
      expect(calledWith.userId).toBe('user-001');
      expect(calledWith.dockerImage).toBe('nginx');
      expect(calledWith.dockerTag).toBe('latest');
      expect(calledWith.environment).toEqual({ NODE_ENV: 'production' });
      expect(calledWith.memoryLimit).toBe(512);
      expect(calledWith.cpuLimit).toBe(1);
      expect(calledWith.containerPort).toBe(3000);
      expect(calledWith.sourceType).toBe('docker');

      // Verify the returned DeployResult
      expect(result.containerId).toBe('abc');
      expect(result.containerName).toBe('gs-test');
      expect(result.hostPort).toBe(8080);
      expect(result.logs).toEqual(['deployed']);
      expect(result.providerMetadata).toEqual({ provider: 'docker-local' });
    });
  });

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('should call stopContainer with the applicationId', async () => {
      mockedStopContainer.mockResolvedValue(true);

      const provider = new DockerLocalProvider();
      await provider.stop('app-1');

      expect(mockedStopContainer).toHaveBeenCalledTimes(1);
      expect(mockedStopContainer).toHaveBeenCalledWith('app-1');
    });
  });

  // -------------------------------------------------------------------------
  // restart()
  // -------------------------------------------------------------------------

  describe('restart()', () => {
    it('should call restartContainer and return true on success', async () => {
      mockedRestartContainer.mockResolvedValue(true);

      const provider = new DockerLocalProvider();
      const result = await provider.restart('app-1');

      expect(mockedRestartContainer).toHaveBeenCalledTimes(1);
      expect(mockedRestartContainer).toHaveBeenCalledWith('app-1');
      expect(result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // remove()
  // -------------------------------------------------------------------------

  describe('remove()', () => {
    it('should call removeExistingContainers with the applicationId', async () => {
      mockedRemoveExistingContainers.mockResolvedValue(undefined);

      const provider = new DockerLocalProvider();
      await provider.remove('app-1');

      expect(mockedRemoveExistingContainers).toHaveBeenCalledTimes(1);
      expect(mockedRemoveExistingContainers).toHaveBeenCalledWith('app-1');
    });
  });

  // -------------------------------------------------------------------------
  // getLogs()
  // -------------------------------------------------------------------------

  describe('getLogs()', () => {
    it('should return log lines from getContainerLogs', async () => {
      mockedGetContainerLogs.mockResolvedValue(['line1', 'line2']);

      const provider = new DockerLocalProvider();
      const result = await provider.getLogs('app-1');

      expect(mockedGetContainerLogs).toHaveBeenCalledTimes(1);
      expect(mockedGetContainerLogs).toHaveBeenCalledWith('app-1', undefined);
      expect(result).toEqual(['line1', 'line2']);
    });
  });

  // -------------------------------------------------------------------------
  // getMetrics()
  // -------------------------------------------------------------------------

  describe('getMetrics()', () => {
    it('should return mapped WorkloadMetrics from getContainerStats', async () => {
      mockedGetContainerStats.mockResolvedValue({
        cpuPercent: 5.2,
        memoryUsageMb: 128,
        memoryLimitMb: 512,
        memoryPercent: 25,
        networkRxBytes: 1000,
        networkTxBytes: 2000,
      });

      const provider = new DockerLocalProvider();
      const result = await provider.getMetrics('app-1');

      expect(result).not.toBeNull();
      expect(result!.cpuPercent).toBe(5.2);
      expect(result!.memoryUsageMb).toBe(128);
      expect(result!.memoryLimitMb).toBe(512);
      expect(result!.memoryPercent).toBe(25);
      expect(result!.networkRxBytes).toBe(1000);
      expect(result!.networkTxBytes).toBe(2000);
    });

    it('should return null when getContainerStats returns null', async () => {
      mockedGetContainerStats.mockResolvedValue(null);

      const provider = new DockerLocalProvider();
      const result = await provider.getMetrics('app-1');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getInfo()
  // -------------------------------------------------------------------------

  describe('getInfo()', () => {
    it('should return mapped WorkloadInfo from getAppContainerInfo', async () => {
      const createdDate = new Date('2025-01-15T10:00:00Z');
      mockedGetAppContainerInfo.mockResolvedValue({
        containerId: 'abc',
        containerName: 'test',
        status: 'running',
        ports: [{ hostPort: 8080, containerPort: 3000 }],
        image: 'nginx:latest',
        created: createdDate,
      });

      const provider = new DockerLocalProvider();
      const result = await provider.getInfo('app-1');

      expect(result).not.toBeNull();
      expect(result!.containerId).toBe('abc');
      expect(result!.containerName).toBe('test');
      expect(result!.status).toBe('running');
      expect(result!.ports).toEqual([{ hostPort: 8080, containerPort: 3000 }]);
      expect(result!.image).toBe('nginx:latest');
      expect(result!.created).toEqual(createdDate);
      expect(result!.providerMetadata).toEqual({ provider: 'docker-local' });
    });

    it('should return null when getAppContainerInfo returns null', async () => {
      mockedGetAppContainerInfo.mockResolvedValue(null);

      const provider = new DockerLocalProvider();
      const result = await provider.getInfo('app-1');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // healthCheck()
  // -------------------------------------------------------------------------

  describe('healthCheck()', () => {
    it('should return healthy=true for a running container', async () => {
      mockedGetAppContainerInfo.mockResolvedValue({
        containerId: 'abc',
        containerName: 'test',
        status: 'running',
        ports: [],
        image: 'nginx:latest',
        created: new Date(),
      });

      const provider = new DockerLocalProvider();
      const result = await provider.healthCheck('app-1');

      expect(result.healthy).toBe(true);
      expect(result.status).toBe('running');
      expect(result.message).toContain('running');
      expect(result.checkedAt).toBeInstanceOf(Date);
    });

    it('should return healthy=false for a stopped container', async () => {
      mockedGetAppContainerInfo.mockResolvedValue({
        containerId: 'abc',
        containerName: 'test',
        status: 'exited',
        ports: [],
        image: 'nginx:latest',
        created: new Date(),
      });

      const provider = new DockerLocalProvider();
      const result = await provider.healthCheck('app-1');

      expect(result.healthy).toBe(false);
      expect(result.status).toBe('exited');
    });

    it('should return healthy=false when no container is found', async () => {
      mockedGetAppContainerInfo.mockResolvedValue(null);

      const provider = new DockerLocalProvider();
      const result = await provider.healthCheck('app-1');

      expect(result.healthy).toBe(false);
      expect(result.status).toBe('not_found');
      expect(result.message).toBe('No container found');
    });
  });

  // -------------------------------------------------------------------------
  // testConnection()
  // -------------------------------------------------------------------------

  describe('testConnection()', () => {
    it('should return connected=true when Docker daemon is reachable', async () => {
      mockedTestDockerConnection.mockResolvedValue(true);

      const provider = new DockerLocalProvider();
      const result = await provider.testConnection();

      expect(result.connected).toBe(true);
      expect(result.message).toContain('Successfully connected');
    });

    it('should return connected=false when Docker daemon is not reachable', async () => {
      mockedTestDockerConnection.mockResolvedValue(false);

      const provider = new DockerLocalProvider();
      const result = await provider.testConnection();

      expect(result.connected).toBe(false);
      expect(result.message).toContain('Failed to connect');
    });
  });
});
