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
      onChange: vi.fn(),
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
  return { sheet, render, onPatch, onSelect, onEditError, pointer };
}
function applied(onPatch: ReturnType<typeof vi.fn>): Patch[] {
  return onPatch.mock.calls[0][1] as Patch[];
}

beforeEach(() => {
  hooks.refs = [];
  hooks.cursor = 0;
});

describe('Canvas visible clipboard handlers', () => {
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
