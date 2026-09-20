import { afterEach, describe, expect, it, vi } from 'vitest';
import { LuminaError, LuminaSpreadsheet } from '../src/sdk';
import { createBlankWorkbook } from '../src/lib/seed';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));

class Host {
  className = '';
  classList = { add: (name: string) => (this.className += ` ${name}`) };
}
const instances: LuminaSpreadsheet[] = [];
function make(options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) {
  vi.stubGlobal('HTMLElement', Host);
  const instance = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, options);
  instances.push(instance);
  return instance;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function downloads() {
  const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { append: vi.fn() } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:quality');
  return link;
}
afterEach(() => {
  for (const item of instances) item.destroy();
  instances.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('commercial SDK boundaries', () => {
  it('exposes stable read-only and destroyed error codes', () => {
    vi.stubGlobal('HTMLElement', Host);
    const readOnly = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, {
      readOnly: true,
    });
    instances.push(readOnly);
    expect(() => readOnly.setCell('A1', 1)).toThrowError(LuminaError);
    try {
      readOnly.setCell('A1', 1);
    } catch (error) {
      expect(error).toMatchObject({ code: 'READ_ONLY' });
    }
    readOnly.destroy();
    try {
      readOnly.getValue('A1');
    } catch (error) {
      expect(error).toMatchObject({ code: 'DESTROYED' });
    }
  });

  it('reports paged loading, ready and failure states without cloning cells', async () => {
    vi.stubGlobal('HTMLElement', Host);
    const states: string[] = [];
    const instance = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, {
      onDataStateChange: (state) => states.push(state.status),
    });
    instances.push(instance);
    const fetchPage = vi.fn(async () => ({ rows: [[7]], totalRows: 1 }));
    await instance.bindData({ columnCount: 1, rowCount: 1, fetchPage });
    expect(states).toContain('loading');
    expect(states).toContain('ready');
    expect(instance.activeSheet.cells).toEqual({});
    expect(instance.dataSourceState.cachedPages).toBe(1);
    expect(instance.dataSourceState.rowCount).toBe(1);
  });

  it('cancels paged export through caller signal and preserves source lifecycle', async () => {
    vi.stubGlobal('HTMLElement', Host);
    const instance = new LuminaSpreadsheet(new Host() as unknown as HTMLElement);
    instances.push(instance);
    const gate = new Promise<never>(() => {});
    let calls = 0;
    await instance.bindData({
      columnCount: 1,
      rowCount: 1,
      fetchPage: () => (++calls === 1 ? Promise.resolve({ rows: [[1]], totalRows: 1 }) : gate),
    });
    const controller = new AbortController();
    const pending = instance.export('csv', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
    expect(instance.dataSourceState.status).toBe('ready');
  });

  it('classifies invalid input atomically and retains an external validation cause', () => {
    const instance = make();
    expect(() => instance.setCell('INVALID', 1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() =>
      instance.bindData({ columnCount: 0, fetchPage: async () => ({ rows: [] }) }),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: expect.any(RangeError) }),
    );
    expect(() => instance.setConditionalRules([{ range: null } as never])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(instance.dataSourceState.status).toBe('idle');
  });

  it('returns a single isolated raw cell including formula and style', () => {
    const instance = make();
    instance.setCell('A1', '=1+2', { bold: true, color: '#112233' });
    const cell = instance.getCell('$a$1')!;
    expect(cell.value).toBe('=1+2');
    expect(instance.getValue('A1')).toBe(3);
    cell.value = 100;
    cell.style!.bold = false;
    expect(instance.getCell('A1')).toEqual({
      value: '=1+2',
      style: { bold: true, color: '#112233' },
    });
    expect(instance.getCell('B1')).toBeUndefined();
  });

  it('retries a failed initial binding and reloads cleared cache with cause intact', async () => {
    const instance = make();
    const offline = new Error('offline');
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(offline)
      .mockResolvedValue({ rows: [[8]], totalRows: 1 });
    await expect(
      instance.bindData({ columnCount: 1, rowCount: 1, fetchPage }),
    ).rejects.toMatchObject({ code: 'DATA_SOURCE', cause: offline });
    expect(instance.dataSourceState.error).toMatchObject({ code: 'DATA_SOURCE', cause: offline });
    instance.retryData();
    await tick();
    expect(instance.getValue('A1')).toBe(8);
    expect(instance.dataSourceState.status).toBe('ready');
    instance.clearDataCache();
    await tick();
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(instance.dataSourceState.cachedPages).toBe(1);
  });

  it('publishes ready for an empty source and exposes only constant-size sheet metadata', async () => {
    const states: string[] = [];
    const instance = make({ onDataStateChange: (state) => states.push(state.status) });
    const fetchPage = vi.fn();
    await instance.bindData({ columnCount: 2, rowCount: 0, fetchPage });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(states).toEqual(['ready']);
    expect(instance.activeSheetInfo).toMatchObject({ rowCount: 1, colCount: 2, readOnly: true });
    expect(instance.activeSheetInfo).not.toHaveProperty('cells');
    const info = instance.activeSheetInfo;
    info.name = 'host mutation';
    expect(instance.activeSheetInfo.name).not.toBe('host mutation');
  });

  it('allows data-state callbacks to replace the workbook after a coherent transition', async () => {
    const next = createBlankWorkbook('replacement');
    let instance!: LuminaSpreadsheet;
    let replaced = false;
    instance = make({
      onDataStateChange: (state) => {
        if (state.status === 'loading' && !replaced) {
          replaced = true;
          expect(instance.activeSheetInfo.colCount).toBe(2);
          instance.load(next);
        }
      },
    });
    const binding = instance.bindData({ columnCount: 2, fetchPage: () => new Promise(() => {}) });
    await expect(binding).rejects.toHaveProperty('name', 'AbortError');
    expect(instance.toJSON().name).toBe('replacement');
    expect(instance.dataSourceState.status).toBe('idle');
  });

  it.each(['load', 'destroy'] as const)(
    'prevents paged export download after %s',
    async (action) => {
      const instance = make();
      const link = downloads();
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ rows: [[1]], totalRows: 1 })
        .mockImplementation(() => new Promise(() => {}));
      await instance.bindData({ columnCount: 1, rowCount: 1, fetchPage });
      const pending = instance.export('csv');
      if (action === 'load') instance.load(createBlankWorkbook());
      else instance.destroy();
      await expect(pending).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
      expect(link.click).not.toHaveBeenCalled();
    },
  );

  it.each(['csv', 'json', 'xlsx'] as const)(
    'cancels static %s before download and reports progress',
    async (format) => {
      const instance = make();
      instance.setCell('A1', 1);
      const link = downloads();
      const controller = new AbortController();
      const progress = vi.fn(() => controller.abort());
      await expect(
        instance.export(format, { signal: controller.signal, onProgress: progress }),
      ).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
      expect(progress).toHaveBeenCalled();
      expect(link.click).not.toHaveBeenCalled();
    },
  );

  it.each(['csv', 'json', 'xlsx'] as const)(
    'downloads static %s when signal is not supplied',
    async (format) => {
      const instance = make();
      instance.setCell('A1', 1);
      const link = downloads();
      await instance.export(format);
      expect(link.click).toHaveBeenCalledTimes(1);
      expect(link.remove).toHaveBeenCalledTimes(1);
    },
  );

  it('forwards cancellation and page progress to static PDF without downloading a partial file', async () => {
    const instance = make();
    instance.setCell('A1', '中文报表');
    const link = downloads();
    const context = {
      scale: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 5 }),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob) => void) =>
        callback(new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' })),
    };
    vi.stubGlobal('document', {
      createElement: (tag: string) => (tag === 'canvas' ? canvas : link),
      body: { append: vi.fn() },
    });
    const controller = new AbortController();
    const progress = vi.fn(() => controller.abort());
    await expect(
      instance.export('pdf', { signal: controller.signal, onProgress: progress }),
    ).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
    expect(progress).toHaveBeenCalledWith(1, 1);
    expect(link.click).not.toHaveBeenCalled();
  });

  it.each(['load', 'destroy'] as const)(
    'prevents static export download after %s',
    async (action) => {
      const instance = make();
      instance.setCell('A1', 1);
      const link = downloads();
      const pending = instance.export('json');
      if (action === 'load') instance.load(createBlankWorkbook());
      else instance.destroy();
      await expect(pending).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
      expect(link.click).not.toHaveBeenCalled();
    },
  );

  it('exports a consistent static snapshot while edits occur between CSV rows', async () => {
    const instance = make();
    instance.setCell('A1', 'first');
    instance.setCell('A2', 'original');
    const link = downloads();
    const createUrl = vi.mocked(URL.createObjectURL);
    let edited = false;
    await instance.export('csv', {
      onProgress: () => {
        if (!edited) {
          edited = true;
          instance.setCell('A2', 'changed');
        }
      },
    });
    const first = createUrl.mock.calls[0][0] as Blob;
    expect(await first.text()).toBe('first\r\noriginal\r\n');
    expect(instance.getValue('A2')).toBe('changed');
    await instance.export('csv');
    const second = createUrl.mock.calls[1][0] as Blob;
    expect(await second.text()).toBe('first\r\nchanged\r\n');
    expect(link.click).toHaveBeenCalledTimes(2);
  });
});
