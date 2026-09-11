import { TRPCError } from '@trpc/server';
import { RestError, toRestError } from '../../src/rest/v1/errors';

describe('toRestError', () => {
  it('passes a RestError through unchanged', () => {
    const e = new RestError('BAD_REQUEST', 'nope');
    expect(toRestError(e)).toBe(e);
  });

  it.each([
    ['NOT_FOUND', 'NOT_FOUND'],
    ['UNAUTHORIZED', 'UNAUTHORIZED'],
    ['FORBIDDEN', 'FORBIDDEN'],
    ['BAD_REQUEST', 'BAD_REQUEST'],
    ['PRECONDITION_FAILED', 'BAD_REQUEST'],
    ['CONFLICT', 'BAD_REQUEST'],
    ['TOO_MANY_REQUESTS', 'RATE_LIMITED'],
  ] as const)('maps tRPC %s to %s', (trpc, rest) => {
    expect(toRestError(new TRPCError({ code: trpc, message: 'm' })).code).toBe(rest);
  });

  it('never carries the message of an unrecognised error', () => {
    const out = toRestError(new Error('password=hunter2 at /srv/app/db.ts:40'));
    expect(out.code).toBe('INTERNAL');
    expect(out.message).toBe('Internal error');
  });

  it('treats a tRPC internal error as unrecognised too', () => {
    const out = toRestError(new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'relation "x" does not exist' }));
    expect(out).toMatchObject({ code: 'INTERNAL', message: 'Internal error' });
  });

  it('does not describe a NOT_FOUND differently depending on the original message', () => {
    // Existence must not leak through wording.
    const a = toRestError(new TRPCError({ code: 'NOT_FOUND', message: 'Application not found or access denied' }));
    const b = toRestError(new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found' }));
    expect(a.message).toBe(b.message);
  });
});
