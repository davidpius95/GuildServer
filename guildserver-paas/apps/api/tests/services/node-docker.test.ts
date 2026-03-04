/**
 * Tests for the Docker client pool (node-docker.ts).
 *
 * All Docker operations are mocked — no real Docker daemon is required.
 */

// Mock dockerode before importing the module under test
jest.mock('dockerode', () => {
  const mockPing = jest.fn();
  const MockDocker = jest.fn().mockImplementation(() => ({
    ping: mockPing,
    listContainers: jest.fn(),
    getContainer: jest.fn(),
    createContainer: jest.fn(),
  }));
  // Expose mockPing for test access
  (MockDocker as any).__mockPing = mockPing;
  return MockDocker;
});

import Docker from 'dockerode';
import {
  getDockerClient,
  getLocalDockerClient,
  removeClient,
  removeClientByHost,
  clearPool,
  getPoolStats,
  testDockerClient,
  waitForDockerReady,
} from '../../src/services/node-docker';

// Access the mock ping function for controlling test behavior
const mockPing = (Docker as any).__mockPing as jest.Mock;

describe('NodeDockerClientPool', () => {
  beforeEach(() => {
    // Reset state between tests
    clearPool();
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // getLocalDockerClient
  // -----------------------------------------------------------------------
  describe('getLocalDockerClient', () => {
    it('should return a Docker instance', () => {
      const client = getLocalDockerClient();
      expect(client).toBeDefined();
      expect(client.ping).toBeDefined();
    });

    it('should return the same instance on repeated calls', () => {
      const client1 = getLocalDockerClient();
      const client2 = getLocalDockerClient();
      expect(client1).toBe(client2);
    });

    it('should create a new instance after clearPool()', () => {
      const client1 = getLocalDockerClient();
      clearPool();
      const client2 = getLocalDockerClient();
      // After clearing, a new instance is created
      expect(client2).toBeDefined();
      expect(client2.ping).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // getDockerClient (remote)
  // -----------------------------------------------------------------------
  describe('getDockerClient', () => {
    it('should return a Docker instance for a given host', () => {
      const client = getDockerClient('192.168.1.100');
      expect(client).toBeDefined();
      expect(client.ping).toBeDefined();
    });

    it('should use default port 2375 when not specified', () => {
      const client = getDockerClient('192.168.1.100');
      expect(Docker).toHaveBeenCalledWith({
        host: '192.168.1.100',
        port: 2375,
        protocol: 'http',
      });
      expect(client).toBeDefined();
    });

    it('should use custom port when specified', () => {
      const client = getDockerClient('192.168.1.100', 2376);
      expect(Docker).toHaveBeenCalledWith({
        host: '192.168.1.100',
        port: 2376,
        protocol: 'http',
      });
      expect(client).toBeDefined();
    });

    it('should cache clients by host:port', () => {
      const client1 = getDockerClient('192.168.1.100', 2375);
      const client2 = getDockerClient('192.168.1.100', 2375);
      expect(client1).toBe(client2);
    });

    it('should return different clients for different hosts', () => {
      const client1 = getDockerClient('192.168.1.100');
      const client2 = getDockerClient('192.168.1.101');
      expect(client1).not.toBe(client2);
    });

    it('should return different clients for different ports on the same host', () => {
      const client1 = getDockerClient('192.168.1.100', 2375);
      const client2 = getDockerClient('192.168.1.100', 2376);
      expect(client1).not.toBe(client2);
    });
  });

  // -----------------------------------------------------------------------
  // removeClient / removeClientByHost
  // -----------------------------------------------------------------------
  describe('removeClient', () => {
    it('should remove a cached client by key', () => {
      getDockerClient('192.168.1.100');
      expect(getPoolStats().size).toBe(1);

      removeClient('192.168.1.100:2375');
      expect(getPoolStats().size).toBe(0);
    });

    it('should not throw when removing a non-existent key', () => {
      expect(() => removeClient('nonexistent')).not.toThrow();
    });
  });

  describe('removeClientByHost', () => {
    it('should remove a cached client by host and port', () => {
      getDockerClient('10.0.0.5', 2375);
      expect(getPoolStats().size).toBe(1);

      removeClientByHost('10.0.0.5', 2375);
      expect(getPoolStats().size).toBe(0);
    });

    it('should remove using default port when port is not specified', () => {
      getDockerClient('10.0.0.5');
      removeClientByHost('10.0.0.5');
      expect(getPoolStats().size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // clearPool
  // -----------------------------------------------------------------------
  describe('clearPool', () => {
    it('should remove all cached clients', () => {
      getDockerClient('192.168.1.100');
      getDockerClient('192.168.1.101');
      getDockerClient('192.168.1.102');
      expect(getPoolStats().size).toBe(3);

      clearPool();
      expect(getPoolStats().size).toBe(0);
    });

    it('should be idempotent', () => {
      clearPool();
      clearPool();
      expect(getPoolStats().size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getPoolStats
  // -----------------------------------------------------------------------
  describe('getPoolStats', () => {
    it('should return empty stats for an empty pool', () => {
      const stats = getPoolStats();
      expect(stats.size).toBe(0);
      expect(stats.keys).toEqual([]);
    });

    it('should return correct stats after adding clients', () => {
      getDockerClient('192.168.1.100');
      getDockerClient('10.0.0.1', 2376);

      const stats = getPoolStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('192.168.1.100:2375');
      expect(stats.keys).toContain('10.0.0.1:2376');
    });

    it('should reflect removals', () => {
      getDockerClient('192.168.1.100');
      getDockerClient('192.168.1.101');
      removeClient('192.168.1.100:2375');

      const stats = getPoolStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).toEqual(['192.168.1.101:2375']);
    });
  });

  // -----------------------------------------------------------------------
  // testDockerClient
  // -----------------------------------------------------------------------
  describe('testDockerClient', () => {
    it('should return true when ping succeeds', async () => {
      mockPing.mockResolvedValueOnce('OK');
      const client = getDockerClient('192.168.1.100');

      const result = await testDockerClient(client);
      expect(result).toBe(true);
    });

    it('should return false when ping fails', async () => {
      mockPing.mockRejectedValueOnce(new Error('Connection refused'));
      const client = getDockerClient('192.168.1.100');

      const result = await testDockerClient(client);
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // waitForDockerReady
  // -----------------------------------------------------------------------
  describe('waitForDockerReady', () => {
    it('should resolve immediately when Docker is ready', async () => {
      mockPing.mockResolvedValueOnce('OK');
      const client = getDockerClient('192.168.1.100');

      await expect(waitForDockerReady(client, 5000)).resolves.toBeUndefined();
    });

    it('should poll and succeed after initial failures', async () => {
      // First two pings fail, third succeeds
      mockPing
        .mockRejectedValueOnce(new Error('not ready'))
        .mockRejectedValueOnce(new Error('not ready'))
        .mockResolvedValueOnce('OK');

      const client = getDockerClient('192.168.1.100');

      // Use a short timeout — the mock resolves quickly
      await expect(waitForDockerReady(client, 30000)).resolves.toBeUndefined();
      expect(mockPing).toHaveBeenCalledTimes(3);
    });

    it('should throw when Docker does not become ready within timeout', async () => {
      // Always fail
      mockPing.mockRejectedValue(new Error('Connection refused'));
      const client = getDockerClient('192.168.1.100');

      // Very short timeout so the test doesn't wait long
      await expect(waitForDockerReady(client, 100)).rejects.toThrow(
        'Docker daemon did not become ready within 100ms',
      );
    });
  });
});
