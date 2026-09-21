import { afterEach, describe, expect, it, vi } from 'vitest';
import { LuminaPersistence } from '../src/lib/persistence';
function setup() {
  const requests: any[] = [];
  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
      const request = { result: { close: vi.fn() }, transaction: { abort: vi.fn() } };
      requests.push(request);
      return request;
    }),
  });
  const p = new LuminaPersistence({ storage: { getItem: () => null, setItem() {} } });
  return { p, requests, open: () => (p as any).openDb() as Promise<any> };
}
afterEach(() => vi.unstubAllGlobals());
describe('database connection lifecycle', () => {
  it.each(['request', 'synchronous'])(
    'retains queued edits and the durable backend after a %s reconnect failure',
    async (failure) => {
      const { p, requests, open } = setup();
      const first = open();
      requests[0].onsuccess();
      (await first).onclose();
      p.queueCellPatch('book', 'sheet', 'A1', { value: 'unsaved' });
      const identity = (p as any).pending[0].operationId;
      if (failure === 'synchronous')
        vi.mocked(indexedDB.open).mockImplementationOnce(() => {
          throw new Error('unavailable');
        });
      const failed = p.flush();
      const rejected = expect(failed).rejects.toThrow('重新连接失败');
      if (failure === 'request') {
        await vi.waitFor(() => expect(requests).toHaveLength(2));
        requests[1].error = { name: 'UnknownError' };
        requests[1].onerror();
      }
      await rejected;
      expect(p.stats.backend).toBe('indexeddb');
      expect(p.stats.pendingPatches).toBe(1);
      expect(p.stats.persistedPatches).toBe(0);
      expect((p as any).pending[0].operationId).toBe(identity);
      const retry = open();
      requests.at(-1).onsuccess();
      const db = await retry;
      const writes: any[] = [];
      db.transaction = () => {
        const tx: any = { objectStore: () => ({ put: (value: any) => writes.push(value) }) };
        queueMicrotask(() => tx.oncomplete());
        return tx;
      };
      await p.flush();
      expect(writes).toHaveLength(1);
      expect(writes[0].operationId).toBe(identity);
      expect(writes[0].patch.cell.value).toBe('unsaved');
      expect(p.stats.pendingPatches).toBe(0);
      expect(p.stats.persistedPatches).toBe(1);
      await p.close();
    },
  );
  it('reopens after unexpected closure and ignores stale events from the old connection', async () => {
    const { p, requests, open } = setup();
    const first = open();
    requests[0].onsuccess();
    const old = await first;
    old.onclose();
    const retry = open();
    expect(open()).toBe(retry);
    requests[1].onsuccess();
    const current = await retry;
    old.onversionchange();
    old.onclose();
    expect(await open()).toBe(current);
    expect(requests).toHaveLength(2);
    expect(current.close).not.toHaveBeenCalled();
    expect(p.stats.backend).toBe('indexeddb');
    await p.close();
  });
  it('reopens after explicit close without relying on a native close event', async () => {
    const { p, requests, open } = setup();
    const first = open();
    requests[0].onsuccess();
    await first;
    await p.close();
    expect(requests[0].result.close).toHaveBeenCalledOnce();
    const retry = open();
    expect(requests).toHaveLength(2);
    requests[1].onsuccess();
    expect(await retry).toBe(requests[1].result);
    requests[0].result.onclose();
    expect(await open()).toBe(requests[1].result);
    await p.close();
  });
  it('releases the connection even when a pending save fails during close', async () => {
    const { p, requests, open } = setup();
    const first = open();
    requests[0].onsuccess();
    await first;
    const failure = new Error('save failed');
    const flush = vi.spyOn(p, 'flush').mockRejectedValue(failure);
    await expect(p.close()).rejects.toBe(failure);
    expect(requests[0].result.close).toHaveBeenCalledOnce();
    const retry = open();
    expect(requests).toHaveLength(2);
    requests[1].onsuccess();
    expect(await retry).toBe(requests[1].result);
    flush.mockRestore();
    await p.close();
  });
  it('rejects blocked opens, retries, and discards late events without changing the new connection', async () => {
    const { p, requests, open } = setup();
    const first = open();
    const rejected = expect(first).rejects.toThrow('其他页面');
    requests[0].onblocked();
    await rejected;
    expect(p.stats.backend).toBe('indexeddb');
    const retry = open();
    requests[0].onupgradeneeded();
    expect(requests[0].transaction.abort).toHaveBeenCalledOnce();
    requests[0].onerror();
    requests[1].onsuccess();
    expect(await retry).toBe(requests[1].result);
    requests[0].onsuccess();
    expect(requests[0].result.close).toHaveBeenCalledOnce();
    expect(await open()).toBe(requests[1].result);
    await p.close();
  });
  it('closes on versionchange and rejects incompatible newer databases instead of falling back to an empty memory workspace', async () => {
    const { p, requests, open } = setup();
    const first = open();
    requests[0].onsuccess();
    await first;
    requests[0].result.onversionchange();
    expect(requests[0].result.close).toHaveBeenCalledOnce();
    const retry = open();
    const rejected = expect(retry).rejects.toThrow('较新版本');
    requests[1].error = { name: 'VersionError' };
    requests[1].onerror();
    await rejected;
    expect(p.stats.backend).toBe('indexeddb');
    const repaired = open();
    requests[2].onsuccess();
    expect(await repaired).toBe(requests[2].result);
    await p.close();
  });
});
