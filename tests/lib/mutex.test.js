const { RefLockManager, LockHeldError } = require('../../src/lib/mutex');
const { refKey, SHORT_REF_STAGING } = require('../../src/lib/constants');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('RefLockManager', () => {
  it('serializes two withLock calls on the same ref', async () => {
    const mgr = new RefLockManager();
    const order = [];

    const a = mgr.withLock('refs/heads/staging', 'a', 'corr-a', async () => {
      order.push('a-start');
      await delay(30);
      order.push('a-end');
    });
    const b = mgr.withLock('refs/heads/staging', 'b', 'corr-b', async () => {
      order.push('b-start');
      await delay(5);
      order.push('b-end');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('runs withLock calls on different refs concurrently', async () => {
    const mgr = new RefLockManager();
    const order = [];

    const a = mgr.withLock('refs/heads/staging', 'a', 'corr-a', async () => {
      order.push('a-start');
      await delay(30);
      order.push('a-end');
    });
    const b = mgr.withLock('refs/heads/develop', 'b', 'corr-b', async () => {
      order.push('b-start');
      await delay(5);
      order.push('b-end');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'b-start', 'b-end', 'a-end']);
  });

  it('withLockOrReject throws LockHeldError immediately instead of queueing', async () => {
    const mgr = new RefLockManager();
    let resolveFirst;
    const firstHeld = new Promise((resolve) => { resolveFirst = resolve; });

    const first = mgr.withLock('refs/heads/staging', 'first', 'corr-1', async () => {
      await firstHeld;
    });

    await delay(5); // let the first lock actually acquire
    await expect(
      mgr.withLockOrReject('refs/heads/staging', 'second', 'corr-2', async () => {})
    ).rejects.toBeInstanceOf(LockHeldError);

    resolveFirst();
    await first;
  });

  it('withLockOrReject succeeds when the ref is free', async () => {
    const mgr = new RefLockManager();
    const result = await mgr.withLockOrReject('refs/heads/staging', 'solo', 'corr-1', async () => 'done');
    expect(result).toBe('done');
  });

  it('records lock_events acquire/release with held_ms via an attached repo', async () => {
    const mgr = new RefLockManager();
    const rows = [];
    mgr.attachRepo({
      insertAcquire: (row) => { rows.push({ ...row, released: false }); return rows.length - 1; },
      recordRelease: ({ id, releasedAt, heldMs }) => { rows[id].released = true; rows[id].releasedAt = releasedAt; rows[id].heldMs = heldMs; },
    });

    await mgr.withLock('refs/heads/staging', 'holder', 'corr-1', async () => delay(10));

    expect(rows).toHaveLength(1);
    expect(rows[0].released).toBe(true);
    expect(rows[0].heldMs).toBeGreaterThanOrEqual(0);
  });

  it('snapshot reflects current lock state', async () => {
    const mgr = new RefLockManager();
    let resolveHold;
    const held = new Promise((resolve) => { resolveHold = resolve; });
    const p = mgr.withLock('refs/heads/staging', 'holder', 'corr-1', async () => held);
    await delay(5);

    const snap = mgr.snapshot();
    const stagingRow = snap.find((s) => s.ref === 'refs/heads/staging');
    expect(stagingRow.locked).toBe(true);
    expect(stagingRow.holder).toBe('holder');

    resolveHold();
    await p;

    const snapAfter = mgr.snapshot();
    expect(snapAfter.find((s) => s.ref === 'refs/heads/staging').locked).toBe(false);
  });

  it('namespaces lock keys per repo — two different repos\' staging branches never serialize each other', async () => {
    const mgr = new RefLockManager();
    const order = [];

    const repoAKey = refKey('acme', 'widgets', SHORT_REF_STAGING);
    const repoBKey = refKey('other', 'repo', SHORT_REF_STAGING);
    expect(repoAKey).not.toBe(repoBKey);

    const a = mgr.withLock(repoAKey, 'a', 'corr-a', async () => {
      order.push('a-start');
      await delay(30);
      order.push('a-end');
    });
    const b = mgr.withLock(repoBKey, 'b', 'corr-b', async () => {
      order.push('b-start');
      await delay(5);
      order.push('b-end');
    });

    await Promise.all([a, b]);
    // If these were wrongly serialized (e.g. both keyed by the bare
    // 'refs/heads/staging' string), b would only start after a finished.
    expect(order).toEqual(['a-start', 'b-start', 'b-end', 'a-end']);
  });

  it('snapshot(extraKeys) includes never-touched keys as idle', () => {
    const mgr = new RefLockManager();
    const snap = mgr.snapshot(['acme/widgets#refs/heads/staging', 'acme/widgets#refs/heads/develop']);
    expect(snap).toEqual([
      { ref: 'acme/widgets#refs/heads/staging', locked: false, holder: null, acquiredAt: null, heldMs: null },
      { ref: 'acme/widgets#refs/heads/develop', locked: false, holder: null, acquiredAt: null, heldMs: null },
    ]);
  });

  it('records repo_owner/repo_name on lock_events, parsed from the namespaced key', async () => {
    const mgr = new RefLockManager();
    const rows = [];
    mgr.attachRepo({
      insertAcquire: (row) => { rows.push(row); return rows.length - 1; },
      recordRelease: () => {},
    });

    await mgr.withLock(refKey('acme', 'widgets', SHORT_REF_STAGING), 'holder', 'corr-1', async () => {});

    expect(rows[0].repoOwner).toBe('acme');
    expect(rows[0].repoName).toBe('widgets');
  });
});
