import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { CellValue, Sheet } from '../src/lib/types';
import type { DataValidationRule } from '../src/lib/data-validation';

// Execute the actual Canvas component and event handlers while skipping browser
// drawing/layout effects. Memo slots honor dependencies, as they do in React, so
// picker sessions retain the same row/column metric identities across renders.
const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0 }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const memo = (factory: () => unknown, deps?: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (
      !previous ||
      !deps ||
      !previous.deps ||
      deps.length !== previous.deps.length ||
      deps.some((value, i) => !Object.is(value, previous.deps[i]))
    )
      hooks.slots[index] = { value: factory(), deps };
    return hooks.slots[index].value;
  };
  return {
    ...actual,
    useRef: (initial: unknown) => (hooks.slots[hooks.cursor++] ??= { current: initial }),
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      hooks.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [
        hooks.slots[index].value,
        (next: unknown) => {
          hooks.slots[index].value =
            typeof next === 'function' ? next(hooks.slots[index].value) : next;
        },
      ];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps?: unknown[]) => memo(() => callback, deps),
    useEffect: vi.fn(),
    useLayoutEffect: vi.fn(),
    useId: () => 'validation-active-cell',
  };
});
const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));
import Spreadsheet from '../src/components/Spreadsheet';
import type { SpreadsheetProps } from '../src/components/Spreadsheet';
import ValidationPicker from '../src/components/ValidationPicker';
import { createBlankWorkbook } from '../src/lib/seed';
import { planWorkspaceCellChanges } from '../src/lib/workspace-edit';
import { LuminaSpreadsheet } from '../src/sdk';

type Element = ReactElement<Record<string, any>>;
const rules = (values: CellValue[] = ['1', 1, false, '']): DataValidationRule[] => [
  {
    id: 'choices',
    kind: 'list',
    values,
    range: { start: { row: 0, col: 0 }, end: { row: 9, col: 3 } },
  },
];
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Record<string, any>>(node) ? [node, ...elements(node.props.children)] : [];
}
function make(values: Partial<Sheet> = {}, options: Partial<SpreadsheetProps> = {}) {
  const workbook = createBlankWorkbook();
  const sheet = Object.assign(workbook.sheets[0], {
    rowCount: 20,
    colCount: 8,
    frozenRows: 0,
    cells: {},
    columnWidths: {},
    dataValidations: rules(),
    ...values,
  });
  const props: SpreadsheetProps = {
    workbook,
    sheet,
    selection: { row: 0, col: 0 },
    onPatch: vi.fn(),
    onChange: vi.fn(),
    onSelect: vi.fn(),
    onEditError: vi.fn(),
    ...options,
  };
  const viewport = {
    focus: vi.fn(),
    scrollLeft: 0,
    scrollTop: 0,
    isConnected: true,
    ownerDocument: { activeElement: null, body: {}, documentElement: {} },
  };
  const render = (extra: Partial<SpreadsheetProps> = {}) => {
    Object.assign(props, extra);
    hooks.cursor = 0;
    const tree = Spreadsheet(props);
    const all = elements(tree);
    const region = all.find((node) => node.props.className === 'spreadsheet-viewport')!;
    region.props.ref.current = viewport;
    return {
      tree,
      region,
      trigger: all.find((node) => node.props.className === 'sheet-validation-trigger'),
      picker: all.find((node) => node.type === ValidationPicker),
      notice: all.find((node) => node.props.className === 'sheet-clipboard-notice'),
      editor: all.find((node) => node.props.className === 'sheet-cell-editor sheet-canvas-editor'),
    };
  };
  const open = () => {
    const trigger = render().trigger;
    if (!trigger) throw new Error('Expected validation trigger');
    trigger.props.onClick();
    const picker = render().picker;
    if (!picker) throw new Error('Expected validation picker');
    return picker;
  };
  return { workbook, sheet, props, render, open, viewport };
}
const keyEvent = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  preventDefault: vi.fn(),
  nativeEvent: {},
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...extra,
});
beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: () => void) => {
      callback();
      return 1;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Canvas validation picker integration', () => {
  it.each(['ctrlKey', 'metaKey'])(
    'locates the used bottom-right cell independent of insertion order with %s+End',
    (modifier) => {
      const grid = make({ cells: { H2: { value: 1 }, A10: { value: 2 } } });
      const event = keyEvent('End', { [modifier]: true });
      grid.render().region.props.onKeyDown(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(grid.props.onSelect).toHaveBeenLastCalledWith({ row: 9, col: 7 });
      grid.sheet.cells = { A10: { value: 2 }, H2: { value: 1 } };
      grid.render().region.props.onKeyDown(keyEvent('End', { [modifier]: true }));
      expect(grid.props.onSelect).toHaveBeenLastCalledWith({ row: 9, col: 7 });
    },
  );
  it('uses A1 for an empty sheet and preserves the anchor when extending to the used end', () => {
    const grid = make({}, { selection: { row: 3, col: 2 }, readOnly: true });
    grid.render().region.props.onKeyDown(keyEvent('End', { ctrlKey: true }));
    expect(grid.props.onSelect).toHaveBeenLastCalledWith({ row: 0, col: 0 });
    grid.sheet.cells = { H2: { value: '' }, A10: { value: 2 } };
    grid.render().region.props.onKeyDown(keyEvent('End', { ctrlKey: true, shiftKey: true }));
    expect(grid.props.onSelect).toHaveBeenLastCalledWith({
      row: 3,
      col: 2,
      endRow: 9,
      endCol: 7,
    });
    grid.render().region.props.onKeyDown(keyEvent('End'));
    expect(grid.props.onSelect).toHaveBeenLastCalledWith({ row: 3, col: 7 });
    grid.render().region.props.onKeyDown(keyEvent('Home'));
    expect(grid.props.onSelect).toHaveBeenLastCalledWith({ row: 3, col: 0 });
    expect(grid.props.onChange).not.toHaveBeenCalled();
    expect(grid.props.onPatch).not.toHaveBeenCalled();
  });
  it('leaves navigation to a host that already prevented Ctrl/Cmd+End', () => {
    const grid = make({ cells: { A10: { value: 2 } } }, { selection: { row: 2, col: 3 } });
    const event = keyEvent('End', { ctrlKey: true, defaultPrevented: true });
    grid.render().region.props.onKeyDown(event);
    expect(grid.props.onSelect).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it.each(['composing', 'rejected'])(
    'preserves the %s editor on a double-click in another cell',
    (reason) => {
      const grid = make();
      Object.assign(grid.viewport, { getBoundingClientRect: () => ({ left: 0, top: 0 }) });
      grid.render().region.props.onKeyDown(keyEvent('F2'));
      const view = grid.render();
      const editor = view.editor!;
      editor.props.ref.current = {
        focus: vi.fn(),
        isConnected: true,
        ownerDocument: grid.viewport.ownerDocument,
      };
      if (reason === 'composing') editor.props.onCompositionStart();
      else
        vi.mocked(grid.props.onPatch!).mockImplementation(() => {
          throw new Error('拒绝输入');
        });
      editor.props.onChange({ target: { value: 'pending' } });
      vi.mocked(grid.props.onSelect).mockClear();
      view.region.props.onDoubleClick({ target: grid.viewport, clientX: 200, clientY: 50 });
      expect(grid.render().editor?.props['aria-label']).toBe('编辑单元格 A1');
      expect(grid.render().editor?.props.value).toBe('pending');
      expect(grid.props.onSelect).not.toHaveBeenCalled();
      if (reason === 'composing') {
        expect(grid.props.onPatch).not.toHaveBeenCalled();
        editor.props.onCompositionEnd({ currentTarget: { value: '中文' } });
      } else vi.mocked(grid.props.onPatch!).mockReset();
      grid.render().editor!.props.onKeyDown(keyEvent('Enter', { stopPropagation: vi.fn() }));
      expect(grid.props.onPatch).toHaveBeenCalledOnce();
      expect(grid.props.onPatch).toHaveBeenLastCalledWith(
        grid.sheet.id,
        [{ key: 'A1', cell: { value: reason === 'composing' ? '中文' : 'pending' } }],
        undefined,
      );
    },
  );

  it('leaves editor caret placement and word selection to the input without committing its draft', () => {
    const grid = make({ cells: { A1: { value: 'original' } } });
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const view = grid.render();
    const editor = view.editor!;
    const input = { value: 'new draft', selectionStart: 2, selectionEnd: 4 };
    editor.props.ref.current = input;
    editor.props.onChange({ target: input });
    vi.mocked(grid.props.onSelect).mockClear();
    const event = {
      target: input,
      button: 0,
      buttons: 1,
      pointerId: 1,
      clientX: 100,
      clientY: 50,
      currentTarget: grid.viewport,
      preventDefault: vi.fn(),
    };
    // Exercise the viewport handlers that receive bubbled input events. Native
    // caret/selection behavior itself still needs a real-browser check.
    for (const handler of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onDoubleClick'])
      expect(() => view.region.props[handler](event)).not.toThrow();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    expect(grid.props.onSelect).not.toHaveBeenCalled();
    expect(grid.viewport.focus).not.toHaveBeenCalled();
    expect(grid.render().editor?.props.value).toBe('new draft');
    editor.props.onBlur();
    expect(grid.props.onPatch).toHaveBeenCalledExactlyOnceWith(
      grid.sheet.id,
      [{ key: 'A1', cell: { value: 'new draft' } }],
      undefined,
    );
  });

  it('reports an uncommitted draft and clears the dirty state after commit', () => {
    const onDraftStateChange = vi.fn();
    const grid = make({ cells: { A1: { value: 'old' } } }, { onDraftStateChange });
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const editor = grid.render().editor!;
    editor.props.onChange({ target: { value: 'draft' } });
    expect(onDraftStateChange).toHaveBeenLastCalledWith(true);
    editor.props.onBlur();
    expect(onDraftStateChange).toHaveBeenLastCalledWith(false);
  });
  it('reports composition-only drafts and clears risk after deferred blur commits', () => {
    const dirty = vi.fn();
    const grid = make({ cells: { A1: { value: 'old' } } }, { onDraftStateChange: dirty });
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const input = grid.render().editor!;
    input.props.onCompositionStart();
    input.props.onCompositionEnd({ currentTarget: { value: '中文' } });
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    input.props.onCompositionStart();
    input.props.onBlur();
    input.props.onCompositionEnd({ currentTarget: { value: '最后' } });
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(grid.props.onPatch).toHaveBeenCalledOnce();
  });
  it('still commits a draft when the pointer targets another grid cell', () => {
    const grid = make();
    Object.assign(grid.viewport, {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: vi.fn(),
    });
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const view = grid.render();
    view.editor!.props.ref.current = {};
    view.editor!.props.onChange({ target: { value: 'saved' } });
    view.region.props.onPointerDown({
      target: grid.viewport,
      currentTarget: grid.viewport,
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 50,
      preventDefault: vi.fn(),
    });
    expect(grid.props.onPatch).toHaveBeenCalledOnce();
    expect(grid.props.onSelect).toHaveBeenLastCalledWith({ row: 0, col: 1 });
  });
  it('finishes deferred IME blur with final text exactly once', () => {
    const grid = make();
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const editor = grid.render().editor!;
    editor.props.onCompositionStart();
    editor.props.onChange({ target: { value: 'zhong' } });
    editor.props.onBlur();
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    editor.props.onCompositionEnd({ currentTarget: { value: '中文' } });
    editor.props.onBlur();
    editor.props.onChange({ target: { value: '迟到输入' } });
    expect(grid.props.onPatch).toHaveBeenCalledExactlyOnceWith(
      grid.sheet.id,
      [{ key: 'A1', cell: { value: '中文' } }],
      undefined,
    );
  });
  it('discards deferred composition after the data source changes', () => {
    const grid = make();
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const editor = grid.render().editor!;
    editor.props.onCompositionStart();
    editor.props.onBlur();
    grid.render({ sheet: { ...grid.sheet, cells: {} } });
    editor.props.onCompositionEnd({ currentTarget: { value: '旧内容' } });
    expect(grid.props.onPatch).not.toHaveBeenCalled();
  });
  it('commits the latest input on immediate blur only once, before a rerender', () => {
    const grid = make({}, { readOnly: false });
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const editor = grid.render().editor!;
    editor.props.onChange({ target: { value: '最终输入' } });
    editor.props.onBlur();
    editor.props.onBlur();
    expect(grid.props.onPatch).toHaveBeenCalledExactlyOnceWith(
      grid.sheet.id,
      [{ key: 'A1', cell: { value: '最终输入' } }],
      undefined,
    );
  });
  it.each([
    'sheet',
    'workbook',
    'cells',
    'dimensions',
    'readonly',
    'calculationVersion',
    'renderVersion',
    'selection',
    'extended selection',
  ])('rejects a late editor blur after changing %s', (change) => {
    const grid = make();
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const editor = grid.render().editor!;
    editor.props.onChange({ target: { value: '旧草稿' } });
    if (change === 'sheet') grid.render({ sheet: { ...grid.sheet, id: 'other' } });
    if (change === 'workbook') grid.render({ workbook: { ...grid.workbook, id: 'other' } });
    if (change === 'cells')
      grid.render({ sheet: { ...grid.sheet, cells: { A1: { value: '新内容' } } } });
    if (change === 'dimensions') grid.render({ sheet: { ...grid.sheet, rowCount: 21 } });
    if (change === 'readonly') grid.render({ readOnly: true });
    if (change === 'calculationVersion') grid.render({ calculationVersion: 1 });
    if (change === 'renderVersion') grid.render({ renderVersion: 1 });
    if (change === 'selection') grid.render({ selection: { row: 1, col: 0 } });
    if (change === 'extended selection')
      grid.render({ selection: { row: 0, col: 0, endRow: 1, endCol: 0 } });
    editor.props.onBlur();
    editor.props.onChange({ target: { value: '迟到输入' } });
    expect(grid.props.onPatch).not.toHaveBeenCalled();
  });
  it('ignores a cancelled session callback after opening another editor', () => {
    const grid = make();
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const old = grid.render().editor!;
    old.props.onKeyDown(keyEvent('Escape', { stopPropagation: vi.fn() }));
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const fresh = grid.render().editor!;
    fresh.props.onChange({ target: { value: 'new' } });
    old.props.onBlur();
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    fresh.props.onBlur();
    expect(grid.props.onPatch).toHaveBeenCalledOnce();
  });
  it('does not submit Enter reported as IME keyCode 229', () => {
    const grid = make();
    grid.render().region.props.onKeyDown(keyEvent('F2'));
    const editor = grid.render().editor!;
    editor.props.onChange({ target: { value: '中文' } });
    editor.props.onKeyDown(
      keyEvent('Enter', { nativeEvent: { keyCode: 229 }, stopPropagation: vi.fn() }),
    );
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    editor.props.onKeyDown(keyEvent('Enter', { stopPropagation: vi.fn() }));
    expect(grid.props.onPatch).toHaveBeenCalledOnce();
  });
  it('reads no list values for selection or scrolling and memoizes candidates after opening', () => {
    const values = ['1', 1, false, ''];
    const candidateRules = rules(values);
    const readValues = vi.fn(() => values);
    Object.defineProperty(candidateRules[0], 'values', { get: readValues, enumerable: true });
    const grid = make({ dataValidations: candidateRules });
    expect(grid.render().trigger).toBeDefined();
    expect(grid.render({ selection: { row: 2, col: 0 } }).trigger).toBeDefined();
    grid.render().region.props.onScroll({ currentTarget: { scrollLeft: 0, scrollTop: 10 } });
    expect(grid.render().trigger).toBeDefined();
    expect(readValues).not.toHaveBeenCalled();
    const picker = grid.open();
    expect(picker.props.values).toEqual(values);
    const readsAfterOpen = readValues.mock.calls.length;
    expect(readsAfterOpen).toBeGreaterThan(0);
    grid.render();
    grid.render();
    expect(readValues).toHaveBeenCalledTimes(readsAfterOpen);
    picker.props.onClose(false);
    grid.render();
    grid.render({ selection: { row: 3, col: 0 } });
    expect(readValues).toHaveBeenCalledTimes(readsAfterOpen);
  });

  it('opens using the trigger or Alt+ArrowDown and keeps the picker outside viewport handlers', () => {
    const grid = make();
    const first = grid.render();
    expect(first.trigger?.props['aria-label']).toBe('选择 A1 的允许值');
    expect(first.trigger?.props['aria-expanded']).toBe(false);
    const pointer = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    first.trigger!.props.onPointerDown(pointer);
    expect(pointer.preventDefault).toHaveBeenCalledOnce();
    expect(pointer.stopPropagation).toHaveBeenCalledOnce();
    const opened = grid.open();
    expect(opened.props.address).toBe('A1');
    expect(opened.props.values).toEqual(['1', 1, false, '']);
    expect(elements(grid.render().region).some((node) => node.type === ValidationPicker)).toBe(
      false,
    );
    opened.props.onClose(true);
    expect(grid.render().picker).toBeUndefined();
    expect(grid.viewport.focus).toHaveBeenCalled();
    const event = keyEvent('ArrowDown', { altKey: true });
    grid.render().region.props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(grid.render().picker).toBeDefined();
  });

  it.each(['1', 1, false, ''] as const)(
    'commits typed value %j as one patch and preserves style',
    (value) => {
      const style = { bold: true, color: '#112233' };
      const grid = make({ cells: { A1: { value: 'old', style } } });
      const picker = grid.open();
      expect(picker.props.onChoose(value)).toBe(true);
      expect(grid.props.onPatch).toHaveBeenCalledExactlyOnceWith(
        grid.sheet.id,
        [{ key: 'A1', cell: { value, style } }],
        undefined,
      );
      expect(grid.sheet.cells.A1).toEqual({ value: 'old', style });
      expect(grid.props.onChange).not.toHaveBeenCalled();
      expect(grid.render().picker).toBeUndefined();
    },
  );

  it('replaces inline formatting only when a list choice changes the text', () => {
    const original = { value: 'old', richText: [{ text: 'old', style: { bold: true } }] };
    const grid = make({ cells: { A1: original } });
    expect(grid.open().props.onChoose(1)).toBe(true);
    expect(grid.props.onPatch).toHaveBeenCalledExactlyOnceWith(
      grid.sheet.id,
      [{ key: 'A1', cell: { value: 1 } }],
      undefined,
    );
    expect(grid.sheet.cells.A1.richText).toEqual(original.richText);
  });
  it('does not create patches for an identical typed value or a missing empty cell', () => {
    const grid = make({ cells: { A1: { value: 1, style: { italic: true } } } });
    expect(grid.open().props.onChoose(1)).toBe(true);
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    grid.render({ selection: { row: 1, col: 0 } });
    expect(grid.open().props.onChoose('')).toBe(true);
    expect(grid.props.onPatch).not.toHaveBeenCalled();
  });

  it('keeps the picker open and surfaces a real atomic workspace validation rejection', () => {
    const grid = make({
      cells: { A1: { value: 'old', style: { bold: true } }, B1: { value: 'untouched' } },
    });
    const authoritative = structuredClone(grid.workbook);
    authoritative.sheets[0].dataValidations = rules([1]);
    const before = structuredClone(authoritative);
    const commit = vi.fn((sheetId, changes, dimensions) => {
      const planned = planWorkspaceCellChanges(authoritative, sheetId, changes, dimensions);
      if (planned) authoritative.sheets[0] = planned.sheet;
    });
    grid.render({ onPatch: commit });
    const picker = grid.open();
    expect(picker.props.onChoose('1')).toBe(false);
    expect(authoritative).toEqual(before);
    expect(grid.props.onEditError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(grid.render().picker).toBeDefined();
    expect(grid.render().notice?.props.children).toContain('不在允许');
    expect(grid.render().picker!.props.onChoose(1)).toBe(true);
    expect(authoritative.sheets[0].cells.A1).toEqual({ value: 1, style: { bold: true } });
    expect(authoritative.sheets[0].cells.B1).toEqual({ value: 'untouched' });
    expect(grid.render().picker).toBeUndefined();
  });

  it('shows an empty option set and formula exclusions without allowing arbitrary values', () => {
    const grid = make({ dataValidations: rules(['=1', '=1']) });
    const picker = grid.open();
    expect(picker.props.values).toEqual([]);
    expect(picker.props.unsupportedFormulaCount).toBe(1);
    expect(picker.props.onChoose('=1')).toBe(false);
    expect(picker.props.onChoose('other')).toBe(false);
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    expect(grid.render().picker).toBeDefined();
  });

  it.each([
    { readOnly: true },
    { selection: { row: 0, col: 0, endRow: 1, endCol: 0 } },
    { selection: { row: 0, col: 0, endRow: 0, endCol: 1 } },
  ])('does not expose selection when interaction is unavailable: %j', (options) => {
    const grid = make({}, options);
    const rendered = grid.render();
    expect(rendered.trigger).toBeUndefined();
    rendered.region.props.onKeyDown(keyEvent('ArrowDown', { altKey: true }));
    expect(grid.render().picker).toBeUndefined();
  });

  it('has no trigger for paged sheets, absent list rules or hidden non-merged cells', () => {
    const grid = make({ dataSource: { kind: 'paged' } });
    expect(grid.render().trigger).toBeUndefined();
    expect(
      grid.render({ sheet: { ...grid.sheet, dataSource: undefined, dataValidations: [] } }).trigger,
    ).toBeUndefined();
    expect(
      grid.render({ sheet: { ...grid.sheet, dataSource: undefined, hiddenRows: [0] } }).trigger,
    ).toBeUndefined();
  });

  it('hides the trigger while filtering is pending and rejects a previously opened picker', () => {
    const grid = make();
    const oldPicker = grid.open();
    const pending = grid.render({ filter: 'pending query' });
    expect(pending.trigger).toBeUndefined();
    expect(pending.picker).toBeUndefined();
    expect(
      elements(pending.tree).some((node) => node.props.className === 'sheet-filter-status'),
    ).toBe(true);
    expect(oldPicker.props.onChoose(1)).toBe(false);
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    pending.region.props.onKeyDown(keyEvent('ArrowDown', { altKey: true }));
    expect(grid.render().picker).toBeUndefined();
  });

  it('closes an open picker and hides its trigger during F2 cell editing', () => {
    const grid = make();
    const oldPicker = grid.open();
    const event = keyEvent('F2');
    grid.render().region.props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    const editing = grid.render();
    expect(editing.trigger).toBeUndefined();
    expect(editing.picker).toBeUndefined();
    expect(
      elements(editing.tree).some((node) => node.props['aria-label'] === '编辑单元格 A1'),
    ).toBe(true);
    expect(oldPicker.props.onChoose(1)).toBe(false);
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    editing.region.props.onKeyDown(keyEvent('ArrowDown', { altKey: true }));
    expect(grid.render().picker).toBeUndefined();
  });

  it('commits to a merged region original anchor even when its row and column are hidden', () => {
    const grid = make(
      {
        hiddenRows: [0],
        hiddenColumns: [0],
        merges: [{ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } }],
        cells: { A1: { value: 'anchor', style: { bold: true } } },
        dataValidations: [
          { ...rules([1])[0], range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } } },
        ],
      },
      { selection: { row: 1, col: 1 } },
    );
    expect(grid.render().trigger?.props['aria-label']).toBe('选择 A1 的允许值');
    expect(grid.open().props.onChoose(1)).toBe(true);
    expect(grid.props.onPatch).toHaveBeenCalledExactlyOnceWith(
      grid.sheet.id,
      [{ key: 'A1', cell: { value: 1, style: { bold: true } } }],
      undefined,
    );
  });

  it('uses a later visible merge fragment when the frozen fragment is too short for the trigger', () => {
    const grid = make(
      {
        frozenRows: 1,
        rowHeights: { 0: 20 },
        merges: [{ start: { row: 0, col: 0 }, end: { row: 2, col: 0 } }],
        cells: { A1: { value: 'anchor', style: { italic: true } } },
      },
      { zoom: 50 },
    );
    expect(grid.render().trigger?.props['aria-label']).toBe('选择 A1 的允许值');
    expect(grid.open().props.onChoose(1)).toBe(true);
    expect(grid.props.onPatch).toHaveBeenCalledExactlyOnceWith(
      grid.sheet.id,
      [{ key: 'A1', cell: { value: 1, style: { italic: true } } }],
      undefined,
    );
  });

  it('invalidates the old choice synchronously in the scroll event before another render', () => {
    const grid = make();
    const oldPicker = grid.open();
    const current = grid.render();
    current.region.props.onScroll({ currentTarget: { scrollLeft: 0, scrollTop: 10 } });
    expect(oldPicker.props.onChoose(1)).toBe(false);
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    expect(grid.render().picker).toBeUndefined();
  });

  it.each([
    'rules',
    'selection',
    'scroll',
    'readOnly',
    'zoom',
    'layout',
    'workbook',
    'sheet',
    'cells',
    'same-id workbook load',
    'frozenRows',
    'calculationVersion',
    'renderVersion',
  ] as const)('invalidates a stale onChoose after %s changes', (reason) => {
    const grid = make();
    const oldPicker = grid.open();
    if (reason === 'rules') grid.render({ sheet: { ...grid.sheet, dataValidations: rules([1]) } });
    if (reason === 'selection') grid.render({ selection: { row: 1, col: 0 } });
    if (reason === 'scroll') {
      grid.render().region.props.onScroll({ currentTarget: { scrollLeft: 0, scrollTop: 10 } });
      grid.render();
    }
    if (reason === 'readOnly') grid.render({ readOnly: true });
    if (reason === 'zoom') grid.render({ zoom: 150 });
    if (reason === 'layout') grid.render({ sheet: { ...grid.sheet, rowHeights: { 0: 50 } } });
    if (reason === 'workbook') grid.render({ workbook: { ...grid.workbook } });
    if (reason === 'sheet') grid.render({ sheet: { ...grid.sheet } });
    if (reason === 'cells') {
      grid.sheet.cells = { A1: { value: 'new source' } };
      grid.render();
    }
    if (reason === 'same-id workbook load') {
      const loaded = structuredClone(grid.workbook);
      loaded.sheets[0].cells.A1 = { value: 'loaded' };
      expect(loaded.id).toBe(grid.workbook.id);
      expect(loaded.sheets[0].id).toBe(grid.sheet.id);
      grid.render({ workbook: loaded, sheet: loaded.sheets[0] });
    }
    if (reason === 'frozenRows') {
      grid.sheet.frozenRows = 1;
      grid.render();
    }
    if (reason === 'calculationVersion') grid.render({ calculationVersion: 1, renderVersion: 0 });
    if (reason === 'renderVersion') grid.render({ renderVersion: 1 });
    expect(grid.render().picker).toBeUndefined();
    expect(oldPicker.props.onChoose(1)).toBe(false);
    expect(grid.props.onPatch).not.toHaveBeenCalled();
  });

  it('rechecks membership at commit even if the rules array was mutated in place', () => {
    const grid = make();
    const picker = grid.open();
    const rule = grid.sheet.dataValidations![0];
    if (rule.kind !== 'list') throw new Error('Expected list');
    rule.values = [1];
    expect(picker.props.onChoose('1')).toBe(false);
    expect(grid.props.onPatch).not.toHaveBeenCalled();
    expect(picker.props.onChoose(1)).toBe(true);
  });

  it('uses the SDK edit transaction so typed choices support undo and redo', () => {
    class Host {
      className = '';
      classList = {
        add: (name: string) => {
          this.className += ` ${name}`;
        },
      };
    }
    vi.stubGlobal('HTMLElement', Host);
    const book = createBlankWorkbook();
    book.sheets[0].frozenRows = 0;
    book.sheets[0].cells.A1 = { value: 'old', style: { bold: true } };
    book.sheets[0].dataValidations = rules();
    const change = vi.fn();
    const sdk = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, {
      workbook: book,
      onChange: change,
    });
    try {
      const grid = make({}, sdk.surface().props);
      const before = sdk.getCell('A1');
      expect(grid.open().props.onChoose(false)).toBe(true);
      expect(sdk.getCell('A1')).toEqual({ value: false, style: { bold: true } });
      expect(change).toHaveBeenCalledOnce();
      sdk.undo();
      expect(sdk.getCell('A1')).toEqual(before);
      sdk.redo();
      expect(sdk.getCell('A1')).toEqual({ value: false, style: { bold: true } });
      expect(sdk.validateCell('A1')).toEqual([]);
    } finally {
      sdk.destroy();
    }
  });
});

describe('Canvas column sizing failures', () => {
  function sizing() {
    const grid = make({
      cells: { A1: { value: 'Wide', style: { fontSize: 24, bold: true, italic: true } } },
    });
    Object.assign(grid.viewport, {
      style: {},
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => false,
      releasePointerCapture: vi.fn(),
    });
    const context = {
      font: '',
      save: vi.fn(),
      restore: vi.fn(),
      measureText: vi.fn(() => ({ width: 160 })),
    };
    const view = grid.render();
    const canvas = elements(view.tree).find((node) => node.type === 'canvas')!;
    canvas.props.ref.current = { getContext: () => context };
    const event = (x: number) => ({
      clientX: x,
      clientY: 10,
      pointerId: 1,
      button: 0,
      buttons: 1,
      preventDefault: vi.fn(),
      currentTarget: grid.viewport,
    });
    return { grid, context, view, event };
  }

  it('measures plain text using its rendered font and keeps the source untouched', () => {
    const { grid, context, view, event } = sizing();
    view.region.props.onDoubleClick(event(139));
    expect(context.font).toContain('italic 650 24px');
    expect(context.restore).toHaveBeenCalledOnce();
    expect(grid.props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ columnWidths: { 0: 192 } }),
    );
    expect(grid.sheet.columnWidths).toEqual({});
  });

  it.each(['resize', 'auto-fit'])(
    'shows a rejected %s and clears the error on a successful retry',
    (kind) => {
      const { grid, view, event } = sizing();
      const failure = new Error('列宽保存失败，请重试');
      vi.mocked(grid.props.onChange).mockImplementationOnce(() => {
        throw failure;
      });
      const act = () => {
        if (kind === 'auto-fit') view.region.props.onDoubleClick(event(139));
        else {
          view.region.props.onPointerDown(event(139));
          view.region.props.onPointerMove(event(200));
          view.region.props.onPointerUp(event(200));
        }
      };
      expect(act).not.toThrow();
      expect(grid.render().notice?.props.children).toBe(failure.message);
      expect(grid.props.onEditError).toHaveBeenCalledWith(failure);
      expect(grid.sheet.columnWidths).toEqual({});
      act();
      expect(grid.render().notice).toBeUndefined();
      expect(grid.props.onChange).toHaveBeenCalledTimes(2);
    },
  );

  it('restores Canvas state on measurement failure without submitting a partial width', () => {
    const { grid, context, view, event } = sizing();
    context.measureText.mockImplementationOnce(() => {
      throw new Error('测量失败');
    });
    expect(() => view.region.props.onDoubleClick(event(139))).not.toThrow();
    expect(context.restore).toHaveBeenCalledOnce();
    expect(grid.props.onChange).not.toHaveBeenCalled();
    expect(grid.render().notice?.props.children).toBe('测量失败');
    view.region.props.onDoubleClick(event(139));
    expect(grid.props.onChange).toHaveBeenCalledOnce();
  });
});

describe('grid history shortcuts', () => {
  it.each(['ctrlKey', 'metaKey'])(
    'routes %s history keys and stops host duplicate handling',
    (modifier) => {
      const onUndo = vi.fn(),
        onRedo = vi.fn();
      const grid = make({}, { onUndo, onRedo });
      for (const [key, shiftKey] of [
        ['z', false],
        ['Z', true],
        ['y', false],
      ] as const) {
        const event = keyEvent(key, { [modifier]: true, shiftKey, stopPropagation: vi.fn() });
        grid.render().region.props.onKeyDown(event);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect((event as any).stopPropagation).toHaveBeenCalledOnce();
      }
      expect(onUndo).toHaveBeenCalledOnce();
      expect(onRedo).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['editor', 'readonly', 'composing', 'prevented', 'alt'])(
    'does not dispatch workbook history for %s events',
    (condition) => {
      const onUndo = vi.fn();
      const grid = make({}, { onUndo, readOnly: condition === 'readonly' });
      if (condition === 'editor') grid.render().region.props.onKeyDown(keyEvent('F2'));
      const event = keyEvent('z', {
        ctrlKey: true,
        altKey: condition === 'alt',
        defaultPrevented: condition === 'prevented',
        nativeEvent: { isComposing: condition === 'composing' },
        stopPropagation: vi.fn(),
      });
      grid.render().region.props.onKeyDown(event);
      expect(onUndo).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    },
  );

  it('reports history failures and permits retry', () => {
    const onUndo = vi.fn().mockImplementationOnce(() => {
      throw new Error('撤销失败');
    });
    const grid = make({}, { onUndo });
    const event = () => keyEvent('z', { ctrlKey: true, stopPropagation: vi.fn() });
    grid.render().region.props.onKeyDown(event());
    expect(grid.render().notice?.props.children).toBe('撤销失败');
    expect(grid.props.onEditError).toHaveBeenCalledOnce();
    grid.render().region.props.onKeyDown(event());
    expect(onUndo).toHaveBeenCalledTimes(2);
  });

  it('connects real SDK history to only its own live sheet view', () => {
    class Host {
      className = '';
      classList = { add: vi.fn() };
    }
    vi.stubGlobal('HTMLElement', Host);
    const a = new LuminaSpreadsheet(new Host() as unknown as HTMLElement);
    const b = new LuminaSpreadsheet(new Host() as unknown as HTMLElement);
    try {
      a.setCell('A1', 'first');
      a.setCell('A1', 'second');
      b.setCell('A1', 'independent');
      const grid = make({}, a.surface().props);
      grid
        .render()
        .region.props.onKeyDown(keyEvent('z', { ctrlKey: true, stopPropagation: vi.fn() }));
      expect(a.getValue('A1')).toBe('first');
      grid
        .render(a.surface().props)
        .region.props.onKeyDown(keyEvent('y', { ctrlKey: true, stopPropagation: vi.fn() }));
      expect(a.getValue('A1')).toBe('second');
      expect(b.getValue('A1')).toBe('independent');
      const old = a.surface();
      a.load(a.toJSON());
      a.setCell('A1', 'replacement');
      old.props.onUndo();
      expect(a.getValue('A1')).toBe('replacement');
      const stale = a.surface();
      a.destroy();
      expect(() => stale.props.onUndo()).not.toThrow();
    } finally {
      a.destroy();
      b.destroy();
    }
  });
});
