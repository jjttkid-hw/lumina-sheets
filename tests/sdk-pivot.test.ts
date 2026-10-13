import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  return grid;
}
beforeEach(() => vi.stubGlobal('HTMLElement', Host));
afterEach(() => {
  instances.splice(0).forEach((grid) => grid.destroy());
  vi.unstubAllGlobals();
});
describe('SDK pivot snapshot', () => {
  it('installs an editable report and isolates the input', () => {
    const grid = make();
    const records = [
      { region: '华东', amount: 10 },
      { region: '华东', amount: 30 },
    ];
    grid.pivot({ rows: ['region'], values: [{ field: 'amount', aggregate: 'average' }] }, records);
    expect(grid.getValue('B2')).toBe(20);
    records[0].amount = 99;
    expect(grid.getValue('B2')).toBe(20);
    grid.setCell('B2', 40);
    grid.undo();
    expect(grid.getValue('B2')).toBe(20);
  });
  it('preserves workbook and history when planning rejects and guards destroyed instances', () => {
    const grid = make();
    grid.setCell('A1', 'saved');
    grid.undo();
    const before = grid.toJSON();
    expect(() =>
      grid.pivot({ rows: ['r'], values: [{ field: 'a' }] }, [{ a: 'invalid' }]),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(grid.toJSON()).toEqual(before);
    grid.redo();
    expect(grid.getValue('A1')).toBe('saved');
    grid.destroy();
    expect(() => grid.pivot({ rows: ['r'], values: [{ field: 'a' }] }, [])).toThrowError(
      expect.objectContaining({ code: 'DESTROYED' }),
    );
  });
  it('installs async analysis only after completion and supports cancellation', async () => {
    const grid = make();
    const progress: number[] = [];
    await grid.pivotAsync(
      { rows: ['region'], values: [{ field: 'amount', aggregate: 'sum' }] },
      [
        { region: '华东', amount: 10 },
        { region: '华东', amount: 30 },
      ],
      { batchSize: 1, onProgress: ({ completed }) => progress.push(completed) },
    );
    expect(grid.getValue('B2')).toBe(40);
    expect(progress).toEqual([0, 1, 2]);
    const before = grid.toJSON();
    const controller = new AbortController();
    const pending = grid.pivotAsync(
      { rows: ['region'], values: [{ field: 'amount' }] },
      Array.from({ length: 2_000 }, (_, i) => ({ region: 'r', amount: i })),
      { batchSize: 1, signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'PIVOT_CANCELLED' });
    expect(grid.toJSON()).toEqual(before);
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort('before start');
    await expect(
      grid.pivotAsync(
        { rows: ['region'], values: [{ field: 'amount' }] },
        [{ region: '华东', amount: 1 }],
        { signal: alreadyCancelled.signal },
      ),
    ).rejects.toMatchObject({ code: 'PIVOT_CANCELLED' });
  });
});
