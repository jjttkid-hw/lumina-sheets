import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import type { Workbook } from '../src/lib/types';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));
import { LuminaSpreadsheet } from '../src/sdk';

class Host {
  className = 'structure-host';
  classList = { add: (name: string) => (this.className += ` ${name}`) };
}
const instances: LuminaSpreadsheet[] = [];
const make = (options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) => {
  const instance = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, options);
  instances.push(instance);
  return instance;
};
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Host);
  vi.clearAllMocks();
});
afterEach(() => {
  instances.forEach((instance) => instance.destroy());
  instances.length = 0;
  vi.unstubAllGlobals();
});

describe('SDK rich text', () => {
  it('preserves isolated load/setCells snapshots, style updates, text replacement and undo/redo', () => {
    const book = createBlankWorkbook();
    const original = {
      value: 'hello',
      richText: [{ text: 'he', style: { bold: true } }, { text: 'llo' }],
    };
    book.sheets[0].cells.A1 = original;
    const instance = make({ workbook: book });
    original.richText[0].text = 'bad';
    expect(instance.getCell('A1')?.richText?.[0].text).toBe('he');
    instance.setCell('A1', 'hello', { background: '#ffffff' });
    expect(instance.getCell('A1')?.richText).toHaveLength(2);
    instance.setCell('A1', 2);
    expect(instance.getCell('A1')?.richText).toBeUndefined();
    instance.undo();
    expect(instance.getCell('A1')?.richText).toHaveLength(2);
    instance.redo();
    expect(instance.getValue('A1')).toBe(2);
    const snapshot = instance.toJSON();
    expect(() => instance.setCells([{ key: 'A1', cell: original }])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(instance.toJSON()).toEqual(snapshot);
    const runs = [
      {
        text: 'text',
        style: {
          italic: true,
          verticalAlign: 'superscript' as const,
          charset: 134,
          fontFamilyClass: 2,
        },
      },
    ];
    instance.setCells([{ key: 'A1', cell: { value: 'text', richText: runs } }]);
    runs[0].style.italic = false;
    expect(instance.getCell('A1')?.richText?.[0].style?.italic).toBe(true);
    instance.insertRows(0);
    expect(instance.getCell('A2')?.richText?.[0].text).toBe('text');
    expect(instance.getCell('A2')?.richText?.[0].style).toMatchObject({
      verticalAlign: 'superscript',
      charset: 134,
      fontFamilyClass: 2,
    });
    instance.undo();
    expect(instance.getCell('A1')?.richText?.[0].text).toBe('text');
  });
});
