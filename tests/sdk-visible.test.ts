import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));
import { LuminaSpreadsheet, type ClipboardMode } from '../src/sdk';

class Host {
  className = 'visible-host';
  classList = { add: (name: string) => (this.className += ` ${name}`) };
}
const instances: LuminaSpreadsheet[] = [];
function make(options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) {
  const instance = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, options);
  instances.push(instance);
  return instance;
}
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Host);
  vi.clearAllMocks();
});
afterEach(() => {
  instances.forEach((instance) => instance.destroy());
  instances.length = 0;
  vi.unstubAllGlobals();
});

describe('SDK visible clipboard view preference', () => {
  it('defaults to visible and forwards explicit modes to the actual surface', () => {
    const automatic = make();
    expect(automatic.clipboardMode).toBe('visible');
    expect(automatic.surface().props.clipboardMode).toBe('visible');
    const options = { clipboardMode: 'all' as ClipboardMode };
    const all = make(options);
    expect(all.clipboardMode).toBe('all');
    expect(all.surface().props.clipboardMode).toBe('all');
    options.clipboardMode = 'visible';
    expect(all.clipboardMode).toBe('all');
  });

  it('notifies the view once while preserving data, filter, calculation version and redo', () => {
    const onChange = vi.fn();
    const instance = make({ onChange });
    instance.setCell('A1', 10);
    instance.setCell('A1', 20);
    instance.undo();
    instance.setFilter('10');
    const before = instance.toJSON();
    const previous = instance.surface().props;
    const listener = vi.fn();
    instance.subscribe(listener);
    onChange.mockClear();
    instance.setClipboardMode('all');
    const next = instance.surface().props;
    expect(instance.clipboardMode).toBe('all');
    expect(next.clipboardMode).toBe('all');
    expect(next.renderVersion).toBeGreaterThan(previous.renderVersion);
    expect(next.calculationVersion).toBe(previous.calculationVersion);
    expect(next.filter).toBe(previous.filter);
    expect(next.sheet.cells).toBe(previous.sheet.cells);
    expect(next.getValue).toBe(previous.getValue);
    expect(instance.toJSON()).toEqual(before);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    instance.setClipboardMode('all');
    expect(listener).toHaveBeenCalledTimes(1);
    instance.redo();
    expect(instance.getValue('A1')).toBe(20);
    expect(instance.clipboardMode).toBe('all');
    instance.undo();
    expect(instance.getValue('A1')).toBe(10);
    expect(instance.clipboardMode).toBe('all');
  });

  it.each(['unknown', '', 'VISIBLE', null, 1, true, {}, []])(
    'rejects invalid constructor and setter values atomically: %j',
    (invalid) => {
      const host = new Host();
      expect(
        () =>
          new LuminaSpreadsheet(host as unknown as HTMLElement, {
            clipboardMode: invalid as ClipboardMode,
          }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
      expect(host.className).toBe('visible-host');
      expect(mounting.render).not.toHaveBeenCalled();
      const onChange = vi.fn();
      const instance = make({ clipboardMode: 'all', onChange });
      const revision = instance.snapshot();
      const data = instance.toJSON();
      const listener = vi.fn();
      instance.subscribe(listener);
      expect(() => instance.setClipboardMode(invalid as ClipboardMode)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
      expect(instance.clipboardMode).toBe('all');
      expect(instance.snapshot()).toBe(revision);
      expect(instance.toJSON()).toEqual(data);
      expect(listener).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it('treats undefined constructor mode as default but rejects an undefined setter value', () => {
    const instance = make({ clipboardMode: undefined });
    expect(instance.clipboardMode).toBe('visible');
    expect(() => instance.setClipboardMode(undefined as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(instance.clipboardMode).toBe('visible');
  });

  it('allows readonly and paged view changes and retains preference across load and binding', async () => {
    const instance = make({ readOnly: true });
    instance.setClipboardMode('all');
    expect(instance.clipboardMode).toBe('all');
    instance.load(createBlankWorkbook('替换'));
    expect(instance.clipboardMode).toBe('all');
    await instance.bindData({
      columnCount: 1,
      rowCount: 1,
      fetchPage: async () => ({ rows: [[99]], totalRows: 1 }),
    });
    expect(instance.clipboardMode).toBe('all');
    const version = instance.surface().props.calculationVersion;
    instance.setClipboardMode('visible');
    expect(instance.surface().props.clipboardMode).toBe('visible');
    expect(instance.surface().props.calculationVersion).toBe(version);
    expect(instance.getValue('A1')).toBe(99);
    expect(instance.surface().props.readOnly).toBe(true);
  });

  it('rejects getter and setter calls after destruction without notifying subscribers', () => {
    const instance = make();
    const listener = vi.fn();
    instance.subscribe(listener);
    instance.destroy();
    expect(() => instance.clipboardMode).toThrowError(
      expect.objectContaining({ code: 'DESTROYED' }),
    );
    expect(() => instance.setClipboardMode('all')).toThrowError(
      expect.objectContaining({ code: 'DESTROYED' }),
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it('commits mode before a subscriber reenters and keeps the later view choice', () => {
    const instance = make();
    let reentered = false;
    instance.subscribe(() => {
      if (reentered) return;
      reentered = true;
      expect(instance.clipboardMode).toBe('all');
      instance.setClipboardMode('visible');
    });
    instance.setClipboardMode('all');
    expect(instance.clipboardMode).toBe('visible');
    expect(instance.surface().props.clipboardMode).toBe('visible');
  });
});
