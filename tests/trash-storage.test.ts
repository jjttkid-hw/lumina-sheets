import { afterEach, expect, it, vi } from 'vitest';
import { readCurrentTrash, assertTrashSource, withTrashLock } from '../src/lib/trash-storage';
import { createBlankWorkbook } from '../src/lib/seed';
afterEach(() => vi.unstubAllGlobals());
it('uses the same exclusive lock and reads only after acquisition', async () => {
  let enter!: () => void;
  const request = vi.fn(
    (_name, _options, callback) =>
      new Promise<void>((resolve) => {
        enter = () => {
          callback();
          resolve();
        };
      }),
  );
  vi.stubGlobal('navigator', { locks: { request } });
  const operation = vi.fn();
  const pending = withTrashLock(operation);
  expect(request).toHaveBeenCalledWith('lumina.v1.trash', { mode: 'exclusive' }, operation);
  expect(operation).not.toHaveBeenCalled();
  enter();
  await pending;
  expect(operation).toHaveBeenCalledOnce();
});
it('does not fall back to an unlocked write if lock acquisition fails', async () => {
  vi.stubGlobal('navigator', {
    locks: { request: vi.fn().mockRejectedValue(new Error('lock denied')) },
  });
  const write = vi.fn();
  await expect(withTrashLock(write)).rejects.toThrow('lock denied');
  expect(write).not.toHaveBeenCalled();
});
it('preserves synchronous fallback results and failures when Web Locks is unavailable', async () => {
  vi.stubGlobal('navigator', {});
  await expect(withTrashLock(() => 42)).resolves.toBe(42);
  await expect(
    withTrashLock(() => {
      throw new Error('write failed');
    }),
  ).rejects.toThrow('write failed');
});
it.each(['{}', 'bad json', '[null]', '[{"id":42}]'])(
  'rejects damaged storage instead of treating it as empty (%s)',
  (raw) => {
    vi.stubGlobal('localStorage', { getItem: () => raw });
    expect(() => readCurrentTrash()).toThrow();
  },
);
it('reads the latest directory and propagates denied reads', () => {
  const book = createBlankWorkbook();
  const getItem = vi
    .fn()
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(JSON.stringify([book]))
    .mockImplementationOnce(() => {
      throw new Error('denied');
    });
  vi.stubGlobal('localStorage', { getItem });
  expect(readCurrentTrash()).toEqual([]);
  expect(readCurrentTrash()).toEqual([book]);
  expect(() => readCurrentTrash()).toThrow('denied');
});
it('requires exactly the reviewed source while preserving unrelated current entries', () => {
  const book = createBlankWorkbook(),
    other = createBlankWorkbook();
  expect(() => assertTrashSource([other, structuredClone(book)], book)).not.toThrow();
  for (const current of [[], [book, book], [{ ...book, name: 'new' }]])
    expect(() => assertTrashSource(current, book)).toThrow('已变化');
});
it('rejects duplicate IDs and non-renderable directory metadata while retaining raw storage', () => {
  const book = createBlankWorkbook();
  for (const entries of [
    [book, book],
    [{ ...book, name: {} }],
    [{ ...book, sheets: null }],
    [{ ...book, updatedAt: 'bad' }],
  ]) {
    const raw = JSON.stringify(entries);
    const getItem = vi.fn(() => raw);
    vi.stubGlobal('localStorage', { getItem });
    expect(() => readCurrentTrash()).toThrow('回收站');
    expect(getItem()).toBe(raw);
  }
});
