import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ProxmoxClient, ProxmoxError } from '../../src/services/proxmox-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;

const testConfig = {
  host: '192.168.1.100',
  port: 8006,
  tokenId: 'root@pam!guildserver',
  tokenSecret: 'test-secret-12345',
};

const expectedBaseUrl = `https://${testConfig.host}:${testConfig.port}/api2/json`;
const expectedAuthHeader = `PVEAPIToken=${testConfig.tokenId}=${testConfig.tokenSecret}`;

/** Create a minimal mock Response that satisfies the ProxmoxClient's usage. */
function mockFetchResponse(data: unknown, status = 200) {
  (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(JSON.stringify({ data })),
  } as Response);
}

/** Mock a raw text response (for error bodies that are not JSON-wrapped). */
function mockFetchRawResponse(body: string, status: number) {
  (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Error',
    text: () => Promise.resolve(body),
  } as Response);
}

/** Mock fetch to reject with a network-level error. */
function mockFetchNetworkError(message: string) {
  (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
    new Error(message),
  );
}

/** Shorthand to grab the most recent call args from the mock. */
function lastFetchCall() {
  const mock = global.fetch as jest.MockedFunction<typeof fetch>;
  return mock.mock.calls[mock.mock.calls.length - 1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('ProxmoxClient', () => {
  // -------------------------------------------------------------------------
  // Constructor / Setup
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create an instance without errors', () => {
      const client = new ProxmoxClient(testConfig);
      expect(client).toBeInstanceOf(ProxmoxClient);
    });

    it('should create an instance with allowInsecure option', () => {
      const client = new ProxmoxClient({ ...testConfig, allowInsecure: true });
      expect(client).toBeInstanceOf(ProxmoxClient);
    });
  });

  // -------------------------------------------------------------------------
  // testConnection()
  // -------------------------------------------------------------------------

  describe('testConnection()', () => {
    it('should return connected=true with version and node count on success', async () => {
      const client = new ProxmoxClient(testConfig);

      // First call: GET /version
      mockFetchResponse({
        version: '8.1.3',
        release: '8.1',
        repoid: 'a1b2c3d4',
      });
      // Second call: GET /nodes
      mockFetchResponse([
        { node: 'pve', status: 'online', cpu: 0.05, maxcpu: 4, mem: 1e9, maxmem: 8e9, disk: 5e9, maxdisk: 100e9, uptime: 86400 },
        { node: 'pve2', status: 'online', cpu: 0.10, maxcpu: 8, mem: 2e9, maxmem: 16e9, disk: 10e9, maxdisk: 200e9, uptime: 43200 },
      ]);

      const result = await client.testConnection();

      expect(result.connected).toBe(true);
      expect(result.version).toBe('8.1.3');
      expect(result.nodes).toBe(2);
      expect(result.message).toContain('8.1.3');
      expect(result.message).toContain('8.1');
    });

    it('should return connected=false on network failure', async () => {
      const client = new ProxmoxClient(testConfig);

      mockFetchNetworkError('fetch failed');

      const result = await client.testConnection();

      expect(result.connected).toBe(false);
      expect(result.message).toContain('Failed to connect');
      expect(result.message).toContain('fetch failed');
      expect(result.version).toBeUndefined();
      expect(result.nodes).toBeUndefined();
    });

    it('should return connected=false on 401 auth failure', async () => {
      const client = new ProxmoxClient(testConfig);

      mockFetchRawResponse('authentication failure', 401);

      const result = await client.testConnection();

      expect(result.connected).toBe(false);
      expect(result.message).toContain('Failed to connect');
      expect(result.message).toContain('401');
    });

    it('should return connected=false on 403 forbidden', async () => {
      const client = new ProxmoxClient(testConfig);

      mockFetchRawResponse('permission denied', 403);

      const result = await client.testConnection();

      expect(result.connected).toBe(false);
      expect(result.message).toContain('403');
    });
  });

  // -------------------------------------------------------------------------
  // Node operations
  // -------------------------------------------------------------------------

  describe('listNodes()', () => {
    it('should return an array of NodeInfo', async () => {
      const client = new ProxmoxClient(testConfig);

      const nodes = [
        { node: 'pve', status: 'online', cpu: 0.12, maxcpu: 4, mem: 2e9, maxmem: 8e9, disk: 10e9, maxdisk: 100e9, uptime: 86400 },
        { node: 'pve2', status: 'online', cpu: 0.08, maxcpu: 8, mem: 4e9, maxmem: 16e9, disk: 20e9, maxdisk: 200e9, uptime: 172800 },
      ];
      mockFetchResponse(nodes);

      const result = await client.listNodes();

      expect(result).toHaveLength(2);
      expect(result[0].node).toBe('pve');
      expect(result[1].node).toBe('pve2');

      // Verify correct URL
      const [url] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes`);
    });
  });

  describe('getNodeStatus()', () => {
    it('should return NodeStatus for the given node', async () => {
      const client = new ProxmoxClient(testConfig);

      const status = {
        cpu: 0.15,
        maxcpu: 4,
        mem: 3e9,
        maxmem: 8e9,
        disk: 50e9,
        maxdisk: 500e9,
        uptime: 259200,
        status: 'online',
      };
      mockFetchResponse(status);

      const result = await client.getNodeStatus('pve');

      expect(result.cpu).toBe(0.15);
      expect(result.maxcpu).toBe(4);
      expect(result.uptime).toBe(259200);

      const [url] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/status`);
    });
  });

  // -------------------------------------------------------------------------
  // LXC Container operations
  // -------------------------------------------------------------------------

  describe('createLXC()', () => {
    it('should POST to /nodes/{node}/lxc and return a UPID', async () => {
      const client = new ProxmoxClient(testConfig);

      const upid = 'UPID:pve:0000AAAA:00112233:6651ABCD:vzcreate:100:root@pam:';
      mockFetchResponse(upid);

      const result = await client.createLXC('pve', {
        hostname: 'test-ct',
        ostemplate: 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst',
        storage: 'local-lvm',
        memory: 512,
        cores: 1,
        net0: 'name=eth0,bridge=vmbr0,ip=dhcp',
        vmid: 100,
        rootfs: 'local-lvm:8',
        swap: 256,
        password: 'secret123',
        sshKeys: 'ssh-ed25519 AAAAC...',
        start: true,
        unprivileged: true,
        features: 'nesting=1',
        onboot: true,
      });

      expect(result).toBe(upid);

      // Verify URL and method
      const [url, init] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/lxc`);
      expect(init?.method).toBe('POST');

      // Verify body is form-encoded
      const bodyStr = init?.body as string;
      expect(bodyStr).toBeDefined();
      const params = new URLSearchParams(bodyStr);

      expect(params.get('hostname')).toBe('test-ct');
      expect(params.get('ostemplate')).toBe('local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst');
      expect(params.get('storage')).toBe('local-lvm');
      expect(params.get('memory')).toBe('512');
      expect(params.get('cores')).toBe('1');
      expect(params.get('net0')).toBe('name=eth0,bridge=vmbr0,ip=dhcp');
      expect(params.get('vmid')).toBe('100');
      expect(params.get('rootfs')).toBe('local-lvm:8');
      expect(params.get('swap')).toBe('256');
      expect(params.get('password')).toBe('secret123');
      expect(params.get('ssh-public-keys')).toBe('ssh-ed25519 AAAAC...');
      expect(params.get('start')).toBe('1');
      expect(params.get('unprivileged')).toBe('1');
      expect(params.get('features')).toBe('nesting=1');
      expect(params.get('onboot')).toBe('1');

      // Content-Type header
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    it('should omit optional fields when not provided', async () => {
      const client = new ProxmoxClient(testConfig);

      mockFetchResponse('UPID:pve:create:101');

      await client.createLXC('pve', {
        hostname: 'minimal-ct',
        ostemplate: 'local:vztmpl/debian-12.tar.zst',
        storage: 'local-lvm',
        memory: 256,
        cores: 1,
        net0: 'name=eth0,bridge=vmbr0,ip=dhcp',
      });

      const [, init] = lastFetchCall();
      const params = new URLSearchParams(init?.body as string);

      // Required fields present
      expect(params.get('hostname')).toBe('minimal-ct');
      expect(params.get('memory')).toBe('256');

      // Optional fields absent
      expect(params.has('vmid')).toBe(false);
      expect(params.has('rootfs')).toBe(false);
      expect(params.has('swap')).toBe(false);
      expect(params.has('password')).toBe(false);
      expect(params.has('ssh-public-keys')).toBe(false);
      expect(params.has('start')).toBe(false);
      expect(params.has('unprivileged')).toBe(false);
      expect(params.has('features')).toBe(false);
      expect(params.has('onboot')).toBe(false);
    });

    it('should encode boolean options as 0 when false', async () => {
      const client = new ProxmoxClient(testConfig);

      mockFetchResponse('UPID:pve:create:102');

      await client.createLXC('pve', {
        hostname: 'ct-no-start',
        ostemplate: 'local:vztmpl/debian-12.tar.zst',
        storage: 'local-lvm',
        memory: 256,
        cores: 1,
        net0: 'name=eth0,bridge=vmbr0,ip=dhcp',
        start: false,
        unprivileged: false,
        onboot: false,
      });

      const [, init] = lastFetchCall();
      const params = new URLSearchParams(init?.body as string);

      expect(params.get('start')).toBe('0');
      expect(params.get('unprivileged')).toBe('0');
      expect(params.get('onboot')).toBe('0');
    });
  });

  describe('startLXC()', () => {
    it('should POST to /nodes/{node}/lxc/{vmid}/status/start and return UPID', async () => {
      const client = new ProxmoxClient(testConfig);

      const upid = 'UPID:pve:0000BBBB:00112233:6651BCDE:vzstart:100:root@pam:';
      mockFetchResponse(upid);

      const result = await client.startLXC('pve', 100);

      expect(result).toBe(upid);

      const [url, init] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/lxc/100/status/start`);
      expect(init?.method).toBe('POST');
    });
  });

  describe('stopLXC()', () => {
    it('should POST to /nodes/{node}/lxc/{vmid}/status/stop and return UPID', async () => {
      const client = new ProxmoxClient(testConfig);

      const upid = 'UPID:pve:0000CCCC:00112233:6651CDEF:vzstop:100:root@pam:';
      mockFetchResponse(upid);

      const result = await client.stopLXC('pve', 100);

      expect(result).toBe(upid);

      const [url, init] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/lxc/100/status/stop`);
      expect(init?.method).toBe('POST');
    });
  });

  describe('destroyLXC()', () => {
    it('should DELETE /nodes/{node}/lxc/{vmid} and return UPID', async () => {
      const client = new ProxmoxClient(testConfig);

      const upid = 'UPID:pve:0000DDDD:00112233:6651DEFA:vzdestroy:100:root@pam:';
      mockFetchResponse(upid);

      const result = await client.destroyLXC('pve', 100);

      expect(result).toBe(upid);

      const [url, init] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/lxc/100`);
      expect(init?.method).toBe('DELETE');
    });
  });

  describe('getLXCStatus()', () => {
    it('should GET /nodes/{node}/lxc/{vmid}/status/current and return LXCStatus', async () => {
      const client = new ProxmoxClient(testConfig);

      const status = {
        vmid: 100,
        name: 'test-ct',
        status: 'running',
        cpu: 0.05,
        maxcpu: 1,
        mem: 128e6,
        maxmem: 512e6,
        disk: 1e9,
        maxdisk: 8e9,
        uptime: 3600,
        pid: 12345,
        netin: 5000,
        netout: 3000,
      };
      mockFetchResponse(status);

      const result = await client.getLXCStatus('pve', 100);

      expect(result.vmid).toBe(100);
      expect(result.name).toBe('test-ct');
      expect(result.status).toBe('running');
      expect(result.pid).toBe(12345);
      expect(result.netin).toBe(5000);
      expect(result.netout).toBe(3000);

      const [url, init] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/lxc/100/status/current`);
      expect(init?.method).toBe('GET');
    });
  });

  describe('listLXCs()', () => {
    it('should GET /nodes/{node}/lxc and return LXCInfo[]', async () => {
      const client = new ProxmoxClient(testConfig);

      const containers = [
        { vmid: 100, name: 'ct-1', status: 'running', mem: 256e6, maxmem: 512e6, disk: 2e9, maxdisk: 8e9, cpu: 0.02, maxcpu: 1, uptime: 7200 },
        { vmid: 101, name: 'ct-2', status: 'stopped', mem: 0, maxmem: 256e6, disk: 1e9, maxdisk: 4e9, cpu: 0, maxcpu: 1, uptime: 0 },
      ];
      mockFetchResponse(containers);

      const result = await client.listLXCs('pve');

      expect(result).toHaveLength(2);
      expect(result[0].vmid).toBe(100);
      expect(result[0].status).toBe('running');
      expect(result[1].vmid).toBe(101);
      expect(result[1].status).toBe('stopped');

      const [url] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/lxc`);
    });
  });

  // -------------------------------------------------------------------------
  // VMID
  // -------------------------------------------------------------------------

  describe('getNextVMID()', () => {
    it('should parse a string response to a number', async () => {
      const client = new ProxmoxClient(testConfig);

      // Proxmox returns the next VMID as a string
      mockFetchResponse('101');

      const result = await client.getNextVMID();

      expect(result).toBe(101);
      expect(typeof result).toBe('number');

      const [url] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/cluster/nextid`);
    });

    it('should handle a numeric response directly', async () => {
      const client = new ProxmoxClient(testConfig);

      // In case the API returns an actual number
      mockFetchResponse(102);

      const result = await client.getNextVMID();

      expect(result).toBe(102);
      expect(typeof result).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // Task waiting
  // -------------------------------------------------------------------------

  describe('waitForTask()', () => {
    it('should poll until the task is stopped and return OK', async () => {
      const client = new ProxmoxClient(testConfig);
      const upid = 'UPID:pve:0000AAAA:00112233:6651ABCD:vzcreate:100:root@pam:';

      // First poll: running
      mockFetchResponse({ status: 'running' });
      // Second poll: stopped with OK
      mockFetchResponse({ status: 'stopped', exitstatus: 'OK' });

      const result = await client.waitForTask('pve', upid, 10_000);

      expect(result.status).toBe('OK');
      expect(result.exitstatus).toBe('OK');

      // Verify the correct task status URL was called
      const encodedUpid = encodeURIComponent(upid);
      const [url] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/tasks/${encodedUpid}/status`);
    });

    it('should return Error status when task exits with an error', async () => {
      const client = new ProxmoxClient(testConfig);
      const upid = 'UPID:pve:errortask';

      // Single poll: stopped with error exit
      mockFetchResponse({ status: 'stopped', exitstatus: 'container creation failed' });

      const result = await client.waitForTask('pve', upid, 10_000);

      expect(result.status).toBe('Error');
      expect(result.exitstatus).toBe('container creation failed');
    });

    it('should throw a timeout error when the task never stops', async () => {
      const client = new ProxmoxClient(testConfig);
      const upid = 'UPID:pve:stucktask';

      // Always return "running" for every poll
      (global.fetch as jest.MockedFunction<typeof fetch>).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          text: () => Promise.resolve(JSON.stringify({ data: { status: 'running' } })),
        } as Response),
      );

      // Use a very small timeout (100ms) so the test completes quickly.
      // The 1-second sleep between polls means Date.now() - start will exceed
      // 100ms after the first iteration.
      await expect(client.waitForTask('pve', upid, 100)).rejects.toThrow(
        /Timed out waiting for task/,
      );
    }, 10_000);
  });

  // -------------------------------------------------------------------------
  // Templates & Storage
  // -------------------------------------------------------------------------

  describe('listTemplates()', () => {
    it('should GET with content=vztmpl query and return TemplateInfo[]', async () => {
      const client = new ProxmoxClient(testConfig);

      const templates = [
        { volid: 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst', format: 'tzst', size: 130e6 },
        { volid: 'local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst', format: 'tzst', size: 110e6 },
      ];
      mockFetchResponse(templates);

      const result = await client.listTemplates('pve', 'local');

      expect(result).toHaveLength(2);
      expect(result[0].volid).toContain('ubuntu');
      expect(result[1].volid).toContain('debian');

      const [url] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/storage/local/content?content=vztmpl`);
    });
  });

  describe('listStorage()', () => {
    it('should GET /nodes/{node}/storage and return StorageInfo[]', async () => {
      const client = new ProxmoxClient(testConfig);

      const storages = [
        { storage: 'local', type: 'dir', content: 'iso,vztmpl,backup', total: 100e9, used: 30e9, avail: 70e9, active: 1 },
        { storage: 'local-lvm', type: 'lvmthin', content: 'rootdir,images', total: 500e9, used: 50e9, avail: 450e9, active: 1 },
      ];
      mockFetchResponse(storages);

      const result = await client.listStorage('pve');

      expect(result).toHaveLength(2);
      expect(result[0].storage).toBe('local');
      expect(result[0].type).toBe('dir');
      expect(result[1].storage).toBe('local-lvm');
      expect(result[1].type).toBe('lvmthin');

      const [url] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/storage`);
    });
  });

  // -------------------------------------------------------------------------
  // Network
  // -------------------------------------------------------------------------

  describe('getLXCInterfaces()', () => {
    it('should GET /nodes/{node}/lxc/{vmid}/interfaces and return NetworkInterface[]', async () => {
      const client = new ProxmoxClient(testConfig);

      const interfaces = [
        {
          name: 'eth0',
          hwaddr: 'BC:24:11:AA:BB:CC',
          'ip-addresses': [
            { 'ip-address': '10.0.0.50', 'ip-address-type': 'ipv4', prefix: 24 },
            { 'ip-address': 'fe80::be24:11ff:feaa:bbcc', 'ip-address-type': 'ipv6', prefix: 64 },
          ],
        },
        {
          name: 'lo',
          hwaddr: '00:00:00:00:00:00',
          'ip-addresses': [
            { 'ip-address': '127.0.0.1', 'ip-address-type': 'ipv4', prefix: 8 },
          ],
        },
      ];
      mockFetchResponse(interfaces);

      const result = await client.getLXCInterfaces('pve', 100);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('eth0');
      expect(result[0].hwaddr).toBe('BC:24:11:AA:BB:CC');
      expect(result[0]['ip-addresses']).toHaveLength(2);
      expect(result[0]['ip-addresses']![0]['ip-address']).toBe('10.0.0.50');

      const [url] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/lxc/100/interfaces`);
    });
  });

  // -------------------------------------------------------------------------
  // execInLXC
  // -------------------------------------------------------------------------

  describe('execInLXC()', () => {
    it('should always throw "not yet implemented"', async () => {
      const client = new ProxmoxClient(testConfig);

      await expect(client.execInLXC('pve', 100, 'ls -la')).rejects.toThrow(
        /not yet implemented/i,
      );
    });

    it('should not make any fetch calls', async () => {
      const client = new ProxmoxClient(testConfig);

      try {
        await client.execInLXC('pve', 100, 'whoami');
      } catch {
        // expected
      }

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Auth header verification
  // -------------------------------------------------------------------------

  describe('Authorization header', () => {
    it('should send PVEAPIToken=tokenId=tokenSecret', async () => {
      const client = new ProxmoxClient(testConfig);

      mockFetchResponse([]);

      await client.listNodes();

      const [, init] = lastFetchCall();
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(expectedAuthHeader);
    });

    it('should format the header correctly for tokens with special characters', async () => {
      const client = new ProxmoxClient({
        host: '10.0.0.1',
        port: 8006,
        tokenId: 'admin@pve!my-token',
        tokenSecret: 'aaaa-bbbb-cccc-dddd-eeee',
      });

      mockFetchResponse([]);

      await client.listNodes();

      const [, init] = lastFetchCall();
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(
        'PVEAPIToken=admin@pve!my-token=aaaa-bbbb-cccc-dddd-eeee',
      );
    });
  });

  // -------------------------------------------------------------------------
  // allowInsecure
  // -------------------------------------------------------------------------

  describe('allowInsecure', () => {
    const originalTlsEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    afterEach(() => {
      // Restore after each test in this block
      if (originalTlsEnv === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsEnv;
      }
    });

    it('should set NODE_TLS_REJECT_UNAUTHORIZED to "0" during the request when allowInsecure=true', async () => {
      const client = new ProxmoxClient({ ...testConfig, allowInsecure: true });

      let capturedTlsEnv: string | undefined;

      // Use a custom mock that captures the env var at call time
      (global.fetch as jest.MockedFunction<typeof fetch>).mockImplementationOnce(async () => {
        capturedTlsEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: () => Promise.resolve(JSON.stringify({ data: [] })),
        } as Response;
      });

      await client.listNodes();

      expect(capturedTlsEnv).toBe('0');
    });

    it('should restore NODE_TLS_REJECT_UNAUTHORIZED after the request completes', async () => {
      // Set a known value before the test
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

      const client = new ProxmoxClient({ ...testConfig, allowInsecure: true });
      mockFetchResponse([]);

      await client.listNodes();

      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('1');
    });

    it('should delete NODE_TLS_REJECT_UNAUTHORIZED if it was previously unset', async () => {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

      const client = new ProxmoxClient({ ...testConfig, allowInsecure: true });
      mockFetchResponse([]);

      await client.listNodes();

      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    });

    it('should restore NODE_TLS_REJECT_UNAUTHORIZED even if the request throws', async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

      const client = new ProxmoxClient({ ...testConfig, allowInsecure: true });
      mockFetchNetworkError('connection refused');

      try {
        await client.listNodes();
      } catch {
        // expected
      }

      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('1');
    });

    it('should NOT modify NODE_TLS_REJECT_UNAUTHORIZED when allowInsecure is false', async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

      const client = new ProxmoxClient(testConfig); // allowInsecure defaults to false
      mockFetchResponse([]);

      let capturedTlsEnv: string | undefined;
      (global.fetch as jest.MockedFunction<typeof fetch>).mockReset();
      (global.fetch as jest.MockedFunction<typeof fetch>).mockImplementationOnce(async () => {
        capturedTlsEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: () => Promise.resolve(JSON.stringify({ data: [] })),
        } as Response;
      });

      await client.listNodes();

      // Should remain "1" -- never changed to "0"
      expect(capturedTlsEnv).toBe('1');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('should throw ProxmoxError with statusCode, statusText, body on non-OK response', async () => {
      const client = new ProxmoxClient(testConfig);

      mockFetchRawResponse('{"errors":{"vmid":"value already in use"}}', 500);

      try {
        await client.listNodes();
        // Should not reach here
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProxmoxError);
        const proxErr = err as ProxmoxError;
        expect(proxErr.statusCode).toBe(500);
        expect(proxErr.statusText).toBe('Error');
        expect(proxErr.body).toContain('value already in use');
        expect(proxErr.message).toContain('500');
      }
    });

    it('should throw ProxmoxError on 404', async () => {
      const client = new ProxmoxClient(testConfig);

      mockFetchRawResponse('no such resource', 404);

      await expect(client.getNodeStatus('nonexistent')).rejects.toThrow(ProxmoxError);
    });

    it('should propagate network errors as-is (not wrapped in ProxmoxError)', async () => {
      const client = new ProxmoxClient(testConfig);

      mockFetchNetworkError('ECONNREFUSED');

      try {
        await client.listNodes();
        expect(true).toBe(false);
      } catch (err) {
        expect(err).not.toBeInstanceOf(ProxmoxError);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe('ECONNREFUSED');
      }
    });
  });

  // -------------------------------------------------------------------------
  // URL construction
  // -------------------------------------------------------------------------

  describe('URL construction', () => {
    it('should build the base URL from host and port', async () => {
      const client = new ProxmoxClient(testConfig);
      mockFetchResponse([]);

      await client.listNodes();

      const [url] = lastFetchCall();
      expect(url).toStartWith(`https://192.168.1.100:8006/api2/json`);
    });

    it('should encodeURIComponent node names with special characters', async () => {
      const client = new ProxmoxClient(testConfig);
      mockFetchResponse({ cpu: 0, maxcpu: 1, mem: 0, maxmem: 1, disk: 0, maxdisk: 1, uptime: 0, status: 'online' });

      await client.getNodeStatus('node/with spaces');

      const [url] = lastFetchCall();
      expect(url).toContain('node%2Fwith%20spaces');
    });
  });

  // -------------------------------------------------------------------------
  // downloadTemplate (bonus coverage)
  // -------------------------------------------------------------------------

  describe('downloadTemplate()', () => {
    it('should POST to /nodes/{node}/aplinfo with storage and template in body', async () => {
      const client = new ProxmoxClient(testConfig);

      const upid = 'UPID:pve:download:template';
      mockFetchResponse(upid);

      const result = await client.downloadTemplate(
        'pve',
        'local',
        'ubuntu-22.04-standard_22.04-1_amd64.tar.zst',
      );

      expect(result).toBe(upid);

      const [url, init] = lastFetchCall();
      expect(url).toBe(`${expectedBaseUrl}/nodes/pve/aplinfo`);
      expect(init?.method).toBe('POST');

      const params = new URLSearchParams(init?.body as string);
      expect(params.get('storage')).toBe('local');
      expect(params.get('template')).toBe('ubuntu-22.04-standard_22.04-1_amd64.tar.zst');
    });
  });
});

// ---------------------------------------------------------------------------
// ProxmoxError class standalone tests
// ---------------------------------------------------------------------------

describe('ProxmoxError', () => {
  it('should have name set to "ProxmoxError"', () => {
    const err = new ProxmoxError(500, 'Internal Server Error', 'something broke');
    expect(err.name).toBe('ProxmoxError');
  });

  it('should be an instance of Error', () => {
    const err = new ProxmoxError(401, 'Unauthorized', 'bad token');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProxmoxError);
  });

  it('should include statusCode, statusText, and body in the message', () => {
    const err = new ProxmoxError(403, 'Forbidden', 'no access');
    expect(err.message).toContain('403');
    expect(err.message).toContain('Forbidden');
    expect(err.message).toContain('no access');
  });

  it('should expose readonly properties', () => {
    const err = new ProxmoxError(502, 'Bad Gateway', 'upstream down');
    expect(err.statusCode).toBe(502);
    expect(err.statusText).toBe('Bad Gateway');
    expect(err.body).toBe('upstream down');
  });
});

// ---------------------------------------------------------------------------
// Custom matcher registration (Jest does not ship `toStartWith` by default)
// ---------------------------------------------------------------------------

expect.extend({
  toStartWith(received: string, prefix: string) {
    const pass = typeof received === 'string' && received.startsWith(prefix);
    return {
      pass,
      message: () =>
        `expected ${JSON.stringify(received)} to${pass ? ' not' : ''} start with ${JSON.stringify(prefix)}`,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toStartWith(prefix: string): R;
    }
  }
}
