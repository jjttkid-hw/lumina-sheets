import { describe, expect, it, vi } from 'vitest';
import { collectRecoveryBackup } from '../src/lib/recovery-backup';
import { LuminaPersistence } from '../src/lib/persistence';
import { createBlankWorkbook } from '../src/lib/seed';
import { readRecoveryImport, restoreRecoveryWorkbook } from '../src/lib/recovery-import';
const local = (entries: Record<string, string>) => () =>
  ({
    length: Object.keys(entries).length,
    key: (index: number) => Object.keys(entries)[index],
    getItem: (key: string) => entries[key],
  }) as unknown as Storage;
describe('recovery backup', () => {
  it('rescues raw snapshots and broken journals when normal replay fails without rewriting storage', async () => {
    const book = createBlankWorkbook('日志损坏前');
    const source = new LuminaPersistence({
      forceMemory: true,
      storage: { getItem: () => null, setItem() {} },
    });
    await source.putWorkbook(book);
    const broken = [{ workbookId: book.id, seq: 1, at: 0, patch: { kind: 'unknown' } }];
    (source as any).memory.patches.set(book.id, broken);
    const backup = await collectRecoveryBackup(source, local({}));
    expect(backup.complete).toBe(false);
    expect(backup.records).toEqual([]);
    expect(backup.rawStorage!.stores.patches).toEqual([{ key: book.id, value: broken }]);
    const recovery = readRecoveryImport(JSON.parse(JSON.stringify(backup)))!;
    expect(recovery.records[0].source).toBe('原始快照（未重放日志）');
    expect(recovery.partial).toBe(true);
    expect(restoreRecoveryWorkbook(recovery, 0).name).toBe('日志损坏前（恢复副本）');
    expect((source as any).memory.patches.get(book.id)).toEqual(broken);
    await source.close();
  });
  it('reads raw stores independently and skips migration and replay in IndexedDB rescue', async () => {
    const book = createBlankWorkbook();
    const source = new LuminaPersistence({ forceMemory: true });
    const internal = source as any;
    internal.memory = null;
    const migration = vi.spyOn(internal, 'migrateLegacy');
    vi.spyOn(internal, 'openDb').mockResolvedValue({
      transaction: (name: string) => ({ objectStore: () => ({ getAll: () => ({ name }) }) }),
    });
    vi.spyOn(internal, 'request').mockImplementation(async (request: any) => {
      if (request.name === 'patches') throw new Error('unreadable');
      return request.name === 'workbooks' ? [{ id: book.id, workbook: book }] : [];
    });
    const raw = await source.readRecoveryStorage();
    expect(raw.stores.workbooks).toEqual([{ id: book.id, workbook: book }]);
    expect(raw.stores.comments).toEqual([]);
    expect(raw.warnings).toEqual(['原始存储读取失败：patches']);
    expect(migration).not.toHaveBeenCalled();
    const recovery = readRecoveryImport({
      format: 'lumina-recovery',
      version: 1,
      records: [],
      rawStorage: raw,
    })!;
    expect(restoreRecoveryWorkbook(recovery, 0).id).not.toBe(book.id);
    await source.close();
  });
  it('does not reinterpret explicitly null auxiliary records as empty lists in memory', async () => {
    const book = createBlankWorkbook();
    const source = new LuminaPersistence({
      forceMemory: true,
      storage: { getItem: () => null, setItem() {} },
    });
    await source.putWorkbook(book);
    (source as any).memory.comments.set(book.id, null);
    (source as any).memory.revisions.set(book.id, null);
    const backup = await collectRecoveryBackup(source, local({}));
    expect(backup.complete).toBe(false);
    expect(backup.records[0].comments).toBeNull();
    expect(backup.records[0].revisions).toBeNull();
    expect(backup.warnings).toHaveLength(2);
    expect(await source.loadComments('missing')).toEqual([]);
    expect(await source.loadRevisions('missing')).toEqual([]);
    await source.close();
  });
  it.each([null, { key: 'missing-payload' }, { comments: null, revisions: null }])(
    'does not reinterpret malformed stored auxiliary rows as empty lists: %s',
    async (row) => {
      const book = createBlankWorkbook();
      const source = new LuminaPersistence({
        forceMemory: true,
        storage: { getItem: () => null, setItem() {} },
      });
      const internal = source as any;
      internal.memory = null;
      vi.spyOn(source, 'loadWorkbooks').mockResolvedValue([book]);
      vi.spyOn(internal, 'openDb').mockResolvedValue({
        transaction: () => ({
          objectStore: () => ({
            get() {
              return {};
            },
          }),
        }),
      });
      const request = vi.spyOn(internal, 'request').mockResolvedValue(row);
      const backup = await collectRecoveryBackup(source, local({}));
      expect(backup.complete).toBe(false);
      expect(backup.warnings).toHaveLength(2);
      expect(backup.records[0].comments).toEqual(row && 'comments' in row ? row.comments : row);
      expect(backup.records[0].revisions).toEqual(row && 'revisions' in row ? row.revisions : row);
      request.mockResolvedValue(undefined);
      expect(await source.loadComments('missing')).toEqual([]);
      expect(await source.loadRevisions('missing')).toEqual([]);
      await source.close();
    },
  );
  it('preserves malformed IndexedDB rows while reading valid snapshots and replaying their patches', async () => {
    const book = createBlankWorkbook('有效主存储');
    const source = new LuminaPersistence({
      forceMemory: true,
      storage: { getItem: () => null, setItem() {} },
    });
    const internal = source as any;
    internal.memory = null;
    const rows = [
      { id: book.id, workbook: book },
      null,
      { id: 'missing-payload' },
      { id: 'bad', workbook: 42 },
    ];
    const before = structuredClone(rows);
    const patches = [
      {
        workbookId: book.id,
        seq: 1,
        at: 0,
        patch: { kind: 'cell', sheetId: book.sheets[0].id, key: 'A1', cell: { value: 123 } },
      },
    ];
    vi.spyOn(internal, 'openDb').mockResolvedValue({
      transaction: (store: string) => ({
        objectStore: () => ({ getAll: () => ({ data: store === 'workbooks' ? rows : patches }) }),
      }),
    });
    vi.spyOn(internal, 'request').mockImplementation(async (request: any) => request.data);
    vi.spyOn(source, 'loadComments').mockResolvedValue([]);
    vi.spyOn(source, 'loadRevisions').mockResolvedValue([]);
    const backup = await collectRecoveryBackup(source, local({}));
    expect(backup.complete).toBe(false);
    expect(backup.records[0].workbook.sheets[0].cells.A1.value).toBe(123);
    expect(backup.records.slice(1).map((record) => record.workbook)).toEqual([
      null,
      { id: 'missing-payload' },
      42,
    ]);
    expect(rows).toEqual(before);
    const recovered = readRecoveryImport(JSON.parse(JSON.stringify(backup)))!;
    expect(restoreRecoveryWorkbook(recovered, 0).sheets[0].cells.A1.value).toBe(123);
    expect(() => restoreRecoveryWorkbook(recovered, 2)).toThrow();
    await source.close();
  });
  it('rescues valid memory documents alongside a null stored snapshot through the real adapter', async () => {
    const book = createBlankWorkbook('有效正文');
    const source = new LuminaPersistence({
      forceMemory: true,
      storage: { getItem: () => null, setItem() {} },
    });
    await source.putWorkbook(book);
    (source as any).memory.workbooks.set('damaged', null);
    const backup = await collectRecoveryBackup(source, local({}));
    expect(backup.records.map((record) => record.workbook)).toEqual([book, null]);
    expect(backup.complete).toBe(false);
    expect(backup.warnings).toEqual(['工作簿目录条目 2 损坏，已保留原始内容']);
    const imported = readRecoveryImport(JSON.parse(JSON.stringify(backup)))!;
    expect(restoreRecoveryWorkbook(imported, 0).name).toBe('有效正文（恢复副本）');
    expect(() => restoreRecoveryWorkbook(imported, 1)).toThrow();
    expect((source as any).memory.workbooks.get('damaged')).toBeNull();
    await source.close();
  });
  it.each([null, { broken: true }, 'damaged directory', 42])(
    'retains a malformed workbook directory and still rescues legacy snapshots: %s',
    async (damaged) => {
      const book = createBlankWorkbook('可恢复文档');
      const comments = vi.fn(),
        revisions = vi.fn();
      const backup = await collectRecoveryBackup(
        {
          loadWorkbooks: async () => damaged as any,
          loadComments: comments,
          loadRevisions: revisions,
        },
        local({ 'lumina.v1.trash': JSON.stringify([book]) }),
      );
      const exported = JSON.parse(JSON.stringify(backup));
      expect(exported.complete).toBe(false);
      expect(exported.records).toEqual([]);
      expect(exported.damagedWorkbookDirectory).toEqual(damaged);
      expect(exported.warnings).toEqual([
        '工作簿目录不是列表，原始内容已保留在 damagedWorkbookDirectory',
      ]);
      expect(comments).not.toHaveBeenCalled();
      expect(revisions).not.toHaveBeenCalled();
      const recovery = readRecoveryImport(exported)!;
      expect(recovery.records[0].source).toBe('回收站');
      expect(restoreRecoveryWorkbook(recovery, 0).name).toBe('可恢复文档（恢复副本）');
    },
  );
  it('keeps damaged directory entries and continues rescuing valid workbooks', async () => {
    const book = createBlankWorkbook();
    const damaged = [null, { name: 'missing id' }, { id: 42 }];
    const comments = vi.fn(async () => []);
    const revisions = vi.fn(async () => []);
    const backup = await collectRecoveryBackup(
      {
        loadWorkbooks: async () => [...damaged, book] as any,
        loadComments: comments,
        loadRevisions: revisions,
      },
      local({}),
    );
    expect(backup.complete).toBe(false);
    expect(backup.records.map((item) => item.workbook)).toEqual([...damaged, book]);
    expect(backup.warnings).toHaveLength(3);
    expect(comments).toHaveBeenCalledExactlyOnceWith(book.id);
    expect(revisions).toHaveBeenCalledExactlyOnceWith(book.id);
    expect(backup.records[0].comments).toBeNull();
  });
  it('isolates synchronous auxiliary read failures and still reads other sections', async () => {
    const book = createBlankWorkbook();
    const revisions = vi.fn(async () => []);
    const backup = await collectRecoveryBackup(
      {
        loadWorkbooks: async () => [book],
        loadComments: () => {
          throw new Error('synchronous failure');
        },
        loadRevisions: revisions,
      },
      local({}),
    );
    expect(backup.complete).toBe(false);
    expect(backup.records[0].workbook).toBe(book);
    expect(backup.records[0].comments).toBeNull();
    expect(backup.records[0].revisions).toEqual([]);
    expect(revisions).toHaveBeenCalledExactlyOnceWith(book.id);
  });
  it('retains damaged auxiliary records but does not label them complete', async () => {
    const book = createBlankWorkbook();
    const comments = [null] as any;
    const revisions = [{ id: 'bad' }] as any;
    const backup = await collectRecoveryBackup(
      {
        loadWorkbooks: async () => [book],
        loadComments: async () => comments,
        loadRevisions: async () => revisions,
      },
      local({}),
    );
    expect(backup.complete).toBe(false);
    expect(backup.warnings).toEqual([
      `批注记录损坏，已保留原始内容：${book.id}`,
      `历史版本记录损坏，已保留原始内容：${book.id}`,
    ]);
    expect(backup.records[0].comments).toEqual([null]);
    expect(backup.records[0].revisions).toEqual([{ id: 'bad' }]);
  });
  it.each(['{}', 'not json'])(
    'marks malformed legacy lists as partial even after migration skips them: %s',
    async (raw) => {
      const book = createBlankWorkbook();
      const entries = {
        'lumina.v1.workbooks': JSON.stringify([book]),
        [`lumina.v1.history.${book.id}`]: raw,
      };
      const source = new LuminaPersistence({
        forceMemory: true,
        storage: {
          getItem: (key) => entries[key as keyof typeof entries] ?? null,
          setItem() {},
        },
      });
      const backup = await collectRecoveryBackup(source, local(entries));
      expect(backup.complete).toBe(false);
      expect(backup.warnings).toContain(
        `旧版列表记录损坏，已保留原始内容：lumina.v1.history.${book.id}`,
      );
      expect(backup.records[0].workbook).toEqual(book);
      expect(backup.legacy[`lumina.v1.history.${book.id}`]).toBe(raw);
      await source.close();
    },
  );
  it('collects current workbooks with queued patches, comments, revisions and only Lumina legacy keys', async () => {
    const source = new LuminaPersistence({ forceMemory: true, flushDelayMs: 60_000 });
    const book = createBlankWorkbook();
    await source.putWorkbook(book);
    await source.saveComments(book.id, [
      {
        id: 'comment',
        sheetId: book.sheets[0].id,
        cell: 'A1',
        text: 'note',
        createdAt: book.createdAt,
        resolved: false,
      },
    ]);
    await source.saveRevisions(book.id, [
      { id: 'rev', name: 'baseline', createdAt: book.createdAt, workbook: book },
    ]);
    source.queuePatch(book.id, {
      kind: 'cell',
      sheetId: book.sheets[0].id,
      key: 'A1',
      cell: { value: 12 },
    });
    try {
      const backup = await collectRecoveryBackup(
        source,
        local({ 'lumina.v1.trash': '[]', unrelated: 'private' }),
      );
      expect(backup.complete).toBe(true);
      expect(backup.records[0].workbook.sheets[0].cells.A1.value).toBe(12);
      expect(backup.records[0].comments?.[0].text).toBe('note');
      expect(backup.records[0].revisions?.[0].name).toBe('baseline');
      expect(backup.legacy).toEqual({ 'lumina.v1.trash': '[]' });
      backup.records[0].workbook.sheets[0].cells.A1.value = 99;
      expect((await source.loadWorkbooks())[0].sheets[0].cells.A1.value).toBe(12);
    } finally {
      await source.flush();
    }
  });
  it('keeps successful sections and explicitly labels partial failures', async () => {
    const book = createBlankWorkbook();
    const backup = await collectRecoveryBackup(
      {
        loadWorkbooks: async () => [book],
        loadComments: async () => {
          throw new Error('failed');
        },
        loadRevisions: async () => [],
      },
      () => {
        throw new Error('storage blocked');
      },
    );
    expect(backup.complete).toBe(false);
    expect(backup.warnings).toHaveLength(2);
    expect(backup.records[0].comments).toBeNull();
    expect(backup.records[0].revisions).toEqual([]);
    expect(backup.records[0].workbook).toBe(book);
  });
  it('retains legacy recovery data if the workbook store cannot be opened', async () => {
    const comments = vi.fn(),
      revisions = vi.fn();
    const backup = await collectRecoveryBackup(
      {
        loadWorkbooks: async () => {
          throw new Error('db');
        },
        loadComments: comments,
        loadRevisions: revisions,
      },
      local({ 'lumina.v1.workbooks': '["raw"]' }),
    );
    expect(backup.complete).toBe(false);
    expect(backup.records).toEqual([]);
    expect(backup.legacy['lumina.v1.workbooks']).toBe('["raw"]');
    expect(comments).not.toHaveBeenCalled();
  });
});
