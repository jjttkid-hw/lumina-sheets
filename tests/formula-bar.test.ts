import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

// Render real JSX and handlers with persistent hook slots. DOM focus behavior is
// represented by a synchronous blur event, matching the browser event ordering.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  refs: [] as Array<{ current: unknown }>,
  refCursor: 0,
  needsRender: false,
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
          const next = typeof value === 'function' ? value(hooks.states[index]) : value;
          if (!Object.is(next, hooks.states[index])) hooks.needsRender = true;
          hooks.states[index] = next;
        },
      ];
    },
    useRef: (initial: unknown) => (hooks.refs[hooks.refCursor++] ??= { current: initial }),
    useId: () => 'formula-bar-test',
  };
});
import FormulaBar from '../src/components/FormulaBar';
import type { FormulaBarProps } from '../src/components/FormulaBar';

type Props = Record<string, any>;
type Element = ReactElement<Props>;

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function make(options: Partial<FormulaBarProps> = {}) {
  const onCommit = vi.fn();
  const onAddressChange = vi.fn();
  const onAddressSubmit = vi.fn();
  let props: FormulaBarProps = {
    address: 'A1',
    value: 'saved',
    cellId: 'book/sheet/A1',
    onCommit,
    onAddressChange,
    onAddressSubmit,
    ...options,
  };
  const render = (): Element => {
    let result: Element;
    let count = 0;
    do {
      hooks.cursor = 0;
      hooks.refCursor = 0;
      hooks.needsRender = false;
      result = FormulaBar(props);
      if (++count > 5) throw new Error('FormulaBar did not settle');
    } while (hooks.needsRender);
    return result;
  };
  const input = (label = '公式编辑栏') =>
    elements(render()).find((element) => element.props['aria-label'] === label)!;
  const alert = () => elements(render()).find((element) => element.props.role === 'alert');
  const change = (value: string) => input().props.onChange({ target: { value } });
  const blur = vi.fn(() => input().props.onBlur());
  const keyboard = (key: string, nativeEvent: Props = {}) => ({
    key,
    nativeEvent,
    currentTarget: { blur },
    preventDefault: vi.fn(),
  });
  const press = (key: string, nativeEvent: Props = {}) => {
    const event = keyboard(key, nativeEvent);
    input().props.onKeyDown(event);
    return event;
  };
  const rerender = (next: Partial<FormulaBarProps>) => {
    props = { ...props, ...next };
    return render();
  };
  return {
    render,
    input,
    alert,
    change,
    press,
    blur,
    keyboard,
    rerender,
    onCommit,
    onAddressChange,
    onAddressSubmit,
  };
}

beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
  hooks.refs = [];
  hooks.refCursor = 0;
  hooks.needsRender = false;
});

describe('FormulaBar handlers', () => {
  it('keeps edits local until Enter and commits once across its synchronous blur', () => {
    const bar = make({ value: '=SUM(A2:A4)' });
    expect(bar.input().props.value).toBe('=SUM(A2:A4)');
    bar.change('=SUM(A2:A5)');
    expect(bar.input().props.value).toBe('=SUM(A2:A5)');
    expect(bar.onCommit).not.toHaveBeenCalled();
    expect(bar.press('Enter').preventDefault).toHaveBeenCalledOnce();
    expect(bar.onCommit).toHaveBeenCalledExactlyOnceWith('=SUM(A2:A5)');
    expect(bar.blur).toHaveBeenCalledOnce();
    expect(bar.alert()).toBeUndefined();
  });

  it('does not commit unchanged input on blur or Enter', () => {
    const bar = make();
    bar.input().props.onBlur();
    bar.press('Enter');
    expect(bar.onCommit).not.toHaveBeenCalled();
    expect(bar.blur).toHaveBeenCalledOnce();
  });

  it('commits the latest change during blur even before another render', () => {
    const bar = make();
    const input = bar.input();
    input.props.onChange({ target: { value: 'latest draft' } });
    input.props.onBlur();
    expect(bar.onCommit).toHaveBeenCalledExactlyOnceWith('latest draft');
  });

  it('preserves a rejected Enter draft and its focus, links the error, and allows retry', () => {
    const bar = make();
    bar.onCommit.mockImplementationOnce(() => {
      throw new Error('必须输入数字');
    });
    bar.change('invalid');
    bar.press('Enter');
    expect(bar.blur).not.toHaveBeenCalled();
    expect(bar.input().props.value).toBe('invalid');
    expect(bar.input().props['aria-invalid']).toBe(true);
    expect(bar.input().props['aria-describedby']).toBe(bar.alert()?.props.id);
    expect(bar.alert()?.props.children).toBe('必须输入数字');
    bar.change('42');
    expect(bar.alert()).toBeUndefined();
    expect(bar.input().props['aria-invalid']).toBeUndefined();
    expect(bar.input().props['aria-describedby']).toBeUndefined();
    bar.press('Enter');
    expect(bar.onCommit.mock.calls).toEqual([['invalid'], ['42']]);
    expect(bar.blur).toHaveBeenCalledOnce();
  });

  it('restores the stored value after blur rejection and does not submit the rejected draft later', () => {
    const bar = make();
    bar.onCommit.mockImplementationOnce(() => {
      throw new Error('必须输入数字');
    });
    bar.change('rejected');
    bar.input().props.onBlur();
    expect(bar.input().props.value).toBe('saved');
    expect(bar.alert()?.props.children).toBe('必须输入数字');
    bar.rerender({ cellId: 'book/sheet/B1', address: 'B1', value: 'next saved' });
    expect(bar.input().props.value).toBe('next saved');
    expect(bar.alert()).toBeUndefined();
    bar.input().props.onBlur();
    expect(bar.onCommit).toHaveBeenCalledExactlyOnceWith('rejected');
  });

  it('cancels a rejected draft with Escape and never retries during the resulting blur', () => {
    const bar = make();
    bar.onCommit.mockImplementation(() => {
      throw new Error('拒绝保存');
    });
    bar.change('invalid');
    bar.press('Enter');
    expect(bar.press('Escape').preventDefault).toHaveBeenCalledOnce();
    expect(bar.input().props.value).toBe('saved');
    expect(bar.alert()).toBeUndefined();
    expect(bar.onCommit).toHaveBeenCalledExactlyOnceWith('invalid');
    expect(bar.blur).toHaveBeenCalledOnce();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'does not submit or blur Enter while the native event indicates IME composition: %j',
    (nativeEvent) => {
      const bar = make();
      bar.change('拼音草稿');
      expect(bar.press('Enter', nativeEvent).preventDefault).not.toHaveBeenCalled();
      expect(bar.onCommit).not.toHaveBeenCalled();
      expect(bar.blur).not.toHaveBeenCalled();
      expect(bar.input().props.value).toBe('拼音草稿');
    },
  );

  it('tracks composition events and only submits after composition ends', () => {
    const bar = make();
    bar.input().props.onCompositionStart();
    bar.change('中文');
    bar.press('Enter');
    bar.press('Escape');
    expect(bar.onCommit).not.toHaveBeenCalled();
    expect(bar.blur).not.toHaveBeenCalled();
    bar.input().props.onCompositionEnd();
    bar.press('Enter');
    expect(bar.onCommit).toHaveBeenCalledExactlyOnceWith('中文');
  });

  it('discards a prior cell draft and rejects late blur/change handlers after the selection changes', () => {
    const bar = make();
    bar.change('old draft');
    const oldInput = bar.input();
    const nextCommit = vi.fn();
    bar.rerender({
      cellId: 'book/sheet/B1',
      address: 'B1',
      value: 'next saved',
      onCommit: nextCommit,
    });
    oldInput.props.onBlur();
    oldInput.props.onChange({ target: { value: 'late old draft' } });
    oldInput.props.onKeyDown(bar.keyboard('Enter'));
    bar.input().props.onBlur();
    expect(bar.input().props.value).toBe('next saved');
    expect(bar.onCommit).not.toHaveBeenCalled();
    expect(nextCommit).not.toHaveBeenCalled();
    bar.change('new draft');
    bar.press('Enter');
    expect(nextCommit).toHaveBeenCalledExactlyOnceWith('new draft');
  });

  it('resets an error when the selected cell changes even if the stored values match', () => {
    const bar = make();
    bar.onCommit.mockImplementation(() => {
      throw new Error('无效');
    });
    bar.change('bad');
    bar.press('Enter');
    bar.rerender({ cellId: 'book/other-sheet/A1' });
    expect(bar.input().props.value).toBe('saved');
    expect(bar.alert()).toBeUndefined();
  });

  it('synchronizes an external stored-value update and does not replay a superseded blur', () => {
    const bar = make();
    bar.change('draft');
    const oldInput = bar.input();
    bar.rerender({ value: 'updated outside' });
    expect(bar.input().props.value).toBe('updated outside');
    oldInput.props.onBlur();
    expect(bar.onCommit).not.toHaveBeenCalled();
  });

  it('clears Enter blur suppression before a later editing session', () => {
    const bar = make();
    bar.change('first');
    bar.press('Enter');
    bar.rerender({ value: 'first' });
    bar.input().props.onFocus();
    bar.change('second');
    bar.input().props.onBlur();
    expect(bar.onCommit.mock.calls).toEqual([['first'], ['second']]);
  });

  it('uses a useful fallback when the commit throws a non-Error value', () => {
    const bar = make();
    bar.onCommit.mockImplementation(() => {
      throw null;
    });
    bar.change('changed');
    bar.press('Enter');
    expect(bar.alert()?.props.children).toBe('未能保存，请检查输入内容。');
    expect(bar.blur).not.toHaveBeenCalled();
  });

  it('forwards address editing and non-composing Enter independently from the formula draft', () => {
    const bar = make({ placeholder: '输入公式' });
    expect(bar.input().props.placeholder).toBe('输入公式');
    const address = bar.input('单元格地址');
    expect(address.props.value).toBe('A1');
    address.props.onChange({ target: { value: 'D2' } });
    address.props.onKeyDown(bar.keyboard('Enter', { isComposing: true }));
    expect(bar.onAddressSubmit).not.toHaveBeenCalled();
    const event = bar.keyboard('Enter');
    address.props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(bar.onAddressChange).toHaveBeenCalledExactlyOnceWith('D2');
    expect(bar.onAddressSubmit).toHaveBeenCalledOnce();
    expect(bar.onCommit).not.toHaveBeenCalled();
  });
});
