import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { Cell, Selection, Sheet } from '../src/lib/types';

// Keep React's JSX elements, but run only synchronous handlers: layout, paint
// and debounce effects need a browser and are covered by geometry/planner tests.
const hooks = vi.hoisted(() => ({ refs: [] as Array<{ current: unknown }>, cursor: 0 }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: (value: unknown) => (hooks.refs[hooks.cursor++] ??= { current: value }),
    useState: (value: unknown) => [typeof value === 'function' ? value() : value, vi.fn()],
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (callback: unknown) => callback,
    useEffect: vi.fn(),
    useLayoutEffect: vi.fn(),
    useId: () => 'test-active-cell',
  };
});
import Spreadsheet from '../src/components/Spreadsheet';
import type { SpreadsheetProps } from '../src/components/Spreadsheet';
import { createBlankWorkbook } from '../src/lib/seed';

type Props = Record<string, any>;
type Patch = { key: string; cell: Cell | null };

function clipboard(text = '') {
  const values = new Map([['text/plain', text]]);
  return {
    preventDefault: vi.fn(),
    clipboardData: {
      get types() {
        return [...values.keys()];
      },
      getData: vi.fn((type: string) => values.get(type) ?? ''),
      setData: vi.fn((type: string, value: string) => {
        values.set(type, value);
      }),
    },
  };
}
function keyboard(key: string) {
  return { key, preventDefault: vi.fn(), nativeEvent: {}, ctrlKey: false, metaKey: false };
}
function make(sheetValues: Partial<Sheet> = {}, options: Partial<SpreadsheetProps> = {}) {
  const workbook = createBlankWorkbook();
  const sheet = Object.assign(workbook.sheets[0], {
    rowCount: 10,
    colCount: 6,
    frozenRows: 0,
    cells: {},
    columnWidths: {},
    ...sheetValues,
  });
  const onPatch = vi.fn();
  const onSelect = vi.fn();
  const onEditError = vi.fn();
  const onChange = vi.fn();
  const viewport = {
    focus: vi.fn(),
    scrollTop: 0,
    scrollLeft: 0,
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => false,
    releasePointerCapture: vi.fn(),
  };
  const render = (selection: Selection, extra: Partial<SpreadsheetProps> = {}): Props => {
    hooks.cursor = 0;
    const element = Spreadsheet({
      workbook,
      sheet,
      selection,
      onPatch,
      onSelect,
      onEditError,
      onChange,
      ...options,
      ...extra,
    }) as ReactElement<Props>;
    const renderedViewport = element.props.children[0] as ReactElement<Props>;
    renderedViewport.props.ref.current = viewport;
    return renderedViewport.props;
  };
  const pointer = (clientX: number, clientY: number) => ({
    clientX,
    clientY,
    pointerId: 1,
    button: 0,
    buttons: 1,
    shiftKey: false,
    preventDefault: vi.fn(),
    currentTarget: viewport,
  });
  return { sheet, render, onPatch, onSelect, onEditError, onChange, pointer };
}
function applied(onPatch: ReturnType<typeof vi.fn>): Patch[] {
  return onPatch.mock.calls[0][1] as Patch[];
}

beforeEach(() => {
  hooks.refs = [];
  hooks.cursor = 0;
});

describe('Canvas pointer cancellation', () => {
  it('releases a rejected fill capture while filtering and accepts a subsequent pointer', () => {
    const { render, onPatch, pointer } = make({ cells: { A1: { value: 7 } } });
    const pending = render({ row: 0, col: 0 }, { filter: 'pending' });
    const first = pointer(139, 69);
    const target = first.currentTarget;
    target.hasPointerCapture = () => true;
    pending.onPointerDown(first);
    expect(target.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(onPatch).not.toHaveBeenCalled();
    const next = { ...pointer(200, 50), pointerId: 2 };
    pending.onPointerDown(next);
    expect(target.setPointerCapture).toHaveBeenCalledTimes(2);
    pending.onPointerCancel(next);
  });
  it.each(['fill', 'resize'])(
    'invalidates %s when data or layout changes before release',
    (kind) => {
      for (const change of [
        'cells',
        'widths',
        'hidden',
        'sheet',
        'book',
        'zoom',
        'calculation',
        'readonly',
        'filter',
      ]) {
        hooks.refs = [];
        const { sheet, render, onPatch, onChange, pointer } = make({ cells: { A1: { value: 7 } } });
        const view = render({ row: 0, col: 0 });
        const y = kind === 'fill' ? 69 : 10;
        view.onPointerDown(pointer(139, y));
        view.onPointerMove(pointer(kind === 'fill' ? 100 : 200, kind === 'fill' ? 110 : 10));
        const extra: Partial<SpreadsheetProps> = {};
        if (change === 'cells') sheet.cells = { A1: { value: 99 } };
        if (change === 'widths') sheet.columnWidths = { 0: 150 };
        if (change === 'hidden') sheet.hiddenRows = [1];
        if (change === 'sheet') extra.sheet = { ...sheet, id: 'replacement' };
        if (change === 'book') extra.workbook = createBlankWorkbook();
        if (change === 'zoom') extra.zoom = 150;
        if (change === 'calculation') extra.calculationVersion = 1;
        if (change === 'readonly') extra.readOnly = true;
        if (change === 'filter') extra.filter = 'changed';
        const updated = render({ row: 0, col: 0 }, extra);
        // A retained old callback must consult the latest render's context too.
        view.onPointerUp(pointer(200, 110));
        updated.onPointerUp(pointer(200, 110));
        expect(onPatch, change).not.toHaveBeenCalled();
        expect(onChange, change).not.toHaveBeenCalled();
      }
    },
  );

  it('keeps a normal fill active across selection-only SDK revisions', () => {
    const { render, onPatch, pointer } = make({ cells: { A1: { value: 7 } } });
    const initial = render({ row: 0, col: 0 });
    initial.onPointerDown(pointer(139, 69));
    initial.onPointerMove(pointer(100, 110));
    render({ row: 0, col: 0, endRow: 2, endCol: 0 }, { renderVersion: 1 }).onPointerUp(
      pointer(100, 110),
    );
    expect(onPatch).toHaveBeenCalledOnce();
  });

  it.each(['onPointerCancel', 'onLostPointerCapture'])(
    'discards fill on %s and allows a new drag',
    (cancel) => {
      const { render, onPatch, pointer } = make({ cells: { A1: { value: 7 } } });
      const view = render({ row: 0, col: 0 });
      view.onPointerDown(pointer(139, 69));
      view.onPointerMove(pointer(100, 110));
      view[cancel](pointer(100, 110));
      view.onPointerUp(pointer(100, 110));
      expect(onPatch).not.toHaveBeenCalled();
      view.onPointerDown(pointer(139, 69));
      view.onPointerMove(pointer(100, 110));
      view.onPointerUp(pointer(100, 110));
      expect(onPatch).toHaveBeenCalledOnce();
    },
  );

  it.each(['onPointerCancel', 'onLostPointerCapture'])('discards column resize on %s', (cancel) => {
    const { render, onChange, pointer } = make();
    const view = render({ row: 0, col: 0 });
    view.onPointerDown(pointer(139, 10));
    view.onPointerMove(pointer(200, 10));
    view[cancel](pointer(200, 10));
    view.onPointerUp(pointer(200, 10));
    expect(onChange).not.toHaveBeenCalled();
    view.onPointerDown(pointer(139, 10));
    view.onPointerMove(pointer(200, 10));
    view.onPointerUp(pointer(200, 10));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('ignores a second pointer while resizing and refuses commit after becoming read-only', () => {
    const { render, onChange, pointer } = make();
    const view = render({ row: 0, col: 0 });
    view.onPointerDown(pointer(139, 10));
    const other = { ...pointer(300, 10), pointerId: 2 };
    view.onPointerDown(other);
    view.onPointerMove(other);
    view.onPointerCancel(other);
    view.onLostPointerCapture(other);
    view.onPointerUp(other);
    expect(onChange).not.toHaveBeenCalled();
    view.onPointerMove(pointer(200, 10));
    render({ row: 0, col: 0 }, { readOnly: true }).onPointerUp(pointer(200, 10));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Canvas visible clipboard handlers', () => {
  it.each(['onCopy', 'onCut', 'onPaste'])(
    'leaves a clipboard event already handled by the host untouched (%s)',
    (handler) => {
      const { render, onPatch, onSelect, sheet } = make({ cells: { A1: { value: 'keep' } } });
      const event = { ...clipboard('host content'), defaultPrevented: true };
      render({ row: 0, col: 0 })[handler](event);
      expect(event.clipboardData.getData).not.toHaveBeenCalled();
      expect(event.clipboardData.setData).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(onPatch).not.toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
      expect(sheet.cells.A1.value).toBe('keep');
    },
  );
  it('retains cut data if clipboard writing fails, then permits a fresh cut', () => {
    const { render, onPatch, sheet } = make({ cells: { A1: { value: 'keep' } } });
    const handlers = render({ row: 0, col: 0 });
    const failed = clipboard();
    failed.clipboardData.setData.mockImplementationOnce(() => {
      throw new Error('Clipboard unavailable');
    });
    expect(() => handlers.onCut(failed)).not.toThrow();
    expect(onPatch).not.toHaveBeenCalled();
    expect(sheet.cells.A1.value).toBe('keep');
    const retry = clipboard();
    handlers.onCut(retry);
    expect(retry.clipboardData.getData('text/plain')).toBe('keep');
    expect(applied(onPatch)).toEqual([{ key: 'A1', cell: null }]);
    expect(onPatch).toHaveBeenCalledOnce();
  });
  it.each(['"a"oops', '"""oops', 'valid\t12\n"bad"suffix', '"" "other"'])(
    'rejects malformed quoted clipboard text without applying any cells (%#)',
    (text) => {
      const { render, onPatch, onSelect } = make({ cells: { A1: { value: 'original' } } });
      render({ row: 0, col: 0 }).onPaste(clipboard(text));
      expect(onPatch).not.toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
    },
  );
  it('accepts padding after a closing quote without adding it to the cell value', () => {
    const { render, onPatch } = make();
    render({ row: 0, col: 0 }).onPaste(clipboard('""  \t"a"  \r\n"b" \tplain"quote'));
    expect(applied(onPatch)).toEqual([
      { key: 'A1', cell: { value: '' } },
      { key: 'B1', cell: { value: 'a' } },
      { key: 'A2', cell: { value: 'b' } },
      { key: 'B2', cell: { value: 'plain"quote' } },
    ]);
  });
  it.each(['first\n""', 'first\r\n""  ', 'first\r""  \r\n'])(
    'preserves a final quoted empty record and matching selection dimensions (%#)',
    (text) => {
      const { render, onPatch, onSelect } = make({ hiddenRows: [1] });
      render({ row: 0, col: 0 }).onPaste(clipboard(text));
      expect(applied(onPatch)).toEqual([
        { key: 'A1', cell: { value: 'first' } },
        { key: 'A3', cell: { value: '' } },
      ]);
      expect(onSelect).toHaveBeenCalledWith({ row: 0, col: 0, endRow: 2, endCol: 0 });
    },
  );
  it('counts escaped quotes by decoded length and rejects overflow before applying a batch', () => {
    const { render, onPatch, onSelect } = make();
    const value = 'a'.repeat(32766) + '"';
    render({ row: 0, col: 0 }).onPaste(clipboard('"' + value.replaceAll('"', '""') + '"  '));
    expect(applied(onPatch)).toEqual([{ key: 'A1', cell: { value } }]);
    onPatch.mockClear();
    onSelect.mockClear();
    render({ row: 0, col: 0 }).onPaste(clipboard('valid\n"' + value.replaceAll('"', '""') + 'x"'));
    expect(onPatch).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
  it.each(['left\rright', 'left\r\nright', 'left\rright\t"quoted"'])(
    'quotes carriage returns so external clipboard round trips stay in one cell (%#)',
    (value) => {
      const { render, onPatch } = make({ cells: { A1: { value } } });
      const copied = clipboard();
      render({ row: 0, col: 0 }).onCopy(copied);
      const text = copied.clipboardData.getData('text/plain');
      expect(text).toBe('"' + value.replaceAll('"', '""') + '"');
      render({ row: 4, col: 2 }).onPaste(clipboard(text));
      expect(onPatch).toHaveBeenCalledOnce();
      expect(applied(onPatch)).toEqual([
        { key: 'C5', cell: { value: value.replace(/\r\n?/g, '\n') } },
      ]);
      onPatch.mockClear();
      render({ row: 4, col: 2 }).onPaste(copied);
      expect(applied(onPatch)).toEqual([{ key: 'C5', cell: { value } }]);
    },
  );
  it('uses the bounded internal shape for a wide visible copy beyond external TSV column limits', () => {
    const { render, onPatch } = make({ colCount: 300, cells: { A1: { value: 'wide' } } });
    const event = clipboard();
    render({ row: 0, col: 0, endRow: 0, endCol: 299 }).onCopy(event);
    render({ row: 1, col: 0 }).onPaste(event);
    expect(applied(onPatch)).toHaveLength(300);
    expect(applied(onPatch)[0]).toEqual({ key: 'A2', cell: { value: 'wide' } });
    expect(applied(onPatch).at(-1)?.key).toBe('KN2');
  });

  it('copies compact visible cells and translates internal formulas using original coordinates', () => {
    const { render, onPatch } = make({
      hiddenRows: [1],
      hiddenColumns: [1],
      cells: { A1: { value: '=C1+$D$1' }, A2: { value: 'hidden' }, A3: { value: '=C3+$D$1' } },
    });
    const copy = clipboard();
    render({ row: 0, col: 0, endRow: 2, endCol: 0 }).onCopy(copy);
    render({ row: 4, col: 2 }).onPaste(copy);
    expect(applied(onPatch)).toEqual([
      { key: 'C5', cell: { value: '=E5+$D$1' } },
      { key: 'C6', cell: { value: '=E6+$D$1' } },
    ]);
  });

  it('routes compact TSV through visible axes and retains blank fields and quoted newlines', () => {
    const { render, onPatch } = make({ hiddenRows: [1], hiddenColumns: [1] });
    render({ row: 0, col: 0 }).onPaste(clipboard('"a\nb"\t\n\t4\n'));
    expect(applied(onPatch)).toEqual([
      { key: 'A1', cell: { value: 'a\nb' } },
      { key: 'C1', cell: { value: '' } },
      { key: 'A3', cell: { value: '' } },
      { key: 'C3', cell: { value: 4 } },
    ]);
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it('preserves an internal copied trailing blank row', () => {
    const { render, onPatch } = make({
      cells: { A1: { value: 'first' }, C6: { value: 'replace' } },
    });
    const event = clipboard();
    render({ row: 0, col: 0, endRow: 1, endCol: 0 }).onCopy(event);
    render({ row: 4, col: 2 }).onPaste(event);
    expect(applied(onPatch)).toEqual([
      { key: 'C5', cell: { value: 'first' } },
      { key: 'C6', cell: { value: '' } },
    ]);
  });

  it('retains two internally copied blank rows and accepts an external blank cell', () => {
    const { render, onPatch } = make();
    const event = clipboard();
    render({ row: 0, col: 0, endRow: 1, endCol: 0 }).onCopy(event);
    expect(event.clipboardData.getData('text/plain')).toBe('\n');
    render({ row: 4, col: 2 }).onPaste(event);
    expect(applied(onPatch)).toEqual([
      { key: 'C5', cell: { value: '' } },
      { key: 'C6', cell: { value: '' } },
    ]);
    onPatch.mockClear();
    render({ row: 4, col: 2 }).onPaste(clipboard(''));
    expect(applied(onPatch)).toEqual([{ key: 'C5', cell: { value: '' } }]);
  });

  it('treats matching external text without the internal token as values', () => {
    const { render, onPatch, sheet } = make({
      cells: { A1: { value: '=1+1', style: { bold: true } } },
    });
    const event = clipboard();
    render({ row: 0, col: 0 }).onCopy(event);
    const text = event.clipboardData.getData('text/plain');
    expect(text).toBe('2');
    sheet.cells.A1.value = '=999';
    sheet.cells.A1.style!.bold = false;
    render({ row: 4, col: 2 }).onPaste(clipboard(text));
    expect(applied(onPatch)).toEqual([{ key: 'C5', cell: { value: 2 } }]);
    onPatch.mockClear();
    render({ row: 4, col: 2 }).onPaste(event);
    expect(applied(onPatch)).toEqual([
      { key: 'C5', cell: { value: '=1+1', style: { bold: true } } },
    ]);
  });

  it('cuts one compact visible batch and leaves hidden cells intact', () => {
    const { render, onPatch } = make({
      hiddenRows: [1],
      cells: { A1: { value: 1 }, A2: { value: 2 }, A3: { value: 3 } },
    });
    const event = clipboard();
    render({ row: 0, col: 0, endRow: 2, endCol: 0 }).onCut(event);
    expect(event.clipboardData.getData('text/plain')).toBe('1\n3');
    expect(applied(onPatch)).toEqual([
      { key: 'A1', cell: null },
      { key: 'A3', cell: null },
    ]);
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it('allows explicit all-mode delete and paste even when every axis is hidden', () => {
    const { render, onPatch } = make(
      {
        rowCount: 2,
        colCount: 1,
        hiddenRows: [0, 1],
        hiddenColumns: [0],
        cells: { A1: { value: 1 }, A2: { value: 2 } },
      },
      { clipboardMode: 'all' },
    );
    render({ row: 0, col: 0, endRow: 1, endCol: 0 }).onKeyDown(keyboard('Delete'));
    expect(applied(onPatch)).toEqual([
      { key: 'A1', cell: null },
      { key: 'A2', cell: null },
    ]);
    onPatch.mockClear();
    render({ row: 0, col: 0 }).onPaste(clipboard('4\n5'));
    expect(applied(onPatch).map(({ key, cell }) => [key, cell?.value])).toEqual([
      ['A1', 4],
      ['A2', 5],
    ]);
  });

  it('deletes visible cells only and clears one original merge anchor through a visible fragment', () => {
    const { render, onPatch } = make({
      hiddenRows: [0, 2],
      cells: { A1: { value: 'anchor' }, A3: { value: 'covered' }, A4: { value: 'last' } },
      merges: [{ start: { row: 0, col: 0 }, end: { row: 2, col: 0 } }],
    });
    render({ row: 0, col: 0, endRow: 3, endCol: 0 }).onKeyDown(keyboard('Delete'));
    expect(applied(onPatch)).toEqual([
      { key: 'A1', cell: null },
      { key: 'A4', cell: null },
    ]);
  });

  it('rejects an entire multi-cell paste across a merge or short visible tail before writing', () => {
    const { render, onPatch, onSelect } = make({
      rowCount: 3,
      merges: [{ start: { row: 1, col: 0 }, end: { row: 2, col: 0 } }],
    });
    render({ row: 0, col: 0 }).onPaste(clipboard('1\n2'));
    render({ row: 2, col: 2 }).onPaste(clipboard('1\n2'));
    expect(onPatch).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('blocks visible operations until filtering completes, while all mode still copies', () => {
    const { render, onPatch } = make({ cells: { A1: { value: 'keep' } } }, { filter: 'keep' });
    const handlers = render({ row: 0, col: 0 });
    const copy = clipboard();
    handlers.onCopy(copy);
    handlers.onCut(copy);
    handlers.onPaste(clipboard('replacement'));
    handlers.onKeyDown(keyboard('Delete'));
    expect(copy.clipboardData.setData).not.toHaveBeenCalled();
    expect(onPatch).not.toHaveBeenCalled();
    render({ row: 0, col: 0 }, { clipboardMode: 'all' }).onCopy(copy);
    expect(copy.clipboardData.setData).toHaveBeenCalledWith('text/plain', 'keep');
  });

  it('blocks fill completion if filtering starts during the drag', () => {
    const { render, onPatch, pointer } = make({ cells: { A1: { value: '=C1' } } });
    const handlers = render({ row: 0, col: 0 });
    handlers.onPointerDown(pointer(139, 69));
    handlers.onPointerMove(pointer(100, 110));
    render({ row: 0, col: 0 }, { filter: 'pending' }).onPointerUp(pointer(100, 110));
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('permits readonly copy but never mutates on cut, paste, delete or fill', () => {
    const { render, onPatch, pointer } = make({ cells: { A1: { value: 1 } } }, { readOnly: true });
    const handlers = render({ row: 0, col: 0 });
    const event = clipboard();
    handlers.onCut(event);
    expect(event.clipboardData.getData('text/plain')).toBe('1');
    handlers.onPaste(clipboard('2'));
    handlers.onKeyDown(keyboard('Delete'));
    handlers.onPointerDown(pointer(139, 69));
    handlers.onPointerMove(pointer(100, 110));
    handlers.onPointerUp(pointer(100, 110));
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('submits a visible paste once and leaves selection unchanged when the host rejects the batch', () => {
    const failure = new Error('invalid candidate');
    const onPatch = vi.fn(() => {
      throw failure;
    });
    const { render, onSelect, onEditError, sheet } = make(
      { hiddenRows: [1], cells: { A1: { value: 'old' } } },
      { onPatch },
    );
    render({ row: 0, col: 0 }).onPaste(clipboard('1\n2'));
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(applied(onPatch).map((patch) => patch.key)).toEqual(['A1', 'A3']);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onEditError).toHaveBeenCalledWith(failure);
    expect(sheet.cells.A1.value).toBe('old');
  });

  it('fills compact visible rows with original-coordinate formula translation in one patch', () => {
    const { render, onPatch, pointer } = make({
      hiddenRows: [1, 3],
      cells: { A1: { value: '=C1' } },
    });
    const handlers = render({ row: 0, col: 0 });
    handlers.onPointerDown(pointer(139, 69));
    handlers.onPointerMove(pointer(100, 110));
    handlers.onPointerUp(pointer(100, 110));
    expect(applied(onPatch)).toEqual([
      { key: 'A3', cell: { value: '=C3' } },
      { key: 'A5', cell: { value: '=C5' } },
    ]);
    expect(onPatch).toHaveBeenCalledTimes(1);
  });
});

it('exposes the canvas selection through a keyboard grid accessibility contract', () => {
  const { render } = make({ rowCount: 20, colCount: 8 });
  const props = render({ row: 4, col: 6, endRow: 5, endCol: 7 });
  expect(props.role).toBe('grid');
  expect(props.tabIndex).toBe(0);
  expect(props['aria-rowcount']).toBe(20);
  expect(props['aria-colcount']).toBe(8);
  expect(props['aria-activedescendant']).toBe('test-active-cell');
  expect(props['aria-multiselectable']).toBe('true');
  const stage = (props.children as ReactElement<Props>[]).find(
    (child) => child?.props?.className === 'spreadsheet-canvas-stage',
  ) as ReactElement<Props>;
  const row = (stage.props.children as ReactElement<Props>[]).find(
    (child) => child?.props?.role === 'row',
  ) as ReactElement<Props>;
  expect(row.props['aria-rowindex']).toBe(5);
  expect(row.props['aria-live']).toBe('polite');
  expect(row.props['aria-atomic']).toBe('true');
  const proxy = row.props.children as ReactElement<Props>;
  expect(proxy.props.id).toBe(props['aria-activedescendant']);
  expect(proxy.props.role).toBe('gridcell');
  expect(proxy.props['aria-rowindex']).toBe(5);
  expect(proxy.props['aria-colindex']).toBe(7);
  expect(proxy.props['aria-selected']).toBe('true');
  expect(proxy.props.children).toBe('G5 ，已选择 G5:H6，2 行 2 列');
  expect(props['aria-readonly']).toBe(false);
});

it('updates accessible values, reverse selections and read-only state without extra tab stops', () => {
  const { render } = make({ cells: { B2: { value: '中文' } } });
  const readProxy = (props: Props) => {
    const stage = props.children.find(
      (child: ReactElement<Props>) => child?.props?.className === 'spreadsheet-canvas-stage',
    );
    return stage.props.children.find((child: ReactElement<Props>) => child?.props?.role === 'row')
      .props.children.props;
  };
  const first = render({ row: 1, col: 1 }, { readOnly: true });
  expect(first['aria-readonly']).toBe(true);
  expect(readProxy(first).children).toBe('B2 中文');
  expect(readProxy(first).tabIndex).toBeUndefined();
  const next = render(
    { row: 1, col: 1, endRow: 0, endCol: 0 },
    {
      getValue: () => 42,
      readOnly: false,
    },
  );
  expect(next['aria-readonly']).toBe(false);
  expect(readProxy(next).children).toBe('B2 42，已选择 A1:B2，2 行 2 列');
});

it.each(['1e-999', '3e-324', '-0.00', '0.1234567890123456789'])(
  'preserves precision-sensitive pasted text %s',
  (text) => {
    const { render, onPatch } = make();
    render({ row: 0, col: 0 }).onPaste(clipboard(text));
    expect(applied(onPatch)[0].cell?.value).toBe(text);
  },
);
