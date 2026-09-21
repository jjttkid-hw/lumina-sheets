import { describe, expect, it, vi } from 'vitest';
import { LuminaPersistence } from '../src/lib/persistence';
import { createBlankWorkbook } from '../src/lib/seed';

// Controlled cursor events retain the adapter's real transaction completion
// boundary. They do not certify native IndexedDB rollback.
describe('snapshot journal cleanup failure', () => {
  it.each(['sequence', 'delete', 'continue'] as const)(
    'rolls back snapshot and journal after %s failure and retains pending edits for retry',
    async (failure) => {
      const p = new LuminaPersistence({
        forceMemory: true,
        flushDelayMs: 60000,
        storage: { getItem: () => null, setItem() {} },
      });
      const book = createBlankWorkbook();
      await p.putWorkbook(book);
      p.queueCellPatch(book.id, book.sheets[0].id, 'A1', { value: 'keep pending' });
      const internal = p as any;
      const memory = internal.memory;
      const original = structuredClone(internal.pending[0]);
      const records: any[] = [original, { ...original, seq: original.seq - 1 }];
      if (failure === 'sequence') records[1].seq = '0';
      let committedBook = book;
      let committedRecords = [...records];
      let failing = true;
      let aborted = 0;
      const db = {
        transaction: () => {
          let stagedBook = committedBook;
          const stagedRecords = [...committedRecords];
          const request: any = { result: null };
          let index = 0;
          let stopped = false;
          const tx: any = {
            abort: () => {
              stopped = true;
              aborted++;
              queueMicrotask(() => tx.onabort());
            },
            objectStore: (name: string) =>
              name === 'workbooks'
                ? {
                    put: (row: any) => {
                      stagedBook = row.workbook;
                    },
                  }
                : { openCursor: () => request },
          };
          queueMicrotask(() => {
            while (!stopped && index < committedRecords.length) {
              const position = index++;
              const record = committedRecords[position];
              request.result = {
                value: record,
                delete: () => {
                  if (failing && failure === 'delete' && position === 1)
                    throw new Error('delete failed');
                  stagedRecords.splice(stagedRecords.indexOf(record), 1);
                },
                continue: () => {
                  if (failing && failure === 'continue' && position === 1)
                    throw new Error('continue failed');
                },
              };
              request.onsuccess();
            }
            if (!stopped) {
              request.result = null;
              request.onsuccess();
              committedBook = stagedBook;
              committedRecords = stagedRecords;
              tx.oncomplete();
            }
          });
          return tx;
        },
      };
      internal.memory = null;
      vi.spyOn(internal, 'openDb').mockResolvedValue(db);
      const changed = { ...book, name: 'replacement' };
      await expect(p.putWorkbook(changed)).rejects.toThrow('aborted');
      expect(aborted).toBe(1);
      expect(committedBook).toEqual(book);
      expect(committedRecords).toEqual(records);
      expect(p.stats.pendingPatches).toBe(1);
      expect(internal.pending[0]).toEqual(original);
      failing = false;
      committedRecords[1] = { ...records[1], seq: original.seq - 1 };
      await p.putWorkbook(changed);
      expect(committedBook).toEqual(changed);
      expect(committedRecords).toEqual([]);
      expect(p.stats.pendingPatches).toBe(0);
      internal.memory = memory;
      await p.close();
    },
  );
});
