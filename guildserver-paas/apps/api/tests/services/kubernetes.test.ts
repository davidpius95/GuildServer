import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { kubernetesService } from '../../src/services/kubernetes';

describe('KubernetesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('connectCluster', () => {
    it('should successfully connect to a Kubernetes cluster', async () => {
      const config = {
        name: 'test-cluster',
        endpoint: 'https://k8s.example.com',
        token: 'test-token',
      };

      const cluster = await kubernetesService.connectCluster(config);

      expect(cluster).toMatchObject({
        name: config.name,
        endpoint: config.endpoint,
        status: 'connected',
        nodeCount: 3,
      });
      expect(cluster.id).toBeDefined();
      expect(cluster.version).toBeDefined();
    });

    it('should handle connection errors gracefully', async () => {
      const invalidConfig = {
        name: '',
        endpoint: 'invalid-url',
      };

      await expect(kubernetesService.connectCluster(invalidConfig))
        .rejects.toThrow('Failed to connect to Kubernetes cluster');
    });
  });

  describe('deployApplication', () => {
    it('should deploy an application to a connected cluster', async () => {
      // First connect a cluster
      const cluster = await kubernetesService.connectCluster({
        name: 'test-cluster',
        endpoint: 'https://k8s.example.com',
      });

      const deployment = await kubernetesService.deployApplication(cluster.id, {
        name: 'test-app',
        namespace: 'default',
        image: 'nginx:latest',
        replicas: 2,
      });

      expect(deployment).toMatchObject({
        name: 'test-app',
        namespace: 'default',
        image: 'nginx:latest',
        replicas: 2,
        status: 'pending',
      });
      expect(deployment.id).toBeDefined();
      expect(deployment.createdAt).toBeInstanceOf(Date);
    });

    it('should fail to deploy to non-existent cluster', async () => {
      await expect(kubernetesService.deployApplication('non-existent-cluster', {
        name: 'test-app',
        namespace: 'default',
        image: 'nginx:latest',
      })).rejects.toThrow('Cluster not found');
    });

    it('should fail to deploy to disconnected cluster', async () => {
      const cluster = await kubernetesService.connectCluster({
        name: 'test-cluster',
        endpoint: 'https://k8s.example.com',
      });

      await kubernetesService.disconnectCluster(cluster.id);

      await expect(kubernetesService.deployApplication(cluster.id, {
        name: 'test-app',
        namespace: 'default',
        image: 'nginx:latest',
      })).rejects.toThrow('Cluster is not connected');
    });
  });

  describe('getClusterMetrics', () => {
    it('should return cluster metrics for connected cluster', async () => {
      const cluster = await kubernetesService.connectCluster({
        name: 'test-cluster',
        endpoint: 'https://k8s.example.com',
      });

      const metrics = await kubernetesService.getClusterMetrics(cluster.id);

      expect(metrics).toMatchObject({
        nodes: expect.any(Number),
        pods: expect.any(Number),
        services: expect.any(Number),
        cpuUsage: expect.any(Number),
        memoryUsage: expect.any(Number),
        storageUsage: expect.any(Number),
      });

      expect(metrics.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.cpuUsage).toBeLessThanOrEqual(100);
      expect(metrics.memoryUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.memoryUsage).toBeLessThanOrEqual(100);
    });

    it('should throw error for non-existent cluster', async () => {
      await expect(kubernetesService.getClusterMetrics('non-existent'))
        .rejects.toThrow('Cluster not found');
    });
  });

  describe('installHelmChart', () => {
    it('should install a Helm chart successfully', async () => {
      const cluster = await kubernetesService.connectCluster({
        name: 'test-cluster',
        endpoint: 'https://k8s.example.com',
      });

      const release = await kubernetesService.installHelmChart(cluster.id, {
        name: 'nginx-ingress',
        chart: 'ingress-nginx/ingress-nginx',
        version: '4.7.1',
        namespace: 'ingress-nginx',
        values: { replicas: 2 },
      });

      expect(release).toMatchObject({
        name: 'nginx-ingress',
        chart: 'ingress-nginx/ingress-nginx',
        version: '4.7.1',
        namespace: 'ingress-nginx',
        status: 'pending',
        values: { replicas: 2 },
      });
      expect(release.id).toBeDefined();
    });
  });

  describe('scaleDeployment', () => {
    it('should scale a deployment successfully', async () => {
      const cluster = await kubernetesService.connectCluster({
        name: 'test-cluster',
        endpoint: 'https://k8s.example.com',
      });

      const scaledDeployment = await kubernetesService.scaleDeployment(
        cluster.id,
        'test-deployment',
        5
      );

      expect(scaledDeployment.replicas).toBe(5);
      expect(scaledDeployment.status).toBe('running');
    });
  });

  describe('getClusterLogs', () => {
    it('should retrieve cluster logs', async () => {
      const cluster = await kubernetesService.connectCluster({
        name: 'test-cluster',
        endpoint: 'https://k8s.example.com',
      });

      const logs = await kubernetesService.getClusterLogs(cluster.id);

      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
      logs.forEach(log => {
        expect(typeof log).toBe('string');
        expect(log).toContain('[');
      });
    });

    it('should filter logs by options', async () => {
      const cluster = await kubernetesService.connectCluster({
        name: 'test-cluster',
        endpoint: 'https://k8s.example.com',
      });

      const logs = await kubernetesService.getClusterLogs(cluster.id, {
        namespace: 'default',
        podName: 'test-pod',
        lines: 10,
      });

      expect(Array.isArray(logs)).toBe(true);
    });
  });
});