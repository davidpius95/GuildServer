import { buildDeploymentAccessUrl } from '../../src/services/deployment-access';

describe('buildDeploymentAccessUrl for remote Docker hosts', () => {
  it('points the direct URL at the remote host', () => {
    expect(buildDeploymentAccessUrl({ hostPort: 30001, providerType: 'docker-remote', providerMetadata: { remoteHost: '203.0.113.5' } })).toEqual({
      accessUrl: 'http://203.0.113.5:30001',
      directUrl: 'http://203.0.113.5:30001',
    });
  });

  it('brackets an IPv6 host', () => {
    expect(buildDeploymentAccessUrl({ hostPort: 30001, providerMetadata: { remoteHost: '2001:db8::5' } }).directUrl).toBe('http://[2001:db8::5]:30001');
  });

  it('still prefers a domain for the access URL', () => {
    const urls = buildDeploymentAccessUrl({ hostPort: 30001, providerMetadata: { remoteHost: '203.0.113.5' }, primaryDomain: 'shop.example.com' });
    expect(urls).toEqual({ accessUrl: 'https://shop.example.com', directUrl: 'http://203.0.113.5:30001' });
  });

  it('keeps local deployments on localhost', () => {
    expect(buildDeploymentAccessUrl({ hostPort: 30001, providerType: 'docker-local' }).directUrl).toBe('http://localhost:30001');
  });
});
