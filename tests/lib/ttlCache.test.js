const { wrapWithTtlCache } = require('../../src/lib/ttlCache');

describe('wrapWithTtlCache', () => {
  it('reuses a call\'s result for the same args within the TTL window', async () => {
    const impl = vi.fn().mockResolvedValue('result');
    const client = { read: impl };
    const wrapped = wrapWithTtlCache(client, ['read'], 10000);

    await wrapped.read('a');
    await wrapped.read('a');
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('calls through again once the TTL expires', async () => {
    vi.useFakeTimers();
    try {
      const impl = vi.fn().mockResolvedValue('result');
      const client = { read: impl };
      const wrapped = wrapWithTtlCache(client, ['read'], 1000);

      await wrapped.read('a');
      vi.advanceTimersByTime(1001);
      await wrapped.read('a');
      expect(impl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches per distinct argument list', async () => {
    const impl = vi.fn().mockResolvedValue('result');
    const client = { read: impl };
    const wrapped = wrapWithTtlCache(client, ['read'], 10000);

    await wrapped.read('a');
    await wrapped.read('b');
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('does not cache a rejection — the next call retries', async () => {
    const impl = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    const client = { read: impl };
    const wrapped = wrapWithTtlCache(client, ['read'], 10000);

    await expect(wrapped.read('a')).rejects.toThrow('boom');
    await expect(wrapped.read('a')).resolves.toBe('ok');
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('leaves methods not in the wrapped list untouched', async () => {
    const write = vi.fn().mockResolvedValue('written');
    const client = { read: vi.fn().mockResolvedValue('r'), write };
    const wrapped = wrapWithTtlCache(client, ['read'], 10000);

    await wrapped.write('x');
    await wrapped.write('x');
    expect(write).toHaveBeenCalledTimes(2);
  });
});
