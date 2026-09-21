import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import type { Workbook } from '../src/lib/types';
import {
  readXlsxArchive,
  writeXlsxArchive,
  xmlChild,
  xmlChildren,
  xmlElement,
} from '../src/lib/xlsx-archive';
const files = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../src/lib/io', async (original) => ({
  ...(await original<typeof import('../src/lib/io')>()),
  importFile: files.read,
}));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render() {}, unmount() {} }) }));
import { LuminaSpreadsheet } from '../src/sdk';
class Host {
  className = '';
  classList = { add() {} };
}
const instances: LuminaSpreadsheet[] = [];
function make() {
  const grid = new LuminaSpreadsheet(new Host() as unknown as HTMLElement);
  instances.push(grid);
  grid.setCell('A1', 'original');
  return grid;
}
function deferred() {
  let resolve!: (value: Workbook) => void, reject!: (error: Error) => void;
  const promise = new Promise<Workbook>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
function imported(value: string) {
  const book = createBlankWorkbook();
  book.sheets[0].cells.A1 = { value };
  return book;
}
const file = () => new File(['{}'], 'data.json');
const outcome = (promise: Promise<void>) =>
  promise.then(
    () => undefined,
    (error: Error) => error,
  );
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Host);
  files.read.mockReset();
});
afterEach(() => {
  instances.splice(0).forEach((grid) => grid.destroy());
  vi.unstubAllGlobals();
});

describe('SDK asynchronous import ownership', () => {
  it.each(['conflicting payloads', 'unknown type'])(
    'preserves the workbook and history when an XLSX cell has %s',
    async (kind) => {
      const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
      files.read.mockImplementation(actual.importFile);
      const candidate = imported('candidate');
      const archive = await readXlsxArchive(await actual.workbookToXlsx(candidate));
      const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
      const cell = xmlChildren(row, 'c')[0];
      if (kind === 'conflicting payloads')
        cell.children.push(xmlElement('is', {}, [xmlElement('t', {}, ['conflicting text'])]));
      else cell.attributes.t = 'custom';
      const grid = make();
      grid.setCell('B1', 42);
      const before = grid.toJSON();
      await expect(
        grid.import(new File([await writeXlsxArchive(archive)], 'conflicting.xlsx')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(grid.toJSON()).toEqual(before);
      grid.undo();
      expect(grid.getValue('B1')).toBe('');
      grid.redo();
      expect(grid.getValue('B1')).toBe(42);
    },
  );
  it('discards incrementally built CSV cells when a later row is malformed', async () => {
    const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
    files.read.mockImplementation(actual.importFile);
    const grid = make();
    grid.setCell('B1', 42);
    const before = grid.toJSON();
    const text = Array(9000).fill('value,12').join('\n') + '\n"unterminated';
    await expect(grid.import(new File([text], 'partial.csv'))).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(grid.toJSON()).toEqual(before);
    grid.undo();
    expect(grid.getValue('B1')).toBe('');
    grid.redo();
    expect(grid.getValue('B1')).toBe(42);
  });
  it.each(['abort', 'edit', 'destroy'])(
    'stops late byte decoding when import is cancelled by %s',
    async (kind) => {
      const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
      files.read.mockImplementation(actual.importFile);
      const grid = make();
      const controller = new AbortController();
      const file = new File(['pending'], 'slow.csv');
      let finish!: (bytes: ArrayBuffer) => void;
      vi.spyOn(file, 'arrayBuffer').mockReturnValue(
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
      );
      const decode = vi.spyOn(TextDecoder.prototype, 'decode');
      try {
        const pending = grid.import(file, { signal: controller.signal }).catch((error) => error);
        if (kind === 'abort') controller.abort();
        else if (kind === 'edit') grid.setCell('A1', 'new edit');
        else grid.destroy();
        expect(await pending).toMatchObject({ code: 'IMPORT_CANCELLED' });
        finish(new TextEncoder().encode('late file').buffer);
        for (let i = 0; i < 12; i++) await Promise.resolve();
        expect(decode).not.toHaveBeenCalled();
        if (kind !== 'destroy')
          expect(grid.getValue('A1')).toBe(kind === 'edit' ? 'new edit' : 'original');
      } finally {
        decode.mockRestore();
      }
    },
  );
  it.each(['csv', 'tsv', 'json'])(
    'rejects damaged %s bytes without changing data or history and permits a valid retry',
    async (ext) => {
      const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
      files.read.mockImplementation(actual.importFile);
      const grid = make();
      grid.setCell('B1', 'keep edit');
      const before = grid.toJSON();
      const text = ext === 'json' ? JSON.stringify(imported('BYTE_MARKER')) : 'BYTE_MARKER';
      const [prefix, suffix] = text.split('BYTE_MARKER');
      await expect(
        grid.import(new File([prefix, new Uint8Array([0xff]), suffix], `bad.${ext}`)),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: expect.stringContaining('UTF-8'),
      });
      expect(grid.toJSON()).toEqual(before);
      grid.undo();
      expect(grid.getValue('B1')).toBe('');
      grid.redo();
      expect(grid.getValue('B1')).toBe('keep edit');
      await grid.import(new File([text.replace('BYTE_MARKER', '中文😀�')], `valid.${ext}`));
      expect(grid.getValue('A1')).toBe('中文😀�');
    },
  );
  it('rejects an array-formula file without changing the workbook or its undo history', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
    files.read.mockImplementation(actual.importFile);
    const external = new ExcelJS.Workbook();
    const sheet = external.addWorksheet('Arrays');
    const formula = {
      formula: 'ROW(A1:A2)',
      result: 1,
      shareType: 'array',
      ref: 'A1:A2',
    };
    sheet.getCell('A1').value = formula;
    sheet.getCell('A2').value = 2;
    const grid = make();
    grid.setCell('B1', 'keep edit');
    const before = grid.toJSON();
    await expect(
      grid.import(new File([(await external.xlsx.writeBuffer()) as ArrayBuffer], 'array.xlsx')),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(grid.toJSON()).toEqual(before);
    grid.undo();
    expect(grid.getValue('B1')).toBe('');
    grid.redo();
    expect(grid.getValue('B1')).toBe('keep edit');
  });
  it('keeps underflowing CSV values as text through the public import path', async () => {
    const grid = make();
    const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
    files.read.mockImplementation(actual.importFile);
    await grid.import(new File(['1e-999,3e-324,-0.00,123.5'], 'numbers.csv'));
    expect(['A1', 'B1', 'C1', 'D1'].map((key) => grid.getCell(key)?.value)).toEqual([
      '1e-999',
      '3e-324',
      '-0.00',
      123.5,
    ]);
  });

  it('retains trailing blank fields and records through the public file import path', async () => {
    const grid = make();
    const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
    const { workbookCsvBlob } = await import('../src/lib/io-stream');
    files.read.mockImplementation(actual.importFile);
    const text = '7,,\r\n,,\r\n';
    await grid.import(new File([text], 'tail.csv'));
    expect(await (await workbookCsvBlob(grid.toJSON())).text()).toBe(text);
    expect(Object.keys(grid.toJSON().sheets[0].cells)).toHaveLength(2);
  });

  it('imports paging metadata through the real JSON parser and keeps the sheet readonly', async () => {
    const grid = make();
    const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
    files.read.mockImplementation(actual.importFile);
    const incoming = imported('partial');
    incoming.sheets[0].dataSource = { kind: 'paged', totalRows: 1000, pageSize: 32 };
    await grid.import(new File([JSON.stringify(incoming)], 'paged.json'));
    expect(grid.activeSheetInfo.readOnly).toBe(true);
    expect(grid.toJSON().sheets[0].dataSource).toEqual(incoming.sheets[0].dataSource);
    expect(() => grid.setCell('A1', 'changed')).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    await expect(grid.export('xlsx')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const before = grid.toJSON();
    Object.assign(incoming.sheets[0], { dataSource: { kind: 'paged', totalRows: -1 } });
    await expect(
      grid.import(new File([JSON.stringify(incoming)], 'bad.json')),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(grid.toJSON()).toEqual(before);
    expect(() => grid.load(incoming)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(grid.toJSON()).toEqual(before);
  });
  it('imports TSV through the real parser and keeps the workbook/history on malformed input', async () => {
    const grid = make();
    const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
    files.read.mockImplementation(actual.importFile);
    await grid.import(new File(['地区,城市\t金额\n中国,上海\t12'], 'sales.tsv'));
    expect(grid.getValue('A2')).toBe('中国,上海');
    expect(grid.getValue('B2')).toBe(12);
    grid.setCell('B2', 24);
    const before = grid.toJSON();
    await expect(grid.import(new File(['"bad'], 'invalid.tsv'))).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(grid.toJSON()).toEqual(before);
    grid.undo();
    expect(grid.getValue('B2')).toBe(12);
    grid.redo();
    expect(grid.getValue('B2')).toBe(24);
  });
  it.each(['cell-alias', 'sheet-id'])(
    'rejects ambiguous JSON %s through the real parser without changing data or history',
    async (kind) => {
      const grid = make();
      grid.setCell('B1', 12);
      const snapshot = grid.toJSON();
      const incoming = imported('incoming');
      if (kind === 'cell-alias') incoming.sheets[0].cells.$A$1 = { value: 'conflict' };
      else incoming.sheets.push({ ...structuredClone(incoming.sheets[0]), name: 'Second' });
      const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
      files.read.mockImplementation(actual.importFile);
      await expect(
        grid.import(new File([JSON.stringify(incoming)], 'ambiguous.json')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(grid.toJSON()).toEqual(snapshot);
      grid.undo();
      expect(grid.getValue('B1')).toBe('');
      expect(grid.getValue('A1')).toBe('original');
      grid.redo();
      expect(grid.getValue('B1')).toBe(12);
      await grid.import(new File([JSON.stringify(imported('valid'))], 'valid.json'));
      expect(grid.getValue('A1')).toBe('valid');
    },
  );
  it('keeps the latest import when older parsing finishes later', async () => {
    const grid = make(),
      first = deferred(),
      second = deferred();
    files.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const old = outcome(grid.import(file()));
    const latest = grid.import(file());
    expect(await old).toMatchObject({ code: 'IMPORT_CANCELLED' });
    second.resolve(imported('new'));
    await latest;
    first.resolve(imported('old'));
    await Promise.resolve();
    expect(grid.getValue('A1')).toBe('new');
  });
  it.each([
    'cell',
    'style',
    'layout',
    'rules',
    'print',
    'structure',
    'rename',
    'undo',
    'load',
    'data',
  ])('cancels an outstanding import before a successful %s mutation', async (kind) => {
    const grid = make(),
      pending = deferred();
    files.read.mockReturnValue(pending.promise);
    const result = outcome(grid.import(file()));
    switch (kind) {
      case 'cell':
        grid.setCell('A1', 'edit');
        break;
      case 'style':
        grid.setCell('A1', 'original', { bold: true });
        break;
      case 'layout':
        grid.setColumnWidth(0, 150);
        break;
      case 'rules':
        grid.setConditionalRules([]);
        break;
      case 'print':
        grid.setPrintSettings({ paperSize: 'A3' });
        break;
      case 'structure':
        grid.insertRows(0);
        break;
      case 'rename':
        grid.renameSheet('Renamed');
        break;
      case 'undo':
        grid.undo();
        break;
      case 'load':
        grid.load(imported('loaded'));
        break;
      case 'data':
        await grid.bindData({
          columnCount: 1,
          rowCount: 1,
          fetchPage: async () => ({ rows: [[9]], totalRows: 1 }),
        });
        break;
    }
    expect(await result).toMatchObject({ code: 'IMPORT_CANCELLED' });
    const snapshot = grid.toJSON();
    pending.resolve(imported('obsolete'));
    await Promise.resolve();
    expect(grid.toJSON()).toEqual(snapshot);
  });
  it('keeps the pending import through view changes and invalid edits', async () => {
    const grid = make(),
      pending = deferred();
    files.read.mockReturnValue(pending.promise);
    const result = grid.import(file());
    grid.select({ row: 1, col: 1 });
    grid.setFilter('original');
    grid.setClipboardMode('all');
    grid.renameSheet(grid.activeSheetInfo.name);
    expect(() => grid.renameSheet('bad/name')).toThrow();
    expect(() => grid.setCell('invalid', 5)).toThrow();
    expect(() => grid.load({} as Workbook)).toThrow();
    pending.resolve(imported('accepted'));
    await result;
    expect(grid.getValue('A1')).toBe('accepted');
  });
  it('cancels promptly and consumes late parser errors after abort', async () => {
    const grid = make(),
      pending = deferred(),
      controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    files.read.mockReturnValue(pending.promise);
    const result = outcome(grid.import(file(), { signal: controller.signal }));
    controller.abort('user');
    expect(await result).toMatchObject({ code: 'IMPORT_CANCELLED', cause: 'user' });
    expect(remove).toHaveBeenCalledOnce();
    pending.reject(new Error('late parse failure'));
    await Promise.resolve();
    expect(grid.getValue('A1')).toBe('original');
  });
  it('does not supersede a valid import with invalid options or an already cancelled signal', async () => {
    const grid = make(),
      pending = deferred(),
      controller = new AbortController();
    files.read.mockReturnValue(pending.promise);
    const result = grid.import(file());
    controller.abort();
    await expect(grid.import(file(), { signal: controller.signal })).rejects.toMatchObject({
      code: 'IMPORT_CANCELLED',
    });
    await expect(grid.import(file(), null as never)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(files.read).toHaveBeenCalledOnce();
    pending.resolve(imported('valid'));
    await result;
    expect(grid.getValue('A1')).toBe('valid');
  });
  it('settles on destruction without waiting for file parsing', async () => {
    const grid = make(),
      pending = deferred();
    files.read.mockReturnValue(pending.promise);
    const result = outcome(grid.import(file()));
    grid.destroy();
    expect(await result).toMatchObject({ code: 'IMPORT_CANCELLED' });
    pending.resolve(imported('late'));
    await Promise.resolve();
    await expect(grid.import(file())).rejects.toMatchObject({ code: 'DESTROYED' });
  });
  it('keeps original data on parser or loaded-workbook validation failure and clears ownership', async () => {
    const grid = make();
    files.read
      .mockRejectedValueOnce(new Error('bad file'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(imported('ok'));
    await expect(grid.import(file())).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(grid.getValue('A1')).toBe('original');
    await expect(grid.import(file())).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(grid.getValue('A1')).toBe('original');
    await grid.import(file());
    expect(grid.getValue('A1')).toBe('ok');
  });
});

it.each(['load', 'bind', 'destroy', 'abort', 'import'] as const)(
  'does not report import success when source cancellation triggers %s before commit',
  async (action) => {
    const grid = make();
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let replacement: Promise<void> | undefined;
    const lateImport = deferred();
    const old = outcome(
      grid.bindData({
        columnCount: 1,
        rowCount: 1,
        fetchPage: async (_offset, _limit, signal) => {
          signal?.addEventListener(
            'abort',
            () => {
              if (action === 'load') grid.load(imported('replacement'));
              else if (action === 'destroy') grid.destroy();
              else if (action === 'abort') controller.abort('cancel during commit');
              else if (action === 'import') replacement = grid.import(file());
              else
                replacement = grid.bindData({
                  columnCount: 1,
                  rowCount: 1,
                  fetchPage: async () => ({ rows: [[99]] }),
                });
            },
            { once: true },
          );
          started();
          return new Promise(() => {});
        },
      }),
    );
    await ready;
    files.read
      .mockResolvedValueOnce(imported('superseded'))
      .mockReturnValueOnce(lateImport.promise);
    await expect(grid.import(file(), { signal: controller.signal })).rejects.toMatchObject({
      code: 'IMPORT_CANCELLED',
    });
    expect(await old).toMatchObject({ name: 'AbortError' });
    if (action === 'import') {
      expect(grid.toJSON().sheets[0].cells.A1?.value).not.toBe('superseded');
      lateImport.resolve(imported('latest'));
    }
    if (replacement) await replacement;
    if (action === 'load') expect(grid.getValue('A1')).toBe('replacement');
    if (action === 'bind') expect(grid.getValue('A1')).toBe(99);
    if (action === 'import') expect(grid.getValue('A1')).toBe('latest');
    if (action === 'abort') expect(grid.toJSON().sheets[0].cells.A1?.value).not.toBe('superseded');
  },
);

it('reports success once committed even if a render subscriber immediately loads another book', async () => {
  const grid = make();
  let observed = false;
  grid.subscribe(() => {
    if (observed) return;
    observed = true;
    expect(grid.getValue('A1')).toBe('incoming');
    grid.load(imported('after commit'));
  });
  files.read.mockResolvedValue(imported('incoming'));
  await grid.import(file());
  expect(observed).toBe(true);
  expect(grid.getValue('A1')).toBe('after commit');
});

it('preserves real XLSX errors through SDK import and keeps current edits on unsupported error input', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
  const { readXlsxArchive, writeXlsxArchive, xmlChild, xmlChildren } =
    await import('../src/lib/xlsx-archive');
  files.read.mockImplementation(actual.importFile);
  const external = new ExcelJS.Workbook(),
    sheet = external.addWorksheet('Errors');
  sheet.getCell('A1').value = { error: '#N/A' };
  sheet.getCell('B1').value = { formula: 'IFERROR(A1,42)' };
  const bytes = (await external.xlsx.writeBuffer()) as ArrayBuffer;
  const grid = make();
  await grid.import(new File([bytes], 'errors.xlsx'));
  expect(grid.getCell('A1')?.value).toBe('=#N/A');
  expect(grid.getValue('B1')).toBe(42);
  grid.setCell('C1', 'keep edit');
  const before = grid.toJSON();
  const archive = await readXlsxArchive(bytes);
  const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
  const cell = xmlChildren(row, 'c').find((node) => node.attributes.r === 'A1')!;
  xmlChild(cell, 'v')!.children = ['#SPILL!'];
  await expect(
    grid.import(new File([await writeXlsxArchive(archive)], 'unsupported.xlsx')),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  expect(grid.toJSON()).toEqual(before);
  grid.undo();
  expect(grid.getValue('C1')).toBe('');
  grid.redo();
  expect(grid.getValue('C1')).toBe('keep edit');
});

it.each([
  [12, '12oops'],
  ['shared text', '0x0'],
  ['shared text', ''],
])(
  'rejects damaged XLSX value %j/%j without changing edits or undo history',
  async (original, text) => {
    const ExcelJS = (await import('exceljs')).default;
    const actual = await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
    const { readXlsxArchive, writeXlsxArchive, xmlChild, xmlChildren } =
      await import('../src/lib/xlsx-archive');
    files.read.mockImplementation(actual.importFile);
    const external = new ExcelJS.Workbook();
    external.addWorksheet('Values').getCell('A1').value = original;
    const archive = await readXlsxArchive((await external.xlsx.writeBuffer()) as ArrayBuffer);
    const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
    xmlChild(xmlChildren(row, 'c')[0], 'v')!.children = [String(text)];
    const grid = make();
    grid.setCell('B1', 'keep edit');
    const before = grid.toJSON();
    await expect(
      grid.import(new File([await writeXlsxArchive(archive)], 'broken.xlsx')),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(grid.toJSON()).toEqual(before);
    grid.undo();
    expect(grid.getValue('B1')).toBe('');
    grid.redo();
    expect(grid.getValue('B1')).toBe('keep edit');
  },
);
