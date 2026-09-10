/**
 * Which container answers for an application during a rolling deploy.
 *
 * Three containers can briefly share `gs.app.id`: the incumbent, the unrouted
 * candidate under health gating, and the promoted replacement. Picking the
 * wrong one shows a user the wrong logs, or restarts a container that is about
 * to be discarded.
 */
import { pickServingContainer } from '../../src/services/docker/container';
import { GS_ROLE_CANDIDATE, GS_ROLE_LABEL } from '../../src/services/docker/primitives';

const APP = 'gs.app.id';

function container(id: string, created: number, extra: Record<string, string> = {}) {
  return {
    Id: id,
    Created: created,
    Names: [`/${id}`],
    Labels: { [APP]: 'app-1', ...extra },
  } as any;
}

const candidate = (id: string, created: number) =>
  container(id, created, { [GS_ROLE_LABEL]: GS_ROLE_CANDIDATE });

describe('pickServingContainer', () => {
  it('returns null when nothing is running', () => {
    expect(pickServingContainer([])).toBeNull();
  });

  it('returns the only container when there is one', () => {
    expect(pickServingContainer([container('a', 100)])?.Id).toBe('a');
  });

  it('never picks the candidate over the incumbent, whatever the list order', () => {
    // The candidate is newer, so "newest wins" alone would choose it. It is
    // unrouted by construction and must not be addressed.
    const incumbent = container('incumbent', 100);
    const cand = candidate('candidate', 200);

    expect(pickServingContainer([cand, incumbent])?.Id).toBe('incumbent');
    expect(pickServingContainer([incumbent, cand])?.Id).toBe('incumbent');
  });

  it('picks the promoted container once it exists alongside the incumbent', () => {
    // Mid-promotion both are routed; the newer one is the replacement.
    const incumbent = container('incumbent', 100);
    const promoted = container('promoted', 300);

    expect(pickServingContainer([incumbent, promoted])?.Id).toBe('promoted');
    expect(pickServingContainer([promoted, incumbent])?.Id).toBe('promoted');
  });

  it('ignores the candidate when incumbent and promoted are both present', () => {
    const chosen = pickServingContainer([
      candidate('candidate', 200),
      container('incumbent', 100),
      container('promoted', 300),
    ]);
    expect(chosen?.Id).toBe('promoted');
  });

  it('falls back to the candidate when it is the only container that exists', () => {
    // Early in a cold-start rolling deploy nothing is serving yet. Returning
    // the candidate beats reporting the app as absent.
    expect(pickServingContainer([candidate('candidate', 200)])?.Id).toBe('candidate');
  });

  it('treats a container with no labels as serving rather than skipping it', () => {
    // Containers created before the role label existed carry no gs.role.
    const legacy = { Id: 'legacy', Created: 100, Names: ['/legacy'] } as any;
    expect(pickServingContainer([legacy])?.Id).toBe('legacy');
  });

  it('is deterministic for equal creation times', () => {
    const a = container('a', 100);
    const b = container('b', 100);
    expect(pickServingContainer([a, b])?.Id).toBe(pickServingContainer([a, b])?.Id);
  });
});
