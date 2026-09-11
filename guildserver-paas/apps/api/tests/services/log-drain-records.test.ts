import { DrainConfigError, LineSplitter, TRUNCATION_MARK, splitTimestamp, timestampSeconds, validateDrainHeaders } from '../../src/services/log-drain/records';

function collect(maxBytes?: number) {
  const lines: string[] = [];
  const splitter = new LineSplitter((line) => lines.push(line), maxBytes);
  return { lines, splitter };
}

describe('LineSplitter', () => {
  it('joins lines split across chunks and strips carriage returns', () => {
    const { lines, splitter } = collect();
    splitter.push(Buffer.from('hel'));
    splitter.push(Buffer.from('lo\r\nwor'));
    splitter.push(Buffer.from('ld\n\n'));
    expect(lines).toEqual(['hello', 'world']);
  });

  it('emits a trailing partial line only on flush', () => {
    const { lines, splitter } = collect();
    splitter.push(Buffer.from('done\npartial'));
    expect(lines).toEqual(['done']);
    splitter.flush();
    expect(lines).toEqual(['done', 'partial']);
  });

  it('truncates an over-long line instead of buffering it, and recovers at the next newline', () => {
    const { lines, splitter } = collect(10);
    splitter.push(Buffer.from('abcdefghij'));
    splitter.push(Buffer.from('klmnopqrstuvwxyz'.repeat(1000)));
    splitter.push(Buffer.from('\nnext\n'));
    expect(lines).toEqual([`abcdefghij${TRUNCATION_MARK}`, 'next']);
  });
});

describe('splitTimestamp', () => {
  it('separates the timestamp Docker adds', () => {
    expect(splitTimestamp('2026-09-11T05:00:00.123456789Z GET /health 200')).toEqual({
      timestamp: '2026-09-11T05:00:00.123456789Z',
      message: 'GET /health 200',
    });
  });

  it('stamps a line without one with the current time', () => {
    expect(splitTimestamp('no stamp', () => Date.UTC(2026, 0, 1))).toEqual({ timestamp: '2026-01-01T00:00:00.000Z', message: 'no stamp' });
  });

  it('reads nanosecond timestamps as unix seconds', () => {
    expect(timestampSeconds('2026-09-11T05:00:01.999999999Z')).toBe(Math.floor(Date.UTC(2026, 8, 11, 5, 0, 1) / 1000));
    expect(timestampSeconds('garbage')).toBeNull();
  });
});

describe('validateDrainHeaders', () => {
  it('accepts ordinary authentication headers', () => {
    expect(() => validateDrainHeaders({ Authorization: 'Bearer abc', 'X-Api-Key': 'k', 'DD-API-KEY': 'x' })).not.toThrow();
  });

  it.each([
    [{ 'Bad Name': 'x' }, /Invalid header name/],
    [{ Host: 'internal' }, /set by GuildServer/],
    [{ 'content-length': '0' }, /set by GuildServer/],
    [{ 'X-Token': 'a\r\nX-Injected: 1' }, /Invalid value/],
    [{ 'X-Token': 'a', 'x-token': 'b' }, /Duplicate/],
    [Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`X-H${i}`, 'v'])), /at most 10/],
  ])('refuses %j', (headers, reason) => {
    expect(() => validateDrainHeaders(headers as Record<string, string>)).toThrow(DrainConfigError);
    expect(() => validateDrainHeaders(headers as Record<string, string>)).toThrow(reason);
  });
});
