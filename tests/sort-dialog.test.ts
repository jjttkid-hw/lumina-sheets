import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Sheet } from '../src/lib/types';

// Exercise the dialog's real synchronous field and submit handlers while leaving
// browser focus/keyboard behavior to the integration smoke check.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  refs: [] as Array<{ current: unknown }>,
  refCursor: 0,
  effectDependencies: [] as Array<readonly unknown[]>,
  effectCursor: 0,
  pendingEffects: [] as Array<() => void>,
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (index >= hooks.states.length)
        hooks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [
        hooks.states[index],
        (value: unknown) => {
          hooks.states[index] = typeof value === 'function' ? value(hooks.states[index]) : value;
        },
      ];
    },
    useRef: (initial: unknown) => (hooks.refs[hooks.refCursor++] ??= { current: initial }),
    useEffect: (effect: () => void, dependencies: readonly unknown[]) => {
      const index = hooks.effectCursor++;
      const previous = hooks.effectDependencies[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        hooks.effectDependencies[index] = dependencies;
        hooks.pendingEffects.push(effect);
      }
    },
    useMemo: (factory: () => unknown) => factory(),
    useId: () => 'sort-dialog-test',
  };
});
import SortDialog from '../src/components/SortDialog';
import type { SortDialogProps } from '../src/components/SortDialog';

type Props = Record<string, any>;
type Element = ReactElement<Props>;

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function content(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(content).join('');
  if (isValidElement<Props>(node)) return content(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
function make(sheetValues: Partial<Sheet> = {}, options: Partial<SortDialogProps> = {}) {
  const sheet: Sheet = {
    id: 'sheet',
    name: 'Sheet',
    rowCount: 20,
    colCount: 4,
    cells: {},
    ...sheetValues,
  };
  const onSort = vi.fn();
  const onClose = vi.fn();
  const scrollIntoView = vi.fn();
  const props: SortDialogProps = {
    sheet,
    selection: { row: 1, col: 1, endRow: 5, endCol: 2 },
    direction: 'asc',
    onSort,
    onClose,
    ...options,
  };
  const render = (): Element => {
    hooks.cursor = 0;
    hooks.refCursor = 0;
    hooks.effectCursor = 0;
    const result = SortDialog(props);
    const alertElement = elements(result).find((element) => element.props.role === 'alert');
    if (alertElement) alertElement.props.ref.current = { scrollIntoView };
    for (const effect of hooks.pendingEffects.splice(0)) effect();
    return result;
  };
  const field = (label: string) => {
    const wrapper = elements(render()).find(
      (element) => element.type === 'label' && content(element.props.children).startsWith(label),
    );
    if (!wrapper) throw new Error(`Missing field: ${label}`);
    return elements(wrapper).find((element) => ['input', 'select'].includes(String(element.type)))!;
  };
  const change = (label: string, value: string | boolean) => {
    field(label).props.onChange({
      target: typeof value === 'boolean' ? { checked: value } : { value },
    });
  };
  const submit = () => {
    const event = { preventDefault: vi.fn() };
    elements(render())
      .find((element) => element.type === 'form')!
      .props.onSubmit(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  };
  const alert = () => {
    const element = elements(render()).find((element) => element.props.role === 'alert');
    return element ? content(element) : null;
  };
  return { render, field, change, submit, alert, onSort, onClose, scrollIntoView };
}

beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
  hooks.refs = [];
  hooks.refCursor = 0;
  hooks.effectDependencies = [];
  hooks.effectCursor = 0;
  hooks.pendingEffects = [];
});

describe('SortDialog handlers', () => {
  it('normalizes a reverse selection and converts displayed rows to a zero-based request', () => {
    const dialog = make({}, { selection: { row: 5, col: 2, endRow: 1 }, direction: 'desc' });
    expect(dialog.field('起始行').props.value).toBe('2');
    expect(dialog.field('结束行').props.value).toBe('6');
    expect(dialog.field('次要方向').props.disabled).toBe(true);
    dialog.submit();
    expect(dialog.onSort).toHaveBeenCalledExactlyOnceWith({
      startRow: 1,
      rowCount: 5,
      keys: [{ column: 2, direction: 'desc' }],
      includeHidden: false,
    });
    expect(dialog.onClose).not.toHaveBeenCalled();
    expect(dialog.alert()).toBeNull();
  });

  it('submits edited bounds, two independent keys, and the hidden-row option', () => {
    const dialog = make({ hiddenRows: [0, 4, 5, 19] });
    dialog.change('起始行', '4');
    dialog.change('结束行', '9');
    dialog.change('主要列', '3');
    dialog.change('主要方向', 'desc');
    dialog.change('次要列', '0');
    dialog.change('次要方向', 'asc');
    expect(dialog.field('次要方向').props.disabled).toBe(false);
    expect(content(dialog.render())).toContain('本范围内跳过 2 行');
    dialog.change('包含隐藏行', true);
    dialog.submit();
    expect(dialog.onSort).toHaveBeenCalledExactlyOnceWith({
      startRow: 3,
      rowCount: 6,
      keys: [
        { column: 3, direction: 'desc' },
        { column: 0, direction: 'asc' },
      ],
      includeHidden: true,
    });
    expect(content(dialog.render())).toContain('隐藏行也参与排序，隐藏位置保持不变');
  });

  it.each([
    ['blank', '', '6'],
    ['fractional', '2.5', '6'],
    ['zero', '0', '6'],
    ['reversed', '7', '6'],
    ['past the sheet', '2', '21'],
  ])('rejects a %s range without sorting or closing', (_reason, start, end) => {
    const dialog = make();
    dialog.change('起始行', start);
    dialog.change('结束行', end);
    dialog.submit();
    expect(dialog.alert()).toContain('请输入有效的起始行和结束行');
    expect(dialog.onSort).not.toHaveBeenCalled();
    expect(dialog.onClose).not.toHaveBeenCalled();
  });

  it('preserves a single-row selection and asks the user to expand it', () => {
    const dialog = make({}, { selection: { row: 3, col: 0 } });
    expect(dialog.field('起始行').props.value).toBe('4');
    expect(dialog.field('结束行').props.value).toBe('4');
    dialog.submit();
    expect(dialog.alert()).toContain('至少选择两行');
    expect(dialog.onSort).not.toHaveBeenCalled();
  });

  it('rejects ranges beyond the sort limit', () => {
    const dialog = make({ rowCount: 200_000 });
    dialog.change('起始行', '2');
    dialog.change('结束行', '100002');
    dialog.submit();
    expect(dialog.alert()).toContain('单次最多排序 100,000 行');
    expect(dialog.onSort).not.toHaveBeenCalled();
  });

  it('rejects frozen rows and accepts the first unfrozen row after correction', () => {
    const dialog = make({ frozenRows: 2 });
    dialog.submit();
    expect(dialog.alert()).toContain('前 2 行已冻结');
    expect(dialog.onSort).not.toHaveBeenCalled();
    dialog.change('起始行', '3');
    expect(dialog.alert()).toBeNull();
    dialog.submit();
    expect(dialog.onSort).toHaveBeenCalledExactlyOnceWith({
      startRow: 2,
      rowCount: 4,
      keys: [{ column: 1, direction: 'asc' }],
      includeHidden: false,
    });
  });

  it('rejects duplicate keys and allows the secondary key to be removed', () => {
    const dialog = make();
    dialog.change('次要列', '1');
    dialog.submit();
    expect(dialog.alert()).toBe('主要列与次要列不能相同。');
    expect(dialog.onSort).not.toHaveBeenCalled();
    dialog.change('次要列', '');
    dialog.submit();
    expect(dialog.onSort.mock.calls[0][0].keys).toEqual([{ column: 1, direction: 'asc' }]);
  });

  it('keeps a thrown sort failure visible and permits editing and retrying', () => {
    const dialog = make();
    dialog.onSort.mockImplementationOnce(() => {
      throw new Error('排序行范围包含合并区域，请先取消合并');
    });
    dialog.submit();
    expect(dialog.alert()).toBe('排序行范围包含合并区域，请先取消合并');
    expect(dialog.onClose).not.toHaveBeenCalled();
    dialog.change('起始行', '3');
    expect(dialog.alert()).toBeNull();
    dialog.submit();
    expect(dialog.onSort).toHaveBeenCalledTimes(2);
    expect(dialog.onSort.mock.calls[1][0]).toMatchObject({ startRow: 2, rowCount: 4 });
    expect(dialog.alert()).toBeNull();
    expect(dialog.onClose).not.toHaveBeenCalled();
  });

  it('reveals a new error without scrolling on ordinary edits or unchanged rerenders', () => {
    const dialog = make();
    dialog.change('起始行', '7');
    dialog.render();
    expect(dialog.scrollIntoView).not.toHaveBeenCalled();
    dialog.submit();
    expect(dialog.alert()).toContain('请输入有效的起始行和结束行');
    expect(dialog.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'center' });
    dialog.render();
    expect(dialog.scrollIntoView).toHaveBeenCalledTimes(1);
    dialog.change('起始行', '6');
    expect(dialog.alert()).toBeNull();
    expect(dialog.scrollIntoView).toHaveBeenCalledTimes(1);
    dialog.submit();
    expect(dialog.alert()).toContain('至少选择两行');
    expect(dialog.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(dialog.onClose).not.toHaveBeenCalled();
  });

  it('closes only when the cancel action is selected', () => {
    const dialog = make();
    const cancel = elements(dialog.render()).find(
      (element) => element.type === 'button' && content(element) === '取消',
    )!;
    cancel.props.onClick();
    expect(dialog.onClose).toHaveBeenCalledOnce();
    expect(dialog.onSort).not.toHaveBeenCalled();
  });
});
