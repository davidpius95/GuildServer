import { describe, it, expect } from '@jest/globals';
import { providerRegistry, getProviderMeta, listAvailableProviders, isProviderImplemented } from '../../src/providers/registry';

describe('Provider Registry', () => {
  describe('listAvailableProviders', () => {
    it('returns all 9 providers', () => {
      const providers = listAvailableProviders();
      expect(providers).toHaveLength(9);
    });

    it('includes every expected provider type', () => {
      const providers = listAvailableProviders();
      const types = providers.map((p) => p.type);
      expect(types).toContain('docker-local');
      expect(types).toContain('docker-remote');
      expect(types).toContain('proxmox');
      expect(types).toContain('kubernetes');
      expect(types).toContain('aws-ecs');
      expect(types).toContain('gcp-cloudrun');
      expect(types).toContain('azure-aci');
      expect(types).toContain('hetzner');
      expect(types).toContain('digitalocean');
    });
  });

  describe('isProviderImplemented', () => {
    it('returns true for docker-local', () => {
      expect(isProviderImplemented('docker-local')).toBe(true);
    });

    it('returns true for proxmox', () => {
      expect(isProviderImplemented('proxmox')).toBe(true);
    });

    it('returns false for aws-ecs', () => {
      expect(isProviderImplemented('aws-ecs')).toBe(false);
    });

    it('returns false for kubernetes', () => {
      expect(isProviderImplemented('kubernetes')).toBe(false);
    });

    it('returns false for docker-remote', () => {
      expect(isProviderImplemented('docker-remote')).toBe(false);
    });

    it('returns false for gcp-cloudrun', () => {
      expect(isProviderImplemented('gcp-cloudrun')).toBe(false);
    });

    it('returns false for azure-aci', () => {
      expect(isProviderImplemented('azure-aci')).toBe(false);
    });

    it('returns false for hetzner', () => {
      expect(isProviderImplemented('hetzner')).toBe(false);
    });

    it('returns false for digitalocean', () => {
      expect(isProviderImplemented('digitalocean')).toBe(false);
    });
  });

  describe('getProviderMeta', () => {
    it('returns correct metadata for proxmox', () => {
      const meta = getProviderMeta('proxmox');
      expect(meta).toBeDefined();
      expect(meta!.type).toBe('proxmox');
      expect(meta!.name).toBe('Proxmox VE');
      expect(meta!.description).toBe('Deploy to Proxmox Virtual Environment (LXC containers or VMs)');
      expect(meta!.icon).toBe('proxmox');
      expect(Array.isArray(meta!.configSchema)).toBe(true);
    });

    it('returns undefined for a nonexistent provider type', () => {
      // Cast to bypass TypeScript type checking for the invalid type
      const meta = getProviderMeta('nonexistent' as any);
      expect(meta).toBeUndefined();
    });
  });

  describe('provider metadata completeness', () => {
    const allProviders = listAvailableProviders();

    it.each(allProviders.map((p) => [p.type, p] as const))(
      '%s has all required ProviderPluginMeta fields',
      (_type, provider) => {
        expect(typeof provider.type).toBe('string');
        expect(provider.type.length).toBeGreaterThan(0);

        expect(typeof provider.name).toBe('string');
        expect(provider.name.length).toBeGreaterThan(0);

        expect(typeof provider.description).toBe('string');
        expect(provider.description.length).toBeGreaterThan(0);

        expect(typeof provider.icon).toBe('string');
        expect(provider.icon.length).toBeGreaterThan(0);

        expect(Array.isArray(provider.configSchema)).toBe(true);
      },
    );
  });

  describe('Proxmox configSchema', () => {
    it('has the expected configuration fields', () => {
      const meta = getProviderMeta('proxmox');
      expect(meta).toBeDefined();
      const fieldNames = meta!.configSchema.map((f) => f.name);
      expect(fieldNames).toContain('host');
      expect(fieldNames).toContain('port');
      expect(fieldNames).toContain('tokenId');
      expect(fieldNames).toContain('tokenSecret');
      expect(fieldNames).toContain('node');
      expect(fieldNames).toContain('storage');
      expect(fieldNames).toContain('bridge');
    });

    it('marks host, port, tokenId, tokenSecret, node, storage, bridge as required', () => {
      const meta = getProviderMeta('proxmox')!;
      const requiredFields = ['host', 'port', 'tokenId', 'tokenSecret', 'node', 'storage', 'bridge'];
      for (const name of requiredFields) {
        const field = meta.configSchema.find((f) => f.name === name);
        expect(field).toBeDefined();
        expect(field!.required).toBe(true);
      }
    });
  });

  describe('Docker-local configSchema', () => {
    it('has the expected configuration fields', () => {
      const meta = getProviderMeta('docker-local');
      expect(meta).toBeDefined();
      const fieldNames = meta!.configSchema.map((f) => f.name);
      expect(fieldNames).toContain('socketPath');
      expect(fieldNames).toContain('networkName');
    });

    it('marks socketPath and networkName as optional', () => {
      const meta = getProviderMeta('docker-local')!;
      for (const name of ['socketPath', 'networkName']) {
        const field = meta.configSchema.find((f) => f.name === name);
        expect(field).toBeDefined();
        expect(field!.required).toBe(false);
      }
    });
  });

  describe('providerRegistry object', () => {
    it('has exactly 9 entries', () => {
      expect(Object.keys(providerRegistry)).toHaveLength(9);
    });

    it('keys match the type field of each entry', () => {
      for (const [key, meta] of Object.entries(providerRegistry)) {
        expect(meta.type).toBe(key);
      }
    });
  });
});
