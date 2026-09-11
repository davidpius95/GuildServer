/**
 * Metrics retention against the real test database.
 */
jest.mock('../../src/services/container-manager', () => ({
  collectAllMetrics: jest.fn(),
  getContainerSummary: jest.fn(),
}));
jest.mock('../../src/websocket/server', () => ({ broadcastToAll: jest.fn() }));

import { db, metrics } from '@guildserver/database';
import { eq } from 'drizzle-orm';
import {
  cleanupOldMetrics,
  metricsRetentionDays,
  DEFAULT_METRICS_RETENTION_DAYS,
} from '../../src/services/metrics-collector';

const DAY = 24 * 60 * 60 * 1000;

describe('metricsRetentionDays', () => {
  it('defaults to the longest range the dashboards query', () => {
    expect(DEFAULT_METRICS_RETENTION_DAYS).toBe(30);
    expect(metricsRetentionDays({})).toBe(30);
  });

  it('accepts a whole number of days and ignores anything else', () => {
    expect(metricsRetentionDays({ METRICS_RETENTION_DAYS: '90' })).toBe(90);
    for (const bad of ['0', '-5', '1.5', 'forever', '']) {
      expect(metricsRetentionDays({ METRICS_RETENTION_DAYS: bad })).toBe(30);
    }
  });
});

describe('cleanupOldMetrics', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const name = `retention-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    const ages = [45, 40, 40, 35, 31, 30.5, 29, 10, 0];
    await db.insert(metrics).values(
      ages.map((days, i) => ({
        name,
        type: 'gauge',
        value: String(i),
        labels: { days },
        timestamp: new Date(now.getTime() - days * DAY),
      })),
    );
  });

  afterAll(async () => {
    await db.delete(metrics).where(eq(metrics.name, name));
  });

  it('deletes rows past the window in batches and keeps the rest', async () => {
    const removed = await cleanupOldMetrics(30, { batchSize: 2, now });
    expect(removed).toBeGreaterThanOrEqual(6);

    const left = await db.query.metrics.findMany({ where: eq(metrics.name, name) });
    const ages = left.map((row) => (row.labels as { days: number }).days).sort((a, b) => a - b);
    expect(ages).toEqual([0, 10, 29]);
  });

  it('removes nothing more on a second run', async () => {
    await cleanupOldMetrics(30, { batchSize: 2, now });
    const left = await db.query.metrics.findMany({ where: eq(metrics.name, name) });
    expect(left).toHaveLength(3);
  });
});
