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
import HyperlinkDialog from '../src/components/HyperlinkDialog';
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Record<string, any>>(node) ? [node, ...elements(node.props.children)] : [];
}
function make(cell?: Cell) {
  const onApply = vi.fn(),
    onClose = vi.fn();
  const render = () => {
    hooks.cursor = 0;
    return elements(HyperlinkDialog({ address: 'A1', cell, onApply, onClose }));
  };
  return {
    onApply,
    onClose,
    render,
    change: (label: string, value: string) =>
      render()
        .find((node) => node.props['aria-label'] === label)!
        .props.onChange({ target: { value } }),
    submit: () =>
      render()
        .find((node) => node.type === 'form')!
        .props.onSubmit({ preventDefault() {} }),
    click: (label: string) =>
      render()
        .find((node) => node.type === 'button' && node.props.children === label)!
        .props.onClick(),
    error: () => render().find((node) => node.props.role === 'alert')?.props.children,
  };
}
beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
});
describe('hyperlink dialog', () => {
  it('uses the saved target for the external link even while editing a draft', () => {
    const view = make({ value: 'source', hyperlink: { target: 'https://example.com/saved' } });
    view.change('链接目标地址', 'https://example.com/draft');
    const link = view.render().find((node) => node.type === 'a')!;
    expect(link.props.href).toBe('https://example.com/saved');
    expect(link.props.target).toBe('_blank');
    expect(link.props.rel).toBe('noopener noreferrer');
    expect(view.onApply).not.toHaveBeenCalled();
  });
  it('does not render executable destinations as anchors', () => {
    const view = make({ value: 'source', hyperlink: { target: 'javascript:alert(1)' } });
    expect(view.render().some((node) => node.type === 'a')).toBe(false);
  });
  it('saves text, target and tooltip together while preserving styles', () => {
    const cell: Cell = { value: 'old', style: { bold: true } };
    const view = make(cell);
    view.change('链接显示文字', 'details');
    view.change('链接目标地址', 'https://example.com');
    view.change('链接提示文字', 'source');
    expect(view.onApply).not.toHaveBeenCalled();
    view.submit();
    expect(view.onApply).toHaveBeenCalledWith({
      value: 'details',
      style: { bold: true },
      hyperlink: { target: 'https://example.com', tooltip: 'source' },
    });
    expect(cell.value).toBe('old');
  });
  it('keeps invalid drafts and shows errors from validation or the workspace', () => {
    const view = make({ value: 'text' });
    view.submit();
    expect(view.error()).toContain('无效');
    expect(view.onApply).not.toHaveBeenCalled();
    view.change('链接目标地址', '#Data!A1');
    view.onApply.mockImplementationOnce(() => {
      throw new Error('保存失败');
    });
    view.submit();
    expect(view.error()).toBe('保存失败');
    view.submit();
    expect(view.onApply).toHaveBeenLastCalledWith({
      value: 'text',
      hyperlink: { target: '#Data!A1' },
    });
  });
  it('removes only metadata and cancels without applying draft changes', () => {
    const view = make({
      value: 'original',
      style: { italic: true },
      hyperlink: { target: 'https://example.com' },
    });
    view.change('链接显示文字', 'uncommitted');
    view.click('移除链接');
    expect(view.onApply).toHaveBeenCalledWith({ value: 'original', style: { italic: true } });
    view.onApply.mockClear();
    view.click('取消');
    expect(view.onClose).toHaveBeenCalledOnce();
    expect(view.onApply).not.toHaveBeenCalled();
  });
  it.each([42, true, '=1+2'])('does not implicitly replace non-text value %s', (value) => {
    const view = make({ value });
    view.change('链接目标地址', 'https://example.com');
    view.submit();
    expect(view.error()).toContain('普通文本');
    expect(view.onApply).not.toHaveBeenCalled();
  });
});
