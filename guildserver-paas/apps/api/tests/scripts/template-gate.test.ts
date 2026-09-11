/**
 * Pure parts of the template verification gate: how a sharded run divides
 * templates and how its results are combined. No Docker.
 */
import { parseShard, shardCandidates } from '../../../../scripts/verify-templates';
import { mergeLedgers, type Ledger } from '../../../../scripts/merge-template-ledgers';

const templates = Array.from({ length: 50 }, (_, i) => ({ id: `template-${String(i).padStart(2, '0')}` }));

describe('shardCandidates', () => {
  it('puts every template in exactly one shard, whatever the input order', () => {
    const shuffled = [...templates].reverse();
    const seen = new Map<string, number>();
    for (let index = 1; index <= 7; index++) {
      for (const t of shardCandidates(shuffled, { index, count: 7 })) seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
    }
    expect(seen.size).toBe(templates.length);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });

  it('balances shard sizes to within one', () => {
    const sizes = Array.from({ length: 7 }, (_, i) => shardCandidates(templates, { index: i + 1, count: 7 }).length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('is deterministic', () => {
    expect(shardCandidates(templates, { index: 3, count: 7 })).toEqual(shardCandidates([...templates].reverse(), { index: 3, count: 7 }));
  });
});

describe('parseShard', () => {
  it('reads i/n', () => {
    expect(parseShard('3/24')).toEqual({ index: 3, count: 24 });
  });

  it.each(['0/24', '25/24', '3', '3/0', 'a/b', '3/24/1'])('refuses %s', (spec) => {
    expect(() => parseShard(spec)).toThrow(/--shard/);
  });
});

describe('mergeLedgers', () => {
  const ledger = (over: Partial<Ledger>): Ledger => ({ upstreamCommit: 'pin-1', verifiedAt: '2026-09-11T10:00:00.000Z', passed: [], failed: {}, ...over });

  it('unions results and never lists a passing template as failed', () => {
    const merged = mergeLedgers([
      ledger({ passed: ['ghost', 'umami'], failed: { plausible: 'timed out' } }),
      ledger({ passed: ['plausible'], failed: { n8n: 'exited 1' }, verifiedAt: '2026-09-11T12:00:00.000Z' }),
    ]);
    expect(merged).toEqual({
      upstreamCommit: 'pin-1',
      verifiedAt: '2026-09-11T12:00:00.000Z',
      passed: ['ghost', 'plausible', 'umami'],
      failed: { n8n: 'exited 1' },
    });
  });

  it('refuses to combine results from different upstream pins', () => {
    expect(() => mergeLedgers([ledger({}), ledger({ upstreamCommit: 'pin-2' })])).toThrow(/different upstream pins/);
  });

  it('refuses an empty set', () => {
    expect(() => mergeLedgers([])).toThrow(/No ledgers/);
  });
});
