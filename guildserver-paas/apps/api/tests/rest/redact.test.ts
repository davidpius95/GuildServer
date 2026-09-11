import { REDACTED, redact } from '../../src/rest/v1/redact';

describe('redact', () => {
  it.each([
    'password', 'Password', 'dbPassword', 'registryPassword', 'registry_password', 'db-password',
    'secret', 'clientSecret', 'webhook_secret',
    'token', 'accessToken', 'refreshToken', 'refresh_token',
    'apiKey', 'api_key', 'privateKey', 'private-key',
    'credential', 'credentials', 'tokenHash', 'pass', 'DB_PASSWORD', 'POSTGRES_PASSWORD', 'githubToken',
  ])('redacts a string under %s', (key) => {
    expect(redact({ [key]: 'hunter2' })).toEqual({ [key]: REDACTED });
  });

  it.each(['tokenId', 'tokenPrefix', 'tokenExpiresAt', 'passwordUpdatedAt', 'secretName', 'keyId', 'id', 'name', 'bypass', 'compass'])(
    'keeps %s, which names a secret without being one',
    (key) => {
      expect(redact({ [key]: 'value' })).toEqual({ [key]: 'value' });
    },
  );

  it('masks credentials embedded in any URL, wherever the string sits', () => {
    const out = redact({ note: 'connect via postgres://app:s3cr3t@db.internal:5432/app', list: ['redis://default:pw@cache:6379'] });
    expect(out).toEqual({
      note: 'connect via postgres://app:[redacted]@db.internal:5432/app',
      list: ['redis://default:[redacted]@cache:6379'],
    });
  });

  it('leaves URLs without credentials, dates, numbers and nulls untouched', () => {
    const when = new Date('2026-01-01T00:00:00Z');
    expect(redact({ url: 'https://example.com/a:b', when, n: 3, x: null, flag: false })).toEqual({
      url: 'https://example.com/a:b', when, n: 3, x: null, flag: false,
    });
  });

  it('does not replace a non-string value under a secret-looking key', () => {
    // e.g. a boolean "hasPassword" style field or a nested object is not itself a secret string.
    expect(redact({ password: null, token: { id: 'abc' } })).toEqual({ password: null, token: { id: 'abc' } });
  });

  it('recurses through nested arrays and objects', () => {
    expect(redact({ a: [{ b: { password: 'x', ok: 'y' } }] })).toEqual({ a: [{ b: { password: REDACTED, ok: 'y' } }] });
  });
});
