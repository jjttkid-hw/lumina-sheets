import Excel from 'exceljs';
import { afterEach, expect, it, vi } from 'vitest';
import { importFile } from '../src/lib/io';
import * as archiveIO from '../src/lib/xlsx-archive';

afterEach(() => vi.restoreAllMocks());
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it.each(['archive', 'rewrite', 'decode'] as const)(
  'cancels an XLSX %s wait without continuing to the next stage',
  async (stage) => {
    const book = new Excel.Workbook();
    book.addWorksheet('Data').getCell('A1').value = 'kept';
    const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
    const archive = await archiveIO.readXlsxArchive(bytes);
    const gate = deferred<any>(),
      started = deferred<void>();
    const delayed = () => {
      started.resolve();
      return gate.promise;
    };
    const load = vi.spyOn(Object.getPrototypeOf(new Excel.Workbook().xlsx), 'load');
    const paths = vi.spyOn(archiveIO, 'assertExcelJsCompatiblePaths');
    if (stage === 'archive') vi.spyOn(archiveIO, 'readXlsxArchive').mockImplementation(delayed);
    else if (stage === 'rewrite')
      vi.spyOn(archiveIO, 'writeXlsxArchive').mockImplementation(delayed);
    else load.mockImplementation(delayed);
    const controller = new AbortController();
    const pending = importFile(new File([bytes], 'data.xlsx'), controller.signal).catch(
      (error) => error,
    );
    await started.promise;
    controller.abort();
    for (let i = 0; i < 15; i++) await Promise.resolve();
    const result = await Promise.race([pending, Promise.resolve('still waiting')]);
    // Release the real operation even if the expectation fails, avoiding leaked work.
    if (stage === 'archive') gate.resolve(archive);
    else if (stage === 'rewrite') gate.resolve(bytes);
    else gate.resolve(book);
    await pending;
    expect(result).toMatchObject({ name: 'AbortError' });
    if (stage === 'archive') expect(paths).not.toHaveBeenCalled();
    if (stage !== 'decode') expect(load).not.toHaveBeenCalled();
  },
);

it('consumes a late archive failure after cancellation and allows a fresh import', async () => {
  const book = new Excel.Workbook();
  book.addWorksheet('Data').getCell('A1').value = 'retry';
  const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
  const gate = deferred<archiveIO.XlsxArchive>(),
    started = deferred<void>();
  vi.spyOn(archiveIO, 'readXlsxArchive').mockImplementationOnce(() => {
    started.resolve();
    return gate.promise;
  });
  const controller = new AbortController();
  const file = new File([bytes], 'retry.xlsx');
  const pending = importFile(file, controller.signal).catch((error) => error);
  await started.promise;
  controller.abort();
  for (let i = 0; i < 15; i++) await Promise.resolve();
  const result = await Promise.race([pending, Promise.resolve('still waiting')]);
  gate.reject(Error('late archive error'));
  await pending;
  expect(result).toMatchObject({ name: 'AbortError' });
  expect((await importFile(file)).sheets[0].cells.A1.value).toBe('retry');
});
