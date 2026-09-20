import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import type { PrintSettings, Workbook } from '../src/lib/types';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));
import { LuminaSpreadsheet } from '../src/sdk';

class TestElement {
  className = 'print-host';
  classList = {
    add: (name: string) => {
      this.className += ` ${name}`;
    },
  };
}
let instances: LuminaSpreadsheet[] = [];
function make(options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) {
  const instance = new LuminaSpreadsheet(new TestElement() as unknown as HTMLElement, options);
  instances.push(instance);
  return instance;
}
const settings = (): PrintSettings => ({
  paperSize: 'A3',
  orientation: 'portrait',
  margins: { top: 21, right: 22, bottom: 23, left: 24 },
  repeatRows: 1,
  repeatColumns: 1,
  rowBreaks: [20, 40],
  columnBreaks: [5],
});

beforeEach(() => {
  vi.stubGlobal('HTMLElement', TestElement);
  vi.clearAllMocks();
});
afterEach(() => {
  instances.forEach((instance) => instance.destroy());
  instances = [];
  vi.unstubAllGlobals();
});

describe('SDK persistent print metadata', () => {
  it('isolates settings passed to and returned from SDK methods', () => {
    const instance = make();
    const input = settings();
    const expected = structuredClone(input);
    instance.setPrintSettings(input);
    input.margins!.left = 500;
    input.rowBreaks!.push(60);
    input.paperSize = 'Letter';
    const output = instance.getPrintSettings()!;
    expect(output).toEqual(expected);
    output.margins!.right = 999;
    output.columnBreaks!.push(7);
    instance.activeSheet.printSettings!.repeatRows = 8;
    instance.toJSON().sheets[0].printSettings!.orientation = 'landscape';
    expect(instance.getPrintSettings()).toEqual(expected);
  });

  it('persists through JSON/load and isolates constructor/load snapshots', () => {
    const workbook = createBlankWorkbook();
    workbook.sheets[0].printSettings = settings();
    const expected = settings();
    const first = make({ workbook });
    workbook.sheets[0].printSettings!.rowBreaks!.push(70);
    expect(first.getPrintSettings()).toEqual(expected);
    const snapshot = JSON.parse(JSON.stringify(first.toJSON())) as Workbook;
    const second = make();
    second.setCell('A1', 'previous workbook');
    second.load(snapshot);
    snapshot.sheets[0].printSettings!.margins!.top = 999;
    expect(second.getPrintSettings()).toEqual(expected);
    second.undo();
    expect(second.getPrintSettings()).toEqual(expected);
    expect(second.getValue('A1')).toBe('');
  });

  it('maintains a complete undo/redo chain across metadata, cell edits, and clearing', () => {
    const instance = make();
    const first = settings();
    const second: PrintSettings = { paperSize: 'Letter', orientation: 'landscape', repeatRows: 0 };
    instance.setCell('A1', 10);
    instance.setPrintSettings(first);
    instance.setCell('A1', 20);
    instance.setPrintSettings(second);
    instance.setCell('B1', '=A1*2');
    instance.setPrintSettings();
    expect(instance.getPrintSettings()).toBeUndefined();
    instance.undo();
    expect(instance.getPrintSettings()).toEqual(second);
    instance.undo();
    expect(instance.getValue('B1')).toBe('');
    expect(instance.getPrintSettings()).toEqual(second);
    instance.undo();
    expect(instance.getPrintSettings()).toEqual(first);
    instance.undo();
    expect(instance.getValue('A1')).toBe(10);
    expect(instance.getPrintSettings()).toEqual(first);
    instance.undo();
    expect(instance.getPrintSettings()).toBeUndefined();
    instance.undo();
    expect(instance.getValue('A1')).toBe('');
    instance.redo();
    expect(instance.getValue('A1')).toBe(10);
    instance.redo();
    expect(instance.getPrintSettings()).toEqual(first);
    instance.redo();
    expect(instance.getValue('A1')).toBe(20);
    instance.redo();
    expect(instance.getPrintSettings()).toEqual(second);
    instance.redo();
    expect(instance.getValue('B1')).toBe(40);
    instance.redo();
    expect(instance.getPrintSettings()).toBeUndefined();
    expect(instance.getValue('B1')).toBe(40);
  });

  it('does not mutate settings, events, or redo history when invalid settings are rejected', () => {
    const onChange = vi.fn();
    const instance = make({ onChange });
    instance.setPrintSettings(settings());
    instance.setCell('A1', 'redo me');
    instance.undo();
    onChange.mockClear();
    for (const invalid of [
      { repeatRows: instance.activeSheet.rowCount + 1 },
      { rowBreaks: [instance.activeSheet.rowCount] },
      { columnBreaks: [5, 5] },
      { margins: { top: 10, right: 20, bottom: -1, left: 20 } },
      { paperSize: 'Legal' },
    ]) {
      expect(() => instance.setPrintSettings(invalid as PrintSettings)).toThrow();
    }
    expect(instance.getPrintSettings()).toEqual(settings());
    expect(onChange).not.toHaveBeenCalled();
    instance.redo();
    expect(instance.getValue('A1')).toBe('redo me');
    instance.undo();
    instance.undo();
    expect(instance.getPrintSettings()).toBeUndefined();
  });

  it('atomically rejects invalid print settings during load without clearing history', () => {
    const instance = make();
    instance.setCell('A1', 'keep');
    instance.setPrintSettings(settings());
    const invalid = instance.toJSON();
    invalid.sheets[0].printSettings = { repeatColumns: invalid.sheets[0].colCount + 1 };
    expect(() => instance.load(invalid)).toThrow();
    expect(instance.getValue('A1')).toBe('keep');
    expect(instance.getPrintSettings()).toEqual(settings());
    instance.undo();
    expect(instance.getPrintSettings()).toBeUndefined();
    instance.undo();
    expect(instance.getValue('A1')).toBe('');
  });

  it('prevents read-only hosts from setting or clearing print metadata', () => {
    const workbook = createBlankWorkbook();
    workbook.sheets[0].printSettings = settings();
    const instance = make({ workbook, readOnly: true });
    expect(() => instance.setPrintSettings({ paperSize: 'Letter' })).toThrow('只读');
    expect(() => instance.setPrintSettings()).toThrow('只读');
    expect(instance.getPrintSettings()).toEqual(settings());
  });

  it('clears static print settings when binding paged data and rejects mutation while bound', async () => {
    const instance = make();
    instance.setPrintSettings(settings());
    instance.setCell('A1', 'static');
    await instance.bindData(
      {
        rowCount: 3,
        columnCount: 1,
        fetchPage: async () => ({ rows: [[1], [2], [3]], totalRows: 3 }),
      },
      { pageSize: 3, maxPages: 1 },
    );
    expect(instance.getPrintSettings()).toBeUndefined();
    expect(instance.toJSON().sheets[0].printSettings).toBeUndefined();
    expect(instance.getValue('A1')).toBe(1);
    expect(() => instance.setPrintSettings({ paperSize: 'A4' })).toThrow('只读');
    expect(() => instance.undo()).toThrow('只读');
    expect(instance.getPrintSettings()).toBeUndefined();
  });
});
