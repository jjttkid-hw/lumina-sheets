import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { CellValue } from '../src/lib/types';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  version: 0,
  refs: [] as Array<{ current: unknown }>,
  refCursor: 0,
  deps: [] as Array<readonly unknown[]>,
  effectCursor: 0,
  effects: [] as Array<() => void>,
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
          if (!Object.is(next, hooks.states[index])) {
            hooks.states[index] = next;
            hooks.version++;
          }
        },
      ];
    },
    useRef: (initial: unknown) => (hooks.refs[hooks.refCursor++] ??= { current: initial }),
    useId: () => 'validation-picker-test',
    useMemo: (factory: () => unknown) => factory(),
    useEffect: (effect: () => void, dependencies: readonly unknown[]) => {
      const index = hooks.effectCursor++,
        previous = hooks.deps[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        hooks.deps[index] = dependencies;
        hooks.effects.push(effect);
      }
    },
  };
});
import ValidationPicker from '../src/components/ValidationPicker';
import type { ValidationPickerProps } from '../src/components/ValidationPicker';

type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Record<string, any>>(node) ? [node, ...elements(node.props.children)] : [];
}
function content(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(content).join('');
  if (isValidElement<Record<string, any>>(node)) return content(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
function make(values: CellValue[], options: Partial<ValidationPickerProps> = {}) {
  const onChoose = vi.fn(() => true),
    onClose = vi.fn(),
    focus = vi.fn();
  const props: ValidationPickerProps = {
    address: 'B4',
    values,
    unsupportedFormulaCount: 0,
    currentValue: 'unselected',
    left: 20,
    top: 30,
    width: 280,
    maxHeight: 360,
    onChoose,
    onClose,
    ...options,
  };
  const list = { clientHeight: 108, scrollTop: 0 };
  const render = (): Element => {
    for (let renderCount = 0; renderCount < 10; renderCount++) {
      const version = hooks.version;
      hooks.cursor = hooks.refCursor = hooks.effectCursor = 0;
      const result = ValidationPicker(props);
      for (const node of elements(result)) {
        if (node.props.role === 'combobox') node.props.ref.current = { focus };
        if (node.props.role === 'listbox') node.props.ref.current = list;
      }
      for (const effect of hooks.effects.splice(0)) effect();
      if (version === hooks.version) return result;
    }
    throw new Error('Too many rerenders');
  };
  const input = () => elements(render()).find((node) => node.props.role === 'combobox')!;
  const optionNodes = () => elements(render()).filter((node) => node.props.role === 'option');
  const activeOption = () => {
    const activeId = input().props['aria-activedescendant'];
    return optionNodes().find((node) => node.props.id === activeId);
  };
  const key = (name: string, extra: Record<string, unknown> = {}) => {
    const event = {
      key: name,
      keyCode: 0,
      nativeEvent: { isComposing: false },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...extra,
    };
    render().props.onKeyDown(event);
    return event;
  };
  return {
    props,
    render,
    input,
    optionNodes,
    activeOption,
    key,
    list,
    onChoose,
    onClose,
    focus,
    search: (value: string) => input().props.onChange({ target: { value } }),
    scroll: (top: number) => {
      list.scrollTop = top;
      elements(render())
        .find((node) => node.props.role === 'listbox')!
        .props.onScroll({ currentTarget: list });
    },
    blur: (inside: boolean) => {
      render().props.onBlur({
        currentTarget: { contains: () => inside },
        relatedTarget: inside ? {} : null,
      });
    },
    error: () => content(elements(render()).find((node) => node.props.role === 'alert')),
  };
}

beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  hooks.deps = [];
  hooks.effects = [];
  hooks.cursor = hooks.refCursor = hooks.effectCursor = hooks.version = 0;
});

describe('ValidationPicker actual selection handlers', () => {
  it('focuses the searchable combobox and preserves parent positioning', () => {
    const picker = make(['A', 'B'], { maxHeight: 140 });
    const root = picker.render();
    expect(root.props.style).toEqual({ left: 20, top: 30, width: 280, maxHeight: 140 });
    expect(root.props.className).toContain('validation-picker-compact');
    expect(picker.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(picker.input().props['aria-controls']).toBe(
      elements(root).find((node) => node.props.role === 'listbox')!.props.id,
    );
    expect(picker.input().props['aria-expanded']).toBe('true');
    expect(picker.activeOption()).toBeDefined();
  });

  it('uses strict value matching to highlight the current typed option', () => {
    const picker = make([1, '1', true, ''], { currentValue: '1' });
    expect(picker.activeOption()?.props['aria-posinset']).toBe(2);
    expect(picker.optionNodes().map((node) => node.props['aria-label'])).toEqual([
      '1，数字',
      '"1"，文本，当前值',
      'true，布尔',
      '空白，文本',
    ]);
  });

  it('keeps formula guidance and rejection feedback available in a 50px micro picker', () => {
    const picker = make(['A'], { maxHeight: 50, unsupportedFormulaCount: 2 });
    expect(picker.render().props.className).toContain('validation-picker-micro');
    const input = picker.input();
    expect(input.props.title).toBe('= 开头文本当前按公式解释，未列为可选项（2 项）。');
    expect(
      content(
        elements(picker.render()).find((node) => node.props.id === input.props['aria-describedby']),
      ),
    ).toBe(input.props.title);
    picker.onChoose.mockReturnValueOnce(false);
    picker.key('Enter');
    expect(picker.error()).toBe('未能应用该选项，请查看表格错误提示');
    expect(picker.activeOption()).toBeDefined();
    expect(picker.onClose).not.toHaveBeenCalled();
  });

  it.each<CellValue>([1, '1', true, false, '', 'a\nb', ' spaced '])(
    'commits the original typed value %j without parsing display labels',
    (value) => {
      const picker = make([value]);
      picker.optionNodes()[0].props.onClick();
      expect(picker.onChoose).toHaveBeenCalledExactlyOnceWith(value);
      expect(picker.onClose).not.toHaveBeenCalled();
      expect(picker.error()).toBe('');
    },
  );

  it('moves by arrows and endpoints, bounds the index, then commits with Enter', () => {
    const picker = make(['A', 'B', 'C']);
    expect(picker.key('ArrowUp').preventDefault).toHaveBeenCalledOnce();
    expect(picker.activeOption()?.props['aria-posinset']).toBe(1);
    picker.key('ArrowDown');
    expect(picker.activeOption()?.props['aria-posinset']).toBe(2);
    picker.key('End');
    expect(picker.activeOption()?.props['aria-posinset']).toBe(3);
    picker.key('ArrowDown');
    expect(picker.activeOption()?.props['aria-posinset']).toBe(3);
    picker.key('Home');
    expect(picker.activeOption()?.props['aria-posinset']).toBe(1);
    picker.key('ArrowDown');
    expect(picker.key('Enter').preventDefault).toHaveBeenCalledOnce();
    expect(picker.onChoose).toHaveBeenCalledExactlyOnceWith('B');
  });

  it('ignores Enter and navigation while a composition session is active', () => {
    const picker = make(['待办', '完成']);
    picker.input().props.onCompositionStart();
    expect(picker.key('Enter').preventDefault).not.toHaveBeenCalled();
    picker.key('ArrowDown');
    expect(picker.activeOption()?.props['aria-posinset']).toBe(1);
    expect(picker.onChoose).not.toHaveBeenCalled();
    picker.input().props.onCompositionEnd();
    picker.key('Enter');
    expect(picker.onChoose).toHaveBeenCalledExactlyOnceWith('待办');
  });

  it('guards native IME and keyCode 229 even without a composition event', () => {
    const picker = make(['A']);
    picker.key('Enter', { nativeEvent: { isComposing: true } });
    picker.key('Enter', { keyCode: 229 });
    expect(picker.onChoose).not.toHaveBeenCalled();
  });

  it('closes with focus restoration on Escape and handles the following blur only once', () => {
    const picker = make(['A']);
    const event = picker.key('Escape');
    picker.blur(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(picker.onClose).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each([false, true])('lets Tab move focus naturally with shiftKey=%s', (shiftKey) => {
    const picker = make(['A']);
    const event = picker.key('Tab', { shiftKey });
    picker.blur(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(picker.onClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('closes only when focus leaves the component', () => {
    const picker = make(['A']);
    picker.blur(true);
    expect(picker.onClose).not.toHaveBeenCalled();
    picker.blur(false);
    expect(picker.onClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('stops table keyboard and pointer propagation without blocking input defaults', () => {
    const picker = make(['A']);
    const event = picker.key('a', { ctrlKey: true });
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
    for (const handler of [
      'onKeyUp',
      'onKeyPress',
      'onPointerDown',
      'onPointerMove',
      'onPointerUp',
      'onPointerCancel',
      'onClick',
      'onDoubleClick',
      'onContextMenu',
      'onWheel',
    ]) {
      const stopPropagation = vi.fn();
      picker.render().props[handler]({ stopPropagation });
      expect(stopPropagation).toHaveBeenCalledOnce();
    }
    const preventDefault = vi.fn();
    picker.optionNodes()[0].props.onPointerDown({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(picker.onClose).not.toHaveBeenCalled();
  });

  it('filters by case-insensitive substring and type, resetting the active option', () => {
    const picker = make(['Alpha', 'alphabet', 'BETA', 1, '1']);
    picker.key('End');
    picker.search('ALP');
    expect(picker.optionNodes().map((node) => node.props['aria-label'])).toEqual([
      '"Alpha"，文本',
      '"alphabet"，文本',
    ]);
    expect(content(picker.render())).toContain('2 / 5 个选项');
    expect(picker.activeOption()?.props['aria-posinset']).toBe(1);
    picker.search('数字');
    expect(picker.optionNodes()).toHaveLength(1);
    picker.key('Enter');
    expect(picker.onChoose).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('searches literal whitespace and preserves original option ids after filtering', () => {
    const picker = make(['plain', ' a ', 'another']);
    const expectedId = picker.optionNodes()[1].props.id;
    picker.search(' a ');
    expect(picker.optionNodes()).toHaveLength(1);
    expect(picker.activeOption()?.props.id).toBe(expectedId);
    picker.key('Enter');
    expect(picker.onChoose).toHaveBeenCalledExactlyOnceWith(' a ');
  });

  it('shows empty search results with no active descendant or commit', () => {
    const picker = make(['A']);
    picker.search('missing');
    expect(picker.optionNodes()).toHaveLength(0);
    expect(picker.input().props['aria-activedescendant']).toBeUndefined();
    expect(content(picker.render())).toContain('没有匹配的选项');
    picker.key('Home');
    picker.key('End');
    picker.key('ArrowDown');
    picker.key('Enter');
    expect(picker.onChoose).not.toHaveBeenCalled();
    picker.search('');
    expect(picker.activeOption()).toBeDefined();
  });

  it('explains an empty candidate set and excluded formula text', () => {
    const picker = make([], { unsupportedFormulaCount: 3 });
    expect(content(picker.render())).toContain('没有可用选项');
    expect(content(picker.render())).toContain('= 开头文本当前按公式解释，未列为可选项（3 项）');
    expect(picker.input().props['aria-describedby']).toBe('validation-picker-test-unsupported');
    picker.key('Enter');
    expect(picker.onChoose).not.toHaveBeenCalled();
  });

  it('retains a rejected choice and allows selecting another value', () => {
    const picker = make([1, '1']);
    picker.onChoose.mockReturnValueOnce(false);
    picker.key('Enter');
    expect(picker.error()).toBe('未能应用该选项，请查看表格错误提示');
    expect(picker.onClose).not.toHaveBeenCalled();
    expect(picker.activeOption()?.props['aria-posinset']).toBe(1);
    picker.key('ArrowDown');
    picker.key('Enter');
    expect(picker.onChoose.mock.calls).toEqual([[1], ['1']]);
    expect(picker.error()).toBe('');
  });

  it('retains the picker on a thrown commit and clears rejection when searching', () => {
    const picker = make(['A']);
    picker.onChoose.mockImplementationOnce(() => {
      throw new Error('Commit failure');
    });
    picker.key('Enter');
    expect(picker.error()).toContain('未能应用');
    expect(picker.onClose).not.toHaveBeenCalled();
    picker.search('A');
    expect(picker.error()).toBe('');
    picker.key('Enter');
    expect(picker.onChoose).toHaveBeenCalledTimes(2);
  });

  it('does not interpret focus restoration inside a successful commit as cancellation', () => {
    const picker = make(['A']);
    picker.onChoose.mockImplementationOnce(() => {
      picker.blur(false);
      return true;
    });
    picker.key('Enter');
    picker.blur(false);
    expect(picker.onClose).not.toHaveBeenCalled();
  });

  it('keeps 1,000 choices virtual and mounts the active item after endpoint navigation', () => {
    const picker = make(Array.from({ length: 1_000 }, (_, i) => `item-${i}`));
    expect(picker.optionNodes().length).toBeLessThanOrEqual(10);
    picker.key('End');
    expect(picker.activeOption()?.props['aria-posinset']).toBe(1_000);
    expect(picker.activeOption()?.props['aria-setsize']).toBe(1_000);
    expect(picker.list.scrollTop).toBe(36_000 - picker.list.clientHeight);
    expect(picker.optionNodes().length).toBeLessThanOrEqual(10);
    picker.key('Home');
    expect(picker.activeOption()?.props['aria-posinset']).toBe(1);
    expect(picker.list.scrollTop).toBe(0);
    expect(picker.optionNodes().length).toBeLessThanOrEqual(10);
  });

  it('retains a valid active descendant when manually scrolling away and then searching', () => {
    const picker = make(Array.from({ length: 1_000 }, (_, i) => `item-${i}`));
    picker.render();
    picker.scroll(18_000);
    expect(picker.optionNodes().length).toBeLessThanOrEqual(10);
    expect(picker.activeOption()?.props['aria-posinset']).toBe(1);
    expect(picker.optionNodes().some((node) => node.props['aria-posinset'] === 501)).toBe(true);
    picker.search('item-999');
    expect(picker.optionNodes()).toHaveLength(1);
    expect(picker.list.scrollTop).toBe(0);
    picker.key('Enter');
    expect(picker.onChoose).toHaveBeenCalledExactlyOnceWith('item-999');
  });

  it('scrolls a current value near the end into view on initial mount', () => {
    const picker = make(
      Array.from({ length: 1_000 }, (_, i) => i),
      { currentValue: 980 },
    );
    expect(picker.activeOption()?.props['aria-posinset']).toBe(981);
    expect(picker.list.scrollTop).toBe(981 * 36 - picker.list.clientHeight);
    expect(picker.optionNodes().length).toBeLessThanOrEqual(10);
  });
});
