import { describe, expect, it, vi } from 'vitest';
import { csvToWorkbook } from '../src/lib/io';
import { workbookCsvReadableStream } from '../src/lib/io-stream';
import { arrayDataSource } from '../src/lib/report-data';
import { reportDataCsvReadableStream } from '../src/lib/report-data-export';

const exporters = {
  workbook: (signal: AbortSignal, progress: () => void) =>
    workbookCsvReadableStream(csvToWorkbook('1\n2'), {
      signal,
      chunkRows: 1,
      onProgress: progress,
    }),
  source: (signal: AbortSignal, progress: () => void) =>
    reportDataCsvReadableStream(arrayDataSource([[1], [2]]), {
      signal,
      pageSize: 1,
      onProgress: progress,
    }),
};

describe.each(Object.entries(exporters))('%s CSV stream external cancellation', (_name, create) => {
  it.each(['before-read', 'between-reads'])(
    'settles reader.closed without another read: %s',
    async (phase) => {
      const abort = new AbortController();
      const remove = vi.spyOn(abort.signal, 'removeEventListener');
      const progress = vi.fn();
      const reader = create(abort.signal, progress).getReader();
      if (phase === 'between-reads') expect((await reader.read()).done).toBe(false);
      const calls = progress.mock.calls.length;
      let settled = false;
      const closed = reader.closed.catch((error) => {
        settled = true;
        return error;
      });
      abort.abort();
      await Promise.resolve();
      expect(settled).toBe(true);
      expect(await closed).toMatchObject({ name: 'AbortError' });
      await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
      expect(remove).toHaveBeenCalledOnce();
      expect(progress).toHaveBeenCalledTimes(calls);
    },
  );

  it('can abort reentrantly from progress without enqueueing into an errored stream', async () => {
    const abort = new AbortController();
    const progress = vi.fn(() => abort.abort());
    const reader = create(abort.signal, progress).getReader();
    const closed = reader.closed.catch((error) => error);
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    expect(await closed).toMatchObject({ name: 'AbortError' });
    expect(progress).toHaveBeenCalledOnce();
  });

  it('rejects an already-aborted signal immediately without doing export work', async () => {
    const abort = new AbortController();
    abort.abort();
    const progress = vi.fn();
    const reader = create(abort.signal, progress).getReader();
    let settled = false;
    const closed = reader.closed.catch((error) => {
      settled = true;
      return error;
    });
    await Promise.resolve();
    expect(settled).toBe(true);
    expect(await closed).toMatchObject({ name: 'AbortError' });
    expect(progress).not.toHaveBeenCalled();
  });
});

it('ignores late source completion after a pending stream read was externally aborted', async () => {
  const abort = new AbortController();
  let finish!: (value: { rows: number[][] }) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const progress = vi.fn();
  const source = {
    columnCount: 1,
    rowCount: 1,
    fetchPage: vi.fn(() => {
      started();
      return new Promise<{ rows: number[][] }>((resolve) => {
        finish = resolve;
      });
    }),
  };
  const reader = reportDataCsvReadableStream(source, {
    signal: abort.signal,
    onProgress: progress,
  }).getReader();
  const closed = reader.closed.catch((error) => error);
  const pending = reader.read();
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await ready;
  abort.abort();
  await rejected;
  expect(await closed).toMatchObject({ name: 'AbortError' });
  finish({ rows: [[42]] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(progress).not.toHaveBeenCalled();
  expect(source.fetchPage).toHaveBeenCalledOnce();
});
