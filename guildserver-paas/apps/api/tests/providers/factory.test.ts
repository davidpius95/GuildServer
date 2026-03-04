import { describe, it, expect } from '@jest/globals';
import { createProviderFromConfig } from '../../src/providers/factory';
import type { ProviderType, ProxmoxConfig } from '../../src/providers/types';

const proxmoxConfig: ProxmoxConfig = {
  host: "192.168.1.100",
  port: 8006,
  tokenId: "root@pam!test",
  tokenSecret: "test-secret",
  node: "pve",
  storage: "local-lvm",
  bridge: "vmbr0",
};

describe('createProviderFromConfig', () => {
  describe('implemented providers', () => {
    it('returns a DockerLocalProvider for docker-local', () => {
      const provider = createProviderFromConfig('docker-local', {});
      expect(provider.type).toBe('docker-local');
    });

    it('returns a ProxmoxProvider for proxmox', () => {
      const provider = createProviderFromConfig('proxmox', proxmoxConfig);
      expect(provider.type).toBe('proxmox');
    });
  });

  describe('unimplemented providers throw "not yet implemented"', () => {
    it('throws for docker-remote', () => {
      expect(() => createProviderFromConfig('docker-remote', {})).toThrow(
        'not yet implemented',
      );
    });

    it('throws for kubernetes', () => {
      expect(() => createProviderFromConfig('kubernetes', {})).toThrow(
        'not yet implemented',
      );
    });

    it('throws for aws-ecs', () => {
      expect(() => createProviderFromConfig('aws-ecs', {})).toThrow(
        'not yet implemented',
      );
    });

    it('throws for gcp-cloudrun', () => {
      expect(() => createProviderFromConfig('gcp-cloudrun', {})).toThrow(
        'not yet implemented',
      );
    });

    it('throws for azure-aci', () => {
      expect(() => createProviderFromConfig('azure-aci', {})).toThrow(
        'not yet implemented',
      );
    });

    it('throws for hetzner', () => {
      expect(() => createProviderFromConfig('hetzner', {})).toThrow(
        'not yet implemented',
      );
    });

    it('throws for digitalocean', () => {
      expect(() => createProviderFromConfig('digitalocean', {})).toThrow(
        'not yet implemented',
      );
    });
  });

  describe('unknown provider type', () => {
    it('throws for a completely unknown type', () => {
      expect(() =>
        createProviderFromConfig('nonexistent' as ProviderType, {}),
      ).toThrow('Unknown provider type');
    });
  });
});
