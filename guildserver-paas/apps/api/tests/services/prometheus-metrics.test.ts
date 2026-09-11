/**
 * The metrics module must survive being evaluated twice in one process, which
 * tsx does when a module is loaded by both a static and a dynamic import.
 */
import client from 'prom-client';

describe('prometheus metrics', () => {
  it('can be loaded twice without throwing, sharing one registry and one set of metrics', () => {
    let first: typeof import('../../src/services/prometheus-metrics') | undefined;
    let second: typeof import('../../src/services/prometheus-metrics') | undefined;
    jest.isolateModules(() => {
      first = require('../../src/services/prometheus-metrics');
    });
    expect(() =>
      jest.isolateModules(() => {
        second = require('../../src/services/prometheus-metrics');
      }),
    ).not.toThrow();

    expect(second!.register).toBe(first!.register);
    expect(second!.signupsTotal).toBe(first!.signupsTotal);
  });

  it('keeps its metrics out of prom-client\'s global registry', () => {
    jest.isolateModules(() => {
      require('../../src/services/prometheus-metrics');
    });
    expect(client.register.getSingleMetric('guildserver_signups_total')).toBeUndefined();
  });

  it('exposes every custom metric on its registry', async () => {
    const { register, signupsTotal } = require('../../src/services/prometheus-metrics');
    signupsTotal.inc({ provider: 'email' });
    const text = await register.metrics();
    for (const name of [
      'guildserver_deployments_total',
      'guildserver_deployment_duration_seconds',
      'guildserver_queue_depth',
      'guildserver_webhook_deliveries_total',
      'guildserver_api_requests_total',
      'guildserver_api_request_duration_seconds',
      'guildserver_signups_total',
      'guildserver_active_repositories',
    ]) {
      expect(text).toContain(`# TYPE ${name}`);
    }
    expect(text).toMatch(/guildserver_signups_total\{provider="email"\} [1-9]/);
  });
});
