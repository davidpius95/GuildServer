/**
 * Engine readiness: a started container is not a working database.
 */
import { readinessProbe, waitForEngineReady } from '../../src/services/database-readiness';

const credentials = { databaseName: 'shop', username: 'app', password: 's3cr3t!' };

describe('readinessProbe', () => {
  it('queries the target database, not just the port, for postgresql', () => {
    const probe = readinessProbe('postgresql', credentials)!;
    expect(probe.cmd).toEqual(['psql', '--username=app', '--dbname=shop', '-tAc', 'select 1']);
    expect(probe.env).toEqual(['PGPASSWORD=s3cr3t!']);
  });

  it.each(['postgresql', 'mysql', 'mariadb', 'mongodb', 'redis'])('keeps the password out of %s argv', (type) => {
    const probe = readinessProbe(type, credentials)!;
    expect(probe.cmd.join(' ')).not.toContain(credentials.password);
    expect(probe.env.join(' ')).toContain(credentials.password);
  });

  it('has no probe for an unknown engine', () => {
    expect(readinessProbe('cassandra', credentials)).toBeNull();
  });
});

describe('waitForEngineReady', () => {
  const clock = () => {
    let time = 0;
    return { now: () => time, sleep: async (ms: number) => { time += ms; } };
  };

  it('waits through an engine that is still initialising, then reports ready', async () => {
    const exec = jest
      .fn()
      .mockResolvedValueOnce({ exitCode: 2, stdout: Buffer.from(''), stderr: 'FATAL: database "shop" does not exist' })
      .mockResolvedValueOnce({ exitCode: 2, stdout: Buffer.from(''), stderr: 'the database system is starting up' })
      .mockResolvedValue({ exitCode: 0, stdout: Buffer.from('1'), stderr: '' });
    const { now, sleep } = clock();

    await expect(
      waitForEngineReady('abc123', 'postgresql', credentials, { exec: exec as any, now, sleep, intervalMs: 1000 }),
    ).resolves.toBe(true);
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it('gives up at the timeout instead of waiting forever', async () => {
    const exec = jest.fn().mockResolvedValue({ exitCode: 1, stdout: Buffer.from(''), stderr: 'not ready' });
    const { now, sleep } = clock();

    await expect(
      waitForEngineReady('abc123', 'postgresql', credentials, { exec: exec as any, now, sleep, timeoutMs: 5_000, intervalMs: 1_000 }),
    ).resolves.toBe(false);
    expect(exec.mock.calls.length).toBeGreaterThan(1);
  });

  it('treats a container that cannot be exec-ed yet as not ready, not as an error', async () => {
    const exec = jest
      .fn()
      .mockRejectedValueOnce(new Error('container not running'))
      .mockResolvedValue({ exitCode: 0, stdout: Buffer.from('1'), stderr: '' });
    const { now, sleep } = clock();

    await expect(
      waitForEngineReady('abc123', 'postgresql', credentials, { exec: exec as any, now, sleep, intervalMs: 500 }),
    ).resolves.toBe(true);
  });

  it('reports an unknown engine ready without running anything', async () => {
    const exec = jest.fn();
    await expect(waitForEngineReady('abc123', 'cassandra', credentials, { exec: exec as any })).resolves.toBe(true);
    expect(exec).not.toHaveBeenCalled();
  });
});
