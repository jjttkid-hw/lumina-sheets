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
  effects: [] as Array<{
    deps?: unknown[];
    pending?: () => void | (() => void);
    cleanup?: () => void;
  }>,
  effectCursor: 0,
  rendering: false,
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
    useLayoutEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const index = hooks.effectCursor++;
      const previous = hooks.effects[index];
      if (!previous || !deps || !previous.deps || deps.some((v, i) => v !== previous.deps![i]))
        hooks.effects[index] = { deps, pending: effect, cleanup: previous?.cleanup };
    },
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
      hooks.effectCursor = 0;
      hooks.needsRender = false;
      hooks.rendering = true;
      result = FormulaBar(props);
      hooks.rendering = false;
      if (++count > 5) throw new Error('FormulaBar did not settle');
    } while (hooks.needsRender);
    for (const slot of hooks.effects) {
      if (!slot.pending) continue;
      slot.cleanup?.();
      slot.cleanup = slot.pending() || undefined;
      slot.pending = undefined;
    }
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
    unmount: () => hooks.effects.forEach((slot) => slot.cleanup?.()),
  };
}

beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
  hooks.refs = [];
  hooks.refCursor = 0;
  hooks.needsRender = false;
  hooks.effects = [];
  hooks.effectCursor = 0;
  hooks.rendering = false;
});

describe('FormulaBar handlers', () => {
  it('commits a return to the original value before the parent echoes a prior accepted edit', () => {
    const dirty = vi.fn();
    const bar = make({ onDraftStateChange: dirty });
    bar.change('accepted');
    bar.press('Enter');
    bar.input().props.onFocus();
    bar.change('saved');
    expect(dirty).toHaveBeenLastCalledWith(true);
    bar.press('Enter');
    expect(bar.onCommit.mock.calls).toEqual([['accepted'], ['saved']]);
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it.each(['cancel', 'rejected blur'])(
    'restores the latest accepted value on %s before the parent echoes it',
    (reason) => {
      const dirty = vi.fn();
      const bar = make({ onDraftStateChange: dirty });
      bar.change('accepted');
      bar.press('Enter');
      bar.input().props.onFocus();
      bar.change('new draft');
      if (reason === 'cancel') bar.press('Escape');
      else {
        bar.onCommit.mockImplementationOnce(() => {
          throw new Error('invalid');
        });
        bar.blur();
      }
      expect(bar.input().props.value).toBe('accepted');
      expect(dirty).toHaveBeenLastCalledWith(false);
      const calls = bar.onCommit.mock.calls.length;
      bar.blur();
      expect(bar.onCommit).toHaveBeenCalledTimes(calls);
    },
  );
  it('publishes draft resets only after render commits and transfers risk to a new observer', () => {
    const first = vi.fn(() => expect(hooks.rendering).toBe(false));
    const second = vi.fn(() => expect(hooks.rendering).toBe(false));
    const bar = make({ onDraftStateChange: first });
    bar.change('pending');
    bar.rerender({ onDraftStateChange: second });
    expect(first).toHaveBeenLastCalledWith(false);
    expect(second).toHaveBeenLastCalledWith(true);
    bar.rerender({ cellId: 'book/sheet/B1' });
    expect(second).toHaveBeenLastCalledWith(false);
  });
  it('clears risk on unmount and ignores retained input and address callbacks', () => {
    const dirty = vi.fn();
    const bar = make({ onDraftStateChange: dirty });
    bar.change('pending');
    const input = bar.input();
    const address = bar.input('单元格地址');
    bar.unmount();
    expect(dirty).toHaveBeenLastCalledWith(false);
    dirty.mockClear();
    input.props.onChange({ target: { value: 'late' } });
    input.props.onCompositionEnd({ currentTarget: { value: '迟到' } });
    input.props.onBlur();
    input.props.onKeyDown(bar.keyboard('Enter'));
    address.props.onChange({ target: { value: 'B2' } });
    address.props.onKeyDown(bar.keyboard('Enter'));
    expect(dirty).not.toHaveBeenCalled();
    expect(bar.onCommit).not.toHaveBeenCalled();
    expect(bar.onAddressChange).not.toHaveBeenCalled();
    expect(bar.onAddressSubmit).not.toHaveBeenCalled();
  });
  it('keeps risk for a rejected Enter draft but clears it when blur restores the stored value', () => {
    const dirty = vi.fn();
    const bar = make({ onDraftStateChange: dirty });
    bar.onCommit.mockImplementation(() => {
      throw new Error('invalid');
    });
    bar.change('pending');
    bar.press('Enter');
    expect(dirty).toHaveBeenLastCalledWith(true);
    bar.blur();
    expect(bar.input().props.value).toBe('saved');
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it('does not reinstate risk on a trailing change after deferred IME commit', () => {
    const dirty = vi.fn();
    const bar = make({ onDraftStateChange: dirty });
    const input = bar.input();
    input.props.onCompositionStart();
    input.props.onBlur();
    input.props.onCompositionEnd({ currentTarget: { value: '中文' } });
    input.props.onChange({ target: { value: '中文' } });
    expect(bar.onCommit).toHaveBeenCalledExactlyOnceWith('中文');
    expect(dirty).toHaveBeenLastCalledWith(false);
    input.props.onChange({ target: { value: '更新' } });
    expect(dirty).toHaveBeenLastCalledWith(true);
  });
  it('reports formula drafts as dirty and clears the state after commit or cell reset', () => {
    const onDraftStateChange = vi.fn();
    const view = make({ onDraftStateChange });
    view.change('pending');
    expect(onDraftStateChange).toHaveBeenLastCalledWith(true);
    view.press('Enter');
    expect(onDraftStateChange).toHaveBeenLastCalledWith(false);
    view.change('second');
    view.rerender({ cellId: 'book/sheet/B1', value: 'saved-b' });
    expect(onDraftStateChange).toHaveBeenLastCalledWith(false);
  });
  it('keeps readonly values copyable and discards an editable draft when made readonly', () => {
    const view = make();
    view.change('pending');
    const stale = view.input();
    view.rerender({ readOnly: true });
    expect(view.input().props.readOnly).toBe(true);
    expect(view.input().props.value).toBe('saved');
    stale.props.onBlur();
    view.change('attempt');
    view.press('Enter');
    view.blur();
    expect(view.input().props.value).toBe('saved');
    expect(view.onCommit).not.toHaveBeenCalled();
    view.rerender({ readOnly: false });
    view.change('allowed');
    view.press('Enter');
    expect(view.onCommit).toHaveBeenCalledWith('allowed');
  });
  it('shows accessible syntax while focused without committing the draft', () => {
    const view = make({ value: '=NPER(0,-100,1200)' });
    expect(view.input().props['aria-describedby']).toBeUndefined();
    view.input().props.onFocus();
    expect(view.input().props['aria-describedby']).toBe('formula-bar-test-formula-help');
    const help = elements(view.render()).find(
      (element) => element.props.id === 'formula-bar-test-formula-help',
    );
    expect(help).toBeDefined();
    expect(elements(help).find((element) => element.type === 'code')?.props.children).toBe(
      'NPER(rate, pmt, pv, [fv], [type])',
    );
    view.change('=MID(A1,1,2)');
    expect(view.onCommit).not.toHaveBeenCalled();
    view.press('Escape');
    expect(view.input().props['aria-describedby']).toBeUndefined();
    expect(view.onCommit).not.toHaveBeenCalled();
  });

  it('defers composition blur until final DOM text arrives and does not submit twice', () => {
    const bar = make();
    const input = bar.input();
    input.props.onCompositionStart();
    input.props.onChange({ target: { value: 'zhong' } });
    input.props.onBlur();
    expect(bar.onCommit).not.toHaveBeenCalled();
    input.props.onCompositionEnd({ currentTarget: { value: '中文' } });
    input.props.onChange({ target: { value: '中文' } });
    input.props.onBlur();
    expect(bar.onCommit).toHaveBeenCalledExactlyOnceWith('中文');
  });
  it('marks a composition-only final DOM value dirty before a later change event', () => {
    const onDraftStateChange = vi.fn();
    const bar = make({ onDraftStateChange });
    const input = bar.input();
    input.props.onCompositionStart();
    input.props.onCompositionEnd({ currentTarget: { value: '中文' } });
    expect(onDraftStateChange).toHaveBeenLastCalledWith(true);
    expect(bar.onCommit).not.toHaveBeenCalled();
  });
  it('ignores old composition callbacks after visiting another cell and returning to the same value', () => {
    const bar = make();
    const old = bar.input();
    old.props.onCompositionStart();
    old.props.onChange({ target: { value: 'old' } });
    old.props.onBlur();
    bar.rerender({ cellId: 'book/sheet/B1' });
    bar.rerender({ cellId: 'book/sheet/A1' });
    old.props.onCompositionEnd({ currentTarget: { value: '迟到' } });
    old.props.onChange({ target: { value: '迟到' } });
    old.props.onBlur();
    expect(bar.onCommit).not.toHaveBeenCalled();
    expect(bar.input().props.value).toBe('saved');
  });
  it('reports rejection of final composed text without persisting its partial draft', () => {
    const bar = make();
    bar.onCommit.mockImplementation(() => {
      throw new Error('仅允许数字');
    });
    const input = bar.input();
    input.props.onCompositionStart();
    input.props.onChange({ target: { value: 'zhong' } });
    input.props.onBlur();
    input.props.onCompositionEnd({ currentTarget: { value: '中文' } });
    expect(bar.onCommit).toHaveBeenCalledExactlyOnceWith('中文');
    expect(bar.alert()?.props.children).toBe('仅允许数字');
    expect(bar.input().props.value).toBe('saved');
  });
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
