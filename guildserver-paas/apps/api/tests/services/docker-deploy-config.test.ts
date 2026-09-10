import {
  DEFAULT_STOP_GRACE_SECONDS,
  DEFAULT_STRATEGY_WHEN_UNSET,
  HEALTH_CHECK_DEFAULTS,
  parseExpectedStatus,
  parseHealthCheckConfig,
  parseStopGracePeriod,
  readConfiguredStrategy,
  resolveDeploymentStrategy,
  traefikConvergeMs,
  TRAEFIK_CONVERGE_DEFAULT_MS,
} from '../../src/services/docker/deploy-config';

describe('parseExpectedStatus', () => {
  it('accepts a single code', () => {
    const match = parseExpectedStatus('204');
    expect(match(204)).toBe(true);
    expect(match(200)).toBe(false);
  });

  it('accepts an inclusive range', () => {
    const match = parseExpectedStatus('200-299');
    expect(match(200)).toBe(true);
    expect(match(299)).toBe(true);
    expect(match(199)).toBe(false);
    expect(match(300)).toBe(false);
  });

  it('accepts a mixed range-and-code list, the documented "200-299,401" case', () => {
    const match = parseExpectedStatus('200-299,401');
    expect(match(200)).toBe(true);
    expect(match(204)).toBe(true);
    expect(match(299)).toBe(true);
    // An authenticated app that answers 401 on its health path has demonstrably booted.
    expect(match(401)).toBe(true);
    expect(match(400)).toBe(false);
    expect(match(402)).toBe(false);
    expect(match(500)).toBe(false);
  });

  it('tolerates whitespace around tokens', () => {
    const match = parseExpectedStatus(' 200 - 299 , 401 ');
    expect(match(250)).toBe(true);
    expect(match(401)).toBe(true);
  });

  it('rejects a malformed spec rather than silently matching nothing', () => {
    // A typo that quietly matched no status would fail every deploy with a
    // confusing timeout instead of a clear configuration error.
    expect(() => parseExpectedStatus('')).toThrow(/Invalid/);
    expect(() => parseExpectedStatus('2xx')).toThrow(/Invalid/);
    expect(() => parseExpectedStatus('20')).toThrow(/Invalid/);
    expect(() => parseExpectedStatus('299-200')).toThrow(/299 > 200|> /);
  });
});

describe('parseHealthCheckConfig — NULL means legacy', () => {
  it('returns null when the row is null/undefined', () => {
    expect(parseHealthCheckConfig(null)).toBeNull();
    expect(parseHealthCheckConfig(undefined)).toBeNull();
  });

  it('returns null when every health_check_* column is NULL', () => {
    expect(
      parseHealthCheckConfig({
        health_check_path: null,
        health_check_port: null,
        health_check_interval: null,
        health_check_timeout: null,
        health_check_retries: null,
        health_check_start_period: null,
        health_check_expected_status: null,
      }),
    ).toBeNull();
  });

  it('returns null when a path is present but empty/whitespace', () => {
    expect(parseHealthCheckConfig({ health_check_path: '' })).toBeNull();
    expect(parseHealthCheckConfig({ health_check_path: '   ' })).toBeNull();
  });

  it('returns null when only the other knobs are set but no path', () => {
    // Without a path there is nothing to GET, so there is no configured check
    // and the legacy reachability probe must be used.
    expect(
      parseHealthCheckConfig({ health_check_interval: 30, health_check_retries: 9 }),
    ).toBeNull();
  });
});

describe('parseHealthCheckConfig — per-field defaults', () => {
  it('applies documented defaults for each NULL field once a path is set', () => {
    const config = parseHealthCheckConfig({ health_check_path: '/healthz' })!;
    expect(config.path).toBe('/healthz');
    expect(config.port).toBeUndefined();
    expect(config.intervalSeconds).toBe(HEALTH_CHECK_DEFAULTS.intervalSeconds);
    expect(config.timeoutSeconds).toBe(HEALTH_CHECK_DEFAULTS.timeoutSeconds);
    expect(config.retries).toBe(HEALTH_CHECK_DEFAULTS.retries);
    expect(config.startPeriodSeconds).toBe(HEALTH_CHECK_DEFAULTS.startPeriodSeconds);
    expect(config.expectedStatus).toBe(HEALTH_CHECK_DEFAULTS.expectedStatus);
    expect(config.matchesStatus(200)).toBe(true);
    expect(config.matchesStatus(404)).toBe(false);
  });

  it('reads every field when all are set', () => {
    const config = parseHealthCheckConfig({
      health_check_path: '/ready',
      health_check_port: 8080,
      health_check_interval: 15,
      health_check_timeout: 4,
      health_check_retries: 6,
      health_check_start_period: 20,
      health_check_expected_status: '200-299,401',
    })!;
    expect(config).toMatchObject({
      path: '/ready',
      port: 8080,
      intervalSeconds: 15,
      timeoutSeconds: 4,
      retries: 6,
      startPeriodSeconds: 20,
      expectedStatus: '200-299,401',
    });
    expect(config.matchesStatus(401)).toBe(true);
  });

  it('reads camelCase (drizzle) spellings too', () => {
    const config = parseHealthCheckConfig({
      healthCheckPath: '/up',
      healthCheckPort: 9000,
      healthCheckRetries: 2,
      healthCheckExpectedStatus: '204',
    })!;
    expect(config.path).toBe('/up');
    expect(config.port).toBe(9000);
    expect(config.retries).toBe(2);
    expect(config.matchesStatus(204)).toBe(true);
  });

  it('normalises a path that is missing its leading slash', () => {
    expect(parseHealthCheckConfig({ health_check_path: 'healthz' })!.path).toBe('/healthz');
  });

  it('falls back to defaults for non-positive numeric values', () => {
    const config = parseHealthCheckConfig({
      health_check_path: '/x',
      health_check_interval: 0,
      health_check_retries: -1,
    })!;
    expect(config.intervalSeconds).toBe(HEALTH_CHECK_DEFAULTS.intervalSeconds);
    expect(config.retries).toBe(HEALTH_CHECK_DEFAULTS.retries);
  });

  it('accepts a start period of exactly zero (it is a valid value, not "unset")', () => {
    expect(parseHealthCheckConfig({ health_check_path: '/x', health_check_start_period: 0 })!.startPeriodSeconds).toBe(0);
  });
});

describe('parseStopGracePeriod', () => {
  it('falls back to the value the legacy path already used when NULL', () => {
    expect(parseStopGracePeriod(null)).toBe(DEFAULT_STOP_GRACE_SECONDS);
    expect(parseStopGracePeriod({ stop_grace_period: null })).toBe(DEFAULT_STOP_GRACE_SECONDS);
  });

  it('reads a configured value in either spelling', () => {
    expect(parseStopGracePeriod({ stop_grace_period: 45 })).toBe(45);
    expect(parseStopGracePeriod({ stopGracePeriod: 45 })).toBe(45);
  });

  it('accepts zero — "kill immediately" is a legitimate choice', () => {
    expect(parseStopGracePeriod({ stop_grace_period: 0 })).toBe(0);
  });
});

describe('readConfiguredStrategy', () => {
  it('returns null when the column is NULL or absent', () => {
    expect(readConfiguredStrategy(null)).toBeNull();
    expect(readConfiguredStrategy({ deployment_strategy: null })).toBeNull();
  });

  it('reads either spelling', () => {
    expect(readConfiguredStrategy({ deployment_strategy: 'rolling' })).toBe('rolling');
    expect(readConfiguredStrategy({ deploymentStrategy: 'recreate' })).toBe('recreate');
  });
});

describe('resolveDeploymentStrategy', () => {
  // Rolling deploys are opt-in, so the shared base turns the feature on and
  // the off-by-default behaviour gets its own block below.
  const base = {
    hasDomain: true,
    isPreview: false,
    hasPersistentStorage: false,
    env: { GS_ZERO_DOWNTIME: '1' } as NodeJS.ProcessEnv,
  };

  it('defaults to rolling for an app with a domain', () => {
    const decision = resolveDeploymentStrategy({ ...base, configured: null });
    expect(decision.strategy).toBe(DEFAULT_STRATEGY_WHEN_UNSET.withDomain);
    expect(decision.strategy).toBe('rolling');
  });

  it('defaults to recreate for an app with no domain', () => {
    const decision = resolveDeploymentStrategy({ ...base, hasDomain: false, configured: null });
    expect(decision.strategy).toBe(DEFAULT_STRATEGY_WHEN_UNSET.withoutDomain);
    expect(decision.strategy).toBe('recreate');
  });

  it('honours an explicit strategy over the default', () => {
    expect(resolveDeploymentStrategy({ ...base, hasDomain: false, configured: 'rolling' }).strategy).toBe('rolling');
    expect(resolveDeploymentStrategy({ ...base, configured: 'recreate' }).strategy).toBe('recreate');
    expect(resolveDeploymentStrategy({ ...base, configured: '  ROLLING ' }).strategy).toBe('rolling');
  });

  it('ignores an unrecognised strategy value and falls back to the default', () => {
    expect(resolveDeploymentStrategy({ ...base, configured: 'blue-green' }).strategy).toBe('rolling');
  });

  describe('GS_ZERO_DOWNTIME switch', () => {
    it('forces recreate even when the app explicitly asks for rolling', () => {
      const decision = resolveDeploymentStrategy({
        ...base,
        configured: 'rolling',
        env: { GS_ZERO_DOWNTIME: '0' },
      });
      expect(decision.strategy).toBe('recreate');
      expect(decision.reason).toMatch(/rolling deploys are off/);
    });

    it('is off when unset, so a merge cannot change deploy behaviour silently', () => {
      // Installs deploy from main unattended. Rolling has to be chosen, not
      // inherited: unset must mean the legacy path even for a domained app.
      const decision = resolveDeploymentStrategy({ ...base, configured: null, env: {} });
      expect(decision.strategy).toBe('recreate');
      expect(decision.reason).toMatch(/set GS_ZERO_DOWNTIME=1/);
    });

    it('is off when unset even if the app explicitly asks for rolling', () => {
      expect(
        resolveDeploymentStrategy({ ...base, configured: 'rolling', env: {} }).strategy,
      ).toBe('recreate');
    });

    it('enables rolling only for the exact value "1"', () => {
      expect(
        resolveDeploymentStrategy({ ...base, configured: null, env: { GS_ZERO_DOWNTIME: '1' } }).strategy,
      ).toBe('rolling');
      for (const value of ['true', 'yes', 'on', '2', '']) {
        expect(
          resolveDeploymentStrategy({ ...base, configured: null, env: { GS_ZERO_DOWNTIME: value } }).strategy,
        ).toBe('recreate');
      }
    });
  });

  it('keeps preview containers on the legacy path', () => {
    const decision = resolveDeploymentStrategy({ ...base, isPreview: true, configured: 'rolling' });
    expect(decision.strategy).toBe('recreate');
    expect(decision.reason).toMatch(/preview/);
  });

  it('refuses rolling for an app with persistent storage unless the operator opts in', () => {
    const guarded = resolveDeploymentStrategy({ ...base, hasPersistentStorage: true, configured: 'rolling' });
    expect(guarded.strategy).toBe('recreate');
    expect(guarded.reason).toMatch(/volume/);

    const optedIn = resolveDeploymentStrategy({
      ...base,
      hasPersistentStorage: true,
      configured: 'rolling',
      env: { GS_ZERO_DOWNTIME: '1', GS_ZERO_DOWNTIME_SHARED_VOLUME: '1' },
    });
    expect(optedIn.strategy).toBe('rolling');
  });

  it('lets the kill switch win over the shared-volume opt-in', () => {
    expect(
      resolveDeploymentStrategy({
        ...base,
        hasPersistentStorage: true,
        configured: 'rolling',
        env: { GS_ZERO_DOWNTIME: '0', GS_ZERO_DOWNTIME_SHARED_VOLUME: '1' },
      }).strategy,
    ).toBe('recreate');
  });
});

describe('traefikConvergeMs', () => {
  it('defaults when unset or malformed', () => {
    expect(traefikConvergeMs({})).toBe(TRAEFIK_CONVERGE_DEFAULT_MS);
    expect(traefikConvergeMs({ GS_TRAEFIK_CONVERGE_MS: 'soon' })).toBe(TRAEFIK_CONVERGE_DEFAULT_MS);
  });

  it('honours a configured value, including zero', () => {
    expect(traefikConvergeMs({ GS_TRAEFIK_CONVERGE_MS: '250' })).toBe(250);
    expect(traefikConvergeMs({ GS_TRAEFIK_CONVERGE_MS: '0' })).toBe(0);
  });
});
