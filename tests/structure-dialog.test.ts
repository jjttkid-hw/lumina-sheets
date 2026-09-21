import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
const hooks = vi.hoisted(() => ({ states: [] as any[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.states)) hooks.states[i] = initial;
    return [
      hooks.states[i],
      (value: unknown) => {
        hooks.states[i] = value;
      },
    ];
  },
}));
import StructureDialog from '../src/components/StructureDialog';
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Record<string, any>>(node) ? [node, ...elements(node.props.children)] : [];
}
function make() {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const render = () => {
    hooks.cursor = 0;
    return elements(
      StructureDialog({
        sheet: { id: 's', name: '数据', cells: {}, rowCount: 20, colCount: 8 },
        selection: { row: 5, endRow: 2, col: 3, endCol: 1 },
        onApply,
        onClose,
      }),
    );
  };
  const field = (label: string) => render().find((node) => node.props['aria-label'] === label)!;
  return {
    onApply,
    onClose,
    render,
    field,
    change: (label: string, value: string) => field(label).props.onChange({ target: { value } }),
    submit: () =>
      render()
        .find((node) => node.type === 'form')!
        .props.onSubmit({ preventDefault() {} }),
    alert: () => render().find((node) => node.props.role === 'alert')?.props.children,
  };
}
beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
});
describe('structure dialog handlers', () => {
  it('uses reversed selections and switches to the selected columns', () => {
    const dialog = make();
    dialog.submit();
    expect(dialog.onApply).toHaveBeenLastCalledWith({
      axis: 'row',
      kind: 'insert',
      index: 2,
      count: 4,
    });
    dialog.change('行列方向', 'column');
    dialog.change('行列操作', 'delete');
    dialog.submit();
    expect(dialog.onApply).toHaveBeenLastCalledWith({
      axis: 'column',
      kind: 'delete',
      index: 1,
      count: 3,
    });
  });
  it.each(['0', '-1', '1.5', '1e2', '', '9007199254740993'])(
    'rejects invalid count %s without committing',
    (value) => {
      const dialog = make();
      dialog.change('行列数量', value);
      dialog.submit();
      expect(dialog.alert()).toBeTruthy();
      expect(dialog.onApply).not.toHaveBeenCalled();
    },
  );
  it('permits append but rejects deletion beyond the end and deletion of all rows', () => {
    const dialog = make();
    dialog.change('行列起始位置', '21');
    dialog.change('行列数量', '1');
    dialog.submit();
    expect(dialog.onApply).toHaveBeenCalledOnce();
    dialog.change('行列操作', 'delete');
    dialog.submit();
    expect(dialog.alert()).toContain('超出');
    dialog.change('行列起始位置', '1');
    dialog.change('行列数量', '20');
    dialog.submit();
    expect(dialog.alert()).toContain('至少保留');
    expect(dialog.onApply).toHaveBeenCalledOnce();
  });
  it('keeps backend validation errors visible and permits correction or cancellation', () => {
    const dialog = make();
    dialog.onApply.mockImplementationOnce(() => {
      throw new Error('超过容量');
    });
    dialog.submit();
    expect(dialog.alert()).toBe('超过容量');
    expect(dialog.onClose).not.toHaveBeenCalled();
    dialog.change('行列数量', '1');
    expect(dialog.alert()).toBeUndefined();
    dialog.submit();
    expect(dialog.onApply).toHaveBeenCalledTimes(2);
    dialog
      .render()
      .find((node) => node.type === 'button' && node.props.type === 'button')!
      .props.onClick();
    expect(dialog.onClose).toHaveBeenCalledOnce();
  });
});
