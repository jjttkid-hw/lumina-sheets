import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactNode, ReactElement } from 'react';
import type { Cell } from '../src/lib/types';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [
      hooks.states[index],
      (value: unknown) => {
        hooks.states[index] = value;
      },
    ];
  },
}));
import RichTextDialog from '../src/components/RichTextDialog';
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Record<string, any>>(node) ? [node, ...elements(node.props.children)] : [];
}

function make(cell: Cell) {
  const onApply = vi.fn(),
    onClose = vi.fn();
  const render = () => {
    hooks.cursor = 0;
    return elements(RichTextDialog({ address: 'A1', cell, onApply, onClose }));
  };
  const field = (label: string) => render().find((node) => node.props['aria-label'] === label)!;
  return {
    onApply,
    onClose,
    render,
    select: (start: number, end: number) =>
      field('选择局部格式文字').props.onSelect({
        currentTarget: { selectionStart: start, selectionEnd: end },
      }),
    change: (label: string, value: string) => field(label).props.onChange({ target: { value } }),
    click: (label: string) =>
      render()
        .find((node) => node.type === 'button' && node.props.children === label)!
        .props.onClick(),
    submit: () =>
      render()
        .find((node) => node.type === 'form')!
        .props.onSubmit({ preventDefault() {} }),
    error: () => render().find((node) => node.props.role === 'alert')?.props.children,
  };
}
beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
});
describe('rich text format dialog', () => {
  it('previews formatting in an isolated draft then saves once, preserving the selection for multiple actions', () => {
    const cell: Cell = { value: 'abcdef', hyperlink: { target: '#A1' } };
    const view = make(cell);
    expect(view.render().find((node) => node.type === 'fieldset')?.props.disabled).toBe(true);
    view.select(1, 4);
    view.change('所选文字粗体', 'on');
    view.change('局部文字颜色', '#123456');
    view.click('应用颜色');
    expect(view.onApply).not.toHaveBeenCalled();
    expect(cell.richText).toBeUndefined();
    const spans = view.render().filter((node) => node.type === 'span');
    expect(spans.find((node) => node.props.children === 'bcd')?.props.style).toMatchObject({
      fontWeight: 'bold',
      color: '#123456',
    });
    view.submit();
    expect(view.onApply).toHaveBeenCalledWith({
      ...cell,
      richText: [
        { text: 'a' },
        { text: 'bcd', style: { bold: true, color: '#123456' } },
        { text: 'ef' },
      ],
    });
  });
  it('retains the draft when formatting or save fails, supports retry, and cancels without commit', () => {
    const view = make({ value: 'abc' });
    view.click('应用颜色');
    expect(view.error()).toContain('选中');
    view.select(0, 3);
    view.change('局部文字字号', '1000');
    view.click('应用字号');
    expect(view.error()).toContain('字号');
    view.change('局部文字字号', '20');
    view.click('应用字号');
    view.onApply.mockImplementationOnce(() => {
      throw new Error('工作空间已变化');
    });
    view.submit();
    expect(view.error()).toBe('工作空间已变化');
    view.submit();
    expect(view.onApply).toHaveBeenLastCalledWith({
      value: 'abc',
      richText: [{ text: 'abc', style: { fontSize: 20 } }],
    });
    view.onApply.mockClear();
    view.click('取消');
    expect(view.onClose).toHaveBeenCalledOnce();
    expect(view.onApply).not.toHaveBeenCalled();
  });
  it('previews and saves superscript, then explicitly restores baseline without dropping metadata', () => {
    const view = make({
      value: 'x2',
      richText: [{ text: 'x' }, { text: '2', style: { fontSize: 20, charset: 134 } }],
    });
    view.select(1, 2);
    view.change('所选文字上下标', 'superscript');
    let span = view.render().find((node) => node.type === 'span' && node.props.children === '2')!;
    expect(span.props.style).toMatchObject({ fontSize: 13, top: -6 });
    view.submit();
    expect(view.onApply.mock.calls[0][0].richText[1].style).toEqual({
      fontSize: 20,
      charset: 134,
      verticalAlign: 'superscript',
    });
    view.change('所选文字上下标', 'baseline');
    span = view.render().find((node) => node.type === 'span' && node.props.children === '2')!;
    expect(span.props.style).toMatchObject({ fontSize: 20, top: 0 });
    view.submit();
    expect(view.onApply.mock.calls[1][0].richText[1].style.charset).toBe(134);
  });
  it('restores inherited styles and refuses formula formatting', () => {
    const view = make({
      value: 'abc',
      style: { bold: true },
      richText: [{ text: 'abc', style: { bold: false } }],
    });
    view.select(0, 3);
    view.click('恢复单元格样式');
    view.submit();
    expect(view.onApply).toHaveBeenCalledWith({ value: 'abc', style: { bold: true } });
    hooks.states = [];
    const invalid = make({ value: '=1' });
    invalid.submit();
    expect(invalid.error()).toContain('普通文本');
    expect(invalid.onApply).not.toHaveBeenCalled();
  });
});
