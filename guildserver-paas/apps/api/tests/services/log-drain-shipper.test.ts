/**
 * Batching, ordering, backoff, bounded buffering and endpoint safety for log
 * drain shipping, against a mock transport and a controllable clock.
 */
import { DrainShipper, type DrainTarget, type ShipperLimits, type ShipperReport } from '../../src/services/log-drain/shipper';
import type { DrainRecord } from '../../src/services/log-drain/records';

const URL_WITH_TOKEN = 'https://logs.example.com/ingest/path-secret?token=query-secret';

const rec = (i: number): DrainRecord => ({
  timestamp: `2026-09-11T05:00:00.${String(i).padStart(3, '0')}Z`,
  message: `line ${i}`,
  stream: 'stdout',
  resource: { type: 'application', id: 'app-1', name: 'shop' },
  container: { id: 'c0ffee000001', name: 'shop-1' },
  source: 'guildserver',
});

function setup(opts: { limits?: Partial<ShipperLimits>; target?: Partial<DrainTarget>; addresses?: string[] } = {}) {
  let clock = 1_000_000;
  let addresses = opts.addresses ?? ['93.184.216.34'];
  const fetch = jest.fn().mockResolvedValue({ status: 200 });
  const reports: ShipperReport[] = [];
  const shipper = new DrainShipper(
    { url: URL_WITH_TOKEN, headers: { Authorization: 'Bearer header-secret' }, format: 'json', ...opts.target },
    { fetch: fetch as any, env: {} as NodeJS.ProcessEnv, resolve: async () => addresses.map((address) => ({ address })), now: () => clock },
    opts.limits,
    (report) => reports.push(report),
  );
  return {
    shipper,
    fetch,
    reports,
    advance: (ms: number) => {
      clock += ms;
    },
    resolveTo: (next: string[]) => {
      addresses = next;
    },
  };
}

const messages = (fetch: jest.Mock, call: number) => JSON.parse(fetch.mock.calls[call][1].body).map((r: DrainRecord) => r.message);

it('ships records as a JSON array with the configured headers, in order, without following redirects', async () => {
  const { shipper, fetch, reports } = setup();
  [1, 2, 3].forEach((i) => shipper.enqueue(rec(i)));
  await shipper.flush();

  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(URL_WITH_TOKEN);
  expect(init.redirect).toBe('manual');
  expect(init.headers).toMatchObject({ Authorization: 'Bearer header-secret', 'Content-Type': 'application/json' });
  expect(messages(fetch, 0)).toEqual(['line 1', 'line 2', 'line 3']);
  expect(reports).toEqual([expect.objectContaining({ ok: true, error: null, sent: 3, dropped: 0 })]);
  expect(shipper.buffered).toBe(0);
});

it('sends newline-delimited JSON when configured', async () => {
  const { shipper, fetch } = setup({ target: { format: 'ndjson' } });
  shipper.enqueue(rec(1));
  shipper.enqueue(rec(2));
  await shipper.flush();
  const [, init] = fetch.mock.calls[0];
  expect(init.headers['Content-Type']).toBe('application/x-ndjson');
  expect(init.body.endsWith('\n')).toBe(true);
  expect(init.body.trim().split('\n').map((l: string) => JSON.parse(l).message)).toEqual(['line 1', 'line 2']);
});

it('splits into batches by record count and by size', async () => {
  const byCount = setup({ limits: { maxBatchRecords: 2 } });
  [1, 2, 3, 4, 5].forEach((i) => byCount.shipper.enqueue(rec(i)));
  await byCount.shipper.flush();
  expect(byCount.fetch.mock.calls.map((_, i) => messages(byCount.fetch, i))).toEqual([['line 1', 'line 2'], ['line 3', 'line 4'], ['line 5']]);

  const oneRecordBytes = Buffer.byteLength(JSON.stringify(rec(1)));
  const bySize = setup({ limits: { maxBatchBytes: oneRecordBytes * 2 } });
  [1, 2, 3].forEach((i) => bySize.shipper.enqueue(rec(i)));
  await bySize.shipper.flush();
  expect(bySize.fetch).toHaveBeenCalledTimes(2);
});

it('keeps records through a failure, backs off exponentially, then delivers them in order', async () => {
  const { shipper, fetch, reports, advance } = setup();
  fetch.mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 503 });
  [1, 2].forEach((i) => shipper.enqueue(rec(i)));

  await shipper.flush();
  expect(shipper.buffered).toBe(2);
  expect(reports[0]).toMatchObject({ ok: false, sent: 0 });
  expect(reports[0].error).toMatch(/logs\.example\.com answered HTTP 503/);
  expect(JSON.stringify(reports)).not.toMatch(/path-secret|query-secret|header-secret/);

  await shipper.flush(); // still inside the 1s backoff
  expect(fetch).toHaveBeenCalledTimes(1);

  advance(1_000);
  await shipper.flush(); // second failure: backoff doubles to 2s
  expect(fetch).toHaveBeenCalledTimes(2);
  advance(1_000);
  await shipper.flush();
  expect(fetch).toHaveBeenCalledTimes(2);

  shipper.enqueue(rec(3));
  advance(1_000);
  await shipper.flush();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(messages(fetch, 2)).toEqual(['line 1', 'line 2', 'line 3']);
  expect(reports[reports.length - 1]).toMatchObject({ ok: true, error: null, sent: 3 });
});

it('drops records beyond the buffer limit and reports how many', async () => {
  const { shipper, fetch, reports } = setup({ limits: { maxBufferedRecords: 2 } });
  [1, 2, 3, 4, 5].forEach((i) => shipper.enqueue(rec(i)));
  expect(shipper.buffered).toBe(2);
  await shipper.flush();
  expect(messages(fetch, 0)).toEqual(['line 1', 'line 2']);
  expect(reports).toEqual([expect.objectContaining({ sent: 2, dropped: 3 })]);
});

it.each([
  [['127.0.0.1'], /loopback/],
  [['169.254.169.254'], /link-local/],
  [['10.0.0.9'], /private/],
])('refuses to ship to an endpoint resolving to %j', async (addresses, reason) => {
  const { shipper, fetch, reports } = setup({ addresses });
  shipper.enqueue(rec(1));
  await shipper.flush();
  expect(fetch).not.toHaveBeenCalled();
  expect(shipper.buffered).toBe(1);
  expect(reports[0].error).toMatch(reason);
});

it('checks the endpoint again once its last check expires', async () => {
  const { shipper, fetch, advance, resolveTo } = setup({ limits: { endpointCheckTtlMs: 60_000 } });
  shipper.enqueue(rec(1));
  await shipper.flush();
  expect(fetch).toHaveBeenCalledTimes(1);

  resolveTo(['169.254.169.254']); // DNS now points somewhere it must not
  shipper.enqueue(rec(2));
  advance(30_000);
  await shipper.flush();
  expect(fetch).toHaveBeenCalledTimes(2); // check still trusted

  shipper.enqueue(rec(3));
  advance(31_000);
  await shipper.flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(shipper.buffered).toBe(1);
});

it('does not follow redirects', async () => {
  const { shipper, fetch, reports } = setup();
  fetch.mockResolvedValueOnce({ status: 307 });
  shipper.enqueue(rec(1));
  await shipper.flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(reports[0].error).toMatch(/redirect/);
});

it('reports a network failure by host only', async () => {
  const { shipper, fetch, reports } = setup();
  fetch.mockRejectedValueOnce(new Error(`getaddrinfo ENOTFOUND ${URL_WITH_TOKEN}`));
  shipper.enqueue(rec(1));
  await shipper.flush();
  expect(reports[0].error).toBe('logs.example.com could not be reached');
});

it('stop() makes a final attempt even during backoff', async () => {
  const { shipper, fetch } = setup();
  fetch.mockResolvedValueOnce({ status: 500 });
  shipper.enqueue(rec(1));
  await shipper.flush();
  await shipper.stop();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(shipper.buffered).toBe(0);
});
