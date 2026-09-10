/**
 * monitoring.diskReport covers every tenant's images and volumes on the host,
 * so only platform admins may read it.
 */
jest.mock('../../src/services/disk-report', () => ({
  buildDiskReport: jest.fn().mockResolvedValue({ mode: 'report', deletesPerformed: 0 }),
}));

import { db } from '@guildserver/database';
import { monitoringRouter } from '../../src/routers/monitoring';
import { buildDiskReport } from '../../src/services/disk-report';

const mockedBuild = buildDiskReport as jest.MockedFunction<typeof buildDiskReport>;

function ctx(overrides: { role?: 'admin' | 'user' | null; authenticated?: boolean } = {}) {
  const authenticated = overrides.authenticated ?? true;
  const user = authenticated ? { id: 'u-1', email: 'u@example.com', name: 'U', role: overrides.role ?? 'user' } : null;
  return {
    db,
    req: {} as any,
    res: {} as any,
    user,
    isAuthenticated: authenticated,
    isAdmin: user?.role === 'admin',
  } as any;
}

describe('monitoring.diskReport', () => {
  beforeEach(() => mockedBuild.mockClear());

  it('refuses an unauthenticated caller', async () => {
    await expect(monitoringRouter.createCaller(ctx({ authenticated: false })).diskReport()).rejects.toThrow(/FORBIDDEN/);
    expect(mockedBuild).not.toHaveBeenCalled();
  });

  it('refuses a signed-in user who is not a platform admin', async () => {
    // Organization owners are still not platform admins: the report spans
    // every tenant on the host.
    await expect(monitoringRouter.createCaller(ctx({ role: 'user' })).diskReport()).rejects.toThrow(/FORBIDDEN/);
    expect(mockedBuild).not.toHaveBeenCalled();
  });

  it('returns the report to a platform admin, passing policy overrides through', async () => {
    const result = await monitoringRouter.createCaller(ctx({ role: 'admin' })).diskReport({ rollbackKeepPerApp: 8 });
    expect(result).toEqual({ mode: 'report', deletesPerformed: 0 });
    expect(mockedBuild).toHaveBeenCalledWith({}, { rollbackKeepPerApp: 8 });
  });

  it('rejects policy values that would weaken rollback protection below one', async () => {
    await expect(
      monitoringRouter.createCaller(ctx({ role: 'admin' })).diskReport({ rollbackKeepPerApp: 0 }),
    ).rejects.toThrow();
    expect(mockedBuild).not.toHaveBeenCalled();
  });
});
