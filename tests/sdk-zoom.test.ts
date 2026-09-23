import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));
import { LuminaSpreadsheet } from '../src/sdk';

class Host {
  className = 'zoom-host';
  classList = { add: (name: string) => (this.className += ` ${name}`) };
}
const instances: LuminaSpreadsheet[] = [];
function make(options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) {
  const grid = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, options);
  instances.push(grid);
  return grid;
}
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Host);
  vi.clearAllMocks();
});
afterEach(() => {
  instances.splice(0).forEach((grid) => grid.destroy());
  vi.unstubAllGlobals();
});

describe('SDK runtime zoom', () => {
  it('preserves constructor scale conventions and isolates host options', () => {
    expect(make().zoom).toBe(100);
    for (const zoom of [0.5, 1.25, 2, 50, 125, 200, 300]) {
      const options = { zoom };
      const grid = make(options);
      options.zoom = 75;
      expect(grid.zoom).toBe(zoom);
      expect(grid.surface().props.zoom).toBe(zoom);
    }
  });

  it('notifies once without resetting selection, filter, draft revision, calculation or redo', () => {
    const onChange = vi.fn();
    const grid = make({ onChange });
    grid.setCells([
      { key: 'A1', cell: { value: 10 } },
      { key: 'B1', cell: { value: '=A1*2' } },
    ]);
    grid.setCell('A1', 20);
    grid.undo();
    grid.select({ row: 0, col: 1 });
    grid.setFilter('10');
    expect(grid.getValue('B1')).toBe(20);
    const stats = grid.calculationStats;
    const previous = grid.surface().props;
    const book = grid.toJSON();
    const listener = vi.fn();
    grid.subscribe(listener);
    onChange.mockClear();
    grid.setZoom(150);
    const current = grid.surface().props;
    expect(grid.zoom).toBe(150);
    expect(current.zoom).toBe(150);
    expect(current.renderVersion).toBe(previous.renderVersion);
    expect(current.calculationVersion).toBe(previous.calculationVersion);
    expect(current.getValue).toBe(previous.getValue);
    expect(current.sheet.cells).toBe(previous.sheet.cells);
    expect(current.filter).toBe(previous.filter);
    expect(grid.selectedRange).toEqual({ row: 0, col: 1 });
    expect(grid.toJSON()).toEqual(book);
    expect(grid.calculationStats).toEqual(stats);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    grid.setZoom(150);
    expect(listener).toHaveBeenCalledTimes(1);
    grid.redo();
    expect(grid.getValue('A1')).toBe(20);
    expect(grid.zoom).toBe(150);
  });

  it.each([0, -1, NaN, Infinity, -Infinity, '125', null, {}, []])(
    'rejects invalid constructor and runtime scale without mutation: %j',
    (value) => {
      const host = new Host();
      expect(
        () => new LuminaSpreadsheet(host as unknown as HTMLElement, { zoom: value as number }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
      expect(host.className).toBe('zoom-host');
      expect(mounting.render).not.toHaveBeenCalled();
      const grid = make({ zoom: 125 });
      const revision = grid.snapshot();
      expect(() => grid.setZoom(value as number)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
      expect(grid.zoom).toBe(125);
      expect(grid.snapshot()).toBe(revision);
    },
  );

  it('allows read-only and bound data views and retains zoom when loading another workbook', async () => {
    const grid = make({ readOnly: true });
    grid.setZoom(75);
    const fetchPage = vi.fn(async () => ({ rows: [[42]], totalRows: 1 }));
    await grid.bindData({ columnCount: 1, rowCount: 1, fetchPage });
    const count = fetchPage.mock.calls.length;
    grid.setZoom(125);
    expect(grid.getValue('A1')).toBe(42);
    expect(fetchPage).toHaveBeenCalledTimes(count);
    grid.load(createBlankWorkbook());
    expect(grid.zoom).toBe(125);
  });

  it('does not read cells on the zoom hot path', () => {
    const grid = make();
    const sheet = grid.surface().props.sheet;
    const cells = sheet.cells;
    sheet.cells = new Proxy(cells, {
      ownKeys() {
        throw new Error('cell enumeration');
      },
      get() {
        throw new Error('cell read');
      },
    });
    try {
      grid.setZoom(150);
      expect(grid.zoom).toBe(150);
    } finally {
      sheet.cells = cells;
    }
  });

  it('rejects access after destroy and allows reentrant destruction from a subscriber', () => {
    const grid = make();
    grid.subscribe(() => grid.destroy());
    expect(() => grid.setZoom(150)).not.toThrow();
    expect(() => grid.zoom).toThrowError(expect.objectContaining({ code: 'DESTROYED' }));
    expect(() => grid.setZoom(100)).toThrowError(expect.objectContaining({ code: 'DESTROYED' }));
  });
});
