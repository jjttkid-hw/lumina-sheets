import { describe, expect, it, vi } from 'vitest';
import { LuminaPersistence } from '../src/lib/persistence';
import { createBlankWorkbook } from '../src/lib/seed';

// Model transaction event delivery/commit, keeping the adapter's actual
// transaction promise and migration callbacks. This is not native IndexedDB.
function migrationDatabase(failure: 'key-setup' | 'put-setup' | 'request') {
  const committed = new Map<string, unknown>();
  let failing = true;
  let aborted = 0;
  let writesAttempted = 0;
  const db = {
    transaction: (_stores: string | string[], mode?: string) => {
      const pending: Array<() => void> = [];
      const staged = new Map<string, unknown>();
      let stopped = false;
      const tx: any = {
        error: null,
        abort: () => {
          stopped = true;
          aborted++;
          staged.clear();
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore: (name: string) => {
          const request = (result: unknown, fail = false) => {
            const req: any = { result, error: null };
            pending.push(() => {
              if (fail) {
                req.error = tx.error = new Error('simulated request failure');
                req.onerror?.();
                tx.onerror?.();
                tx.abort();
              } else req.onsuccess?.();
            });
            return req;
          };
          return {
            get: (key: string) => request(committed.get(`${name}:${key}`)),
            getKey: (key: string) => {
              if (failing && failure === 'key-setup') throw new Error('getKey setup failure');
              return request(committed.has(`${name}:${key}`) ? key : undefined);
            },
            put: (value: any) => {
              writesAttempted++;
              if (name === 'workbooks' && failing && failure === 'put-setup')
                throw new Error('put setup failure');
              staged.set(`${name}:${value.key ?? value.id}`, structuredClone(value));
              return request(undefined, name === 'workbooks' && failing && failure === 'request');
            },
          };
        },
      };
      queueMicrotask(() => {
        while (pending.length && !stopped) pending.shift()!();
        if (!stopped) {
          if (mode === 'readwrite') for (const [key, value] of staged) committed.set(key, value);
          tx.oncomplete?.();
        }
      });
      return tx;
    },
  };
  return {
    db,
    committed,
    repair: () => {
      failing = false;
    },
    get aborted() {
      return aborted;
    },
    get writesAttempted() {
      return writesAttempted;
    },
  };
}

describe('legacy migration transaction failure and retry', () => {
  it.each(['key-setup', 'put-setup', 'request'] as const)(
    'does not commit data or the completion marker after %s failure and allows a fresh retry',
    async (failure) => {
      const book = createBlankWorkbook('recover after failure');
      const raw = JSON.stringify([book]);
      const getItem = vi.fn((key: string) => (key === 'lumina.v1.workbooks' ? raw : null));
      const setItem = vi.fn();
      const p = new LuminaPersistence({ forceMemory: true, storage: { getItem, setItem } });
      const internal = p as any;
      internal.memory = null;
      const database = migrationDatabase(failure);
      vi.spyOn(internal, 'openDb').mockResolvedValue(database.db);
      // Only directory reads are replaced; marker requests and transaction
      // completion/abort use the adapter's real request/transaction methods.
      vi.spyOn(internal, 'idbGetAllWorkbooks').mockImplementation(async () =>
        [...database.committed.entries()]
          .filter(([key]) => key.startsWith('workbooks:'))
          .map(([, row]: any) => structuredClone(row.workbook)),
      );
      vi.spyOn(internal, 'idbGetAllPatches').mockResolvedValue([]);
      await expect(p.loadWorkbooks()).rejects.toThrow();
      expect(database.aborted).toBe(1);
      expect(database.committed.size).toBe(0);
      expect(internal.migrationPromise).toBeNull();
      expect(setItem).not.toHaveBeenCalled();
      database.repair();
      expect(await p.loadWorkbooks()).toEqual([book]);
      expect(database.committed.get('meta:legacy-v1-migrated')).toEqual({
        key: 'legacy-v1-migrated',
        value: true,
      });
      const writes = database.writesAttempted;
      expect(await p.loadWorkbooks()).toEqual([book]);
      expect(database.writesAttempted).toBe(writes);
      expect(setItem).not.toHaveBeenCalled();
      await p.close();
    },
  );
});
