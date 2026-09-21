import { describe, expect, it, vi, afterEach } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import { exportWorkbook, parseCsv, workbookToXlsx } from '../src/lib/io';
import { iterateCsvChunks, workbookCsvBlob, workbookCsvReadableStream } from '../src/lib/io-stream';
import { reportDataCsvBlob } from '../src/lib/report-data-export';
import { arrayDataSource } from '../src/lib/report-data';

function pagedBook() {
  const book = createBlankWorkbook();
  book.sheets[0].dataSource = { kind: 'paged', totalRows: 1000 };
  book.sheets[0].cells = { A1: { value: 'cached only' } };
  return book;
}

afterEach(() => vi.unstubAllGlobals());

describe('public exports reject incomplete paged snapshots', () => {
  it.each([false, true])('rejects XLSX when the paged sheet is inactive=%s', async (inactive) => {
    const book = pagedBook();
    if (inactive) {
      const sheet = createBlankWorkbook().sheets[0];
      sheet.name = 'Static';
      book.sheets.push(sheet);
      book.activeSheetId = sheet.id;
    }
    await expect(workbookToXlsx(book)).rejects.toThrow(/分页|分片/);
    expect(book.sheets[0].dataSource?.kind).toBe('paged');
    expect(book.sheets[0].cells.A1.value).toBe('cached only');
  });

  it('rejects CSV iteration before scanning or evaluating the partial cells', async () => {
    const book = pagedBook();
    book.sheets[0].cells = new Proxy(
      {},
      {
        ownKeys() {
          throw Error('scanned');
        },
      },
    );
    await expect(iterateCsvChunks(book.sheets[0], book).next()).rejects.toThrow(/分页|分片/);
  });

  it('rejects both CSV blob and stream consumption', async () => {
    const book = pagedBook();
    await expect(workbookCsvBlob(book)).rejects.toThrow(/分页|分片/);
    const reader = workbookCsvReadableStream(book).getReader();
    await expect(reader.read()).rejects.toThrow(/分页|分片/);
    reader.releaseLock();
  });

  it('does not download a JSON snapshot as a complete paged workbook', async () => {
    const book = pagedBook();
    const create = vi.fn(() => {
      throw Error('download attempted');
    });
    vi.stubGlobal('document', { createElement: create });
    await expect(exportWorkbook(book, 'json')).rejects.toThrow(/分页|分片/);
    expect(create).not.toHaveBeenCalled();
  });

  it('allows the active static sheet CSV even when another sheet is paged', async () => {
    const book = pagedBook();
    const sheet = createBlankWorkbook().sheets[0];
    sheet.name = 'Static';
    sheet.cells = { A1: { value: 'complete static content' }, B1: { value: 0 } };
    book.sheets.push(sheet);
    book.activeSheetId = sheet.id;
    expect(parseCsv(await (await workbookCsvBlob(book)).text())).toEqual([
      ['complete static content', '0'],
    ]);
  });

  it('retains the full-source paged CSV route', async () => {
    const source = arrayDataSource([[1], [2], [3]]);
    expect(parseCsv(await (await reportDataCsvBlob(source, { pageSize: 1 })).text())).toEqual([
      ['1'],
      ['2'],
      ['3'],
    ]);
  });
});
