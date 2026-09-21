import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactNode, ReactElement } from 'react';

const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: any }>,
  cursor: 0,
  effect: undefined as undefined | (() => void | (() => void)),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: (value: unknown) => (hooks.refs[hooks.cursor++] ??= { current: value }),
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effect ??= effect;
  },
}));
import Modal from '../src/components/Modal';
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Record<string, any>>(node) ? [node, ...elements(node.props.children)] : [];
}
const keyboard = (key: string, extras = {}) => ({ key, preventDefault: vi.fn(), ...extras });
let cleanup: (() => void) | undefined;
beforeEach(() => {
  hooks.refs = [];
  hooks.cursor = 0;
  hooks.effect = undefined;
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});
function make() {
  const previous = { focus: vi.fn() };
  const node = () => ({
    focus: vi.fn(),
    tabIndex: 0,
    matches: vi.fn(() => false),
    closest: vi.fn((): object | null => null),
    getClientRects: vi.fn(() => [{}]),
    visibility: 'visible',
  });
  const first = node();
  const last = node();
  const candidates = [first, last];
  vi.stubGlobal('getComputedStyle', (element: { visibility: string }) => element);
  const document = {
    activeElement: previous,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('document', document);
  const close = vi.fn();
  const render = (onClose = close) => {
    hooks.cursor = 0;
    return elements(Modal({ title: '输入', children: null, onClose })).find(
      (node) => node.props.role === 'dialog',
    )!;
  };
  const modal = render();
  const container = {
    querySelectorAll: () => candidates,
    focus: vi.fn(),
    contains: (value: unknown) => candidates.includes(value as typeof first),
  };
  modal.props.ref.current = container;
  cleanup = hooks.effect!() || undefined;
  const key = document.addEventListener.mock.calls.find(([name]) => name === 'keydown')![1];
  return {
    modal,
    key,
    close,
    render,
    document,
    previous,
    first,
    last,
    candidates,
    node,
    container,
  };
}
describe('modal IME boundaries', () => {
  it.each(['disabled', 'hidden-parent', 'no-layout', 'invisible', 'negative-tabindex'])(
    'skips %s controls when wrapping the focus order',
    (kind) => {
      const view = make();
      const skipped = view.node();
      if (kind === 'disabled') skipped.matches.mockReturnValue(true);
      if (kind === 'hidden-parent') skipped.closest.mockReturnValue({});
      if (kind === 'no-layout') skipped.getClientRects.mockReturnValue([]);
      if (kind === 'invisible') skipped.visibility = 'hidden';
      if (kind === 'negative-tabindex') skipped.tabIndex = -1;
      view.candidates.push(skipped);
      view.document.activeElement = view.last;
      const event = keyboard('Tab');
      view.key(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(view.first.focus).toHaveBeenCalledTimes(2);
      expect(skipped.focus).not.toHaveBeenCalled();
    },
  );

  it('returns escaped focus in either direction and uses the dialog when all controls disappear', () => {
    const view = make();
    view.key(keyboard('Tab'));
    expect(view.first.focus).toHaveBeenCalledTimes(2);
    view.key(keyboard('Tab', { shiftKey: true }));
    expect(view.last.focus).toHaveBeenCalledOnce();
    view.candidates.length = 0;
    const event = keyboard('Tab');
    view.key(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(view.container.focus).toHaveBeenCalledOnce();
    expect(view.modal.props.tabIndex).toBe(-1);
  });

  it('wraps according to native positive tabindex ordering', () => {
    const view = make();
    const prioritized = view.node();
    prioritized.tabIndex = 2;
    view.candidates.push(prioritized);
    view.document.activeElement = view.last;
    view.key(keyboard('Tab'));
    expect(prioritized.focus).toHaveBeenCalledOnce();
    view.document.activeElement = prioritized;
    view.key(keyboard('Tab', { shiftKey: true }));
    expect(view.last.focus).toHaveBeenCalledOnce();
  });
  it('keeps Escape and Tab with the IME until composition ends', () => {
    const view = make();
    view.modal.props.onCompositionStartCapture();
    view.key(keyboard('Escape'));
    const tab = keyboard('Tab', { shiftKey: true });
    view.document.activeElement = view.first;
    view.key(tab);
    expect(view.close).not.toHaveBeenCalled();
    expect(tab.preventDefault).not.toHaveBeenCalled();
    view.modal.props.onCompositionEndCapture();
    view.key(keyboard('Escape'));
    expect(view.close).toHaveBeenCalledOnce();
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'respects native composition signal %j after compositionend',
    (signal) => {
      const view = make();
      view.key(keyboard('Escape', signal));
      expect(view.close).not.toHaveBeenCalled();
      const enter = { ...keyboard('Enter'), nativeEvent: signal };
      view.modal.props.onKeyDownCapture(enter);
      expect(enter.preventDefault).toHaveBeenCalledOnce();
    },
  );
  it('blocks implicit form submission while composing and allows normal Enter afterwards', () => {
    const view = make();
    view.modal.props.onCompositionStartCapture();
    const enter = { ...keyboard('Enter'), nativeEvent: {} };
    view.modal.props.onKeyDownCapture(enter);
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    const submit = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    view.modal.props.onSubmitCapture(submit);
    expect(submit.preventDefault).toHaveBeenCalledOnce();
    expect(submit.stopPropagation).toHaveBeenCalledOnce();
    view.modal.props.onCompositionEndCapture();
    enter.preventDefault.mockClear();
    submit.preventDefault.mockClear();
    view.modal.props.onKeyDownCapture(enter);
    view.modal.props.onSubmitCapture(submit);
    expect(enter.preventDefault).not.toHaveBeenCalled();
    expect(submit.preventDefault).not.toHaveBeenCalled();
  });
  it('preserves focus trapping, latest close callback and cleanup', () => {
    const view = make();
    expect(view.first.focus).toHaveBeenCalledOnce();
    view.document.activeElement = view.last;
    const tab = keyboard('Tab');
    view.key(tab);
    expect(tab.preventDefault).toHaveBeenCalledOnce();
    expect(view.first.focus).toHaveBeenCalledTimes(2);
    const updated = vi.fn();
    view.render(updated);
    view.key(keyboard('Escape', { defaultPrevented: true }));
    expect(updated).not.toHaveBeenCalled();
    view.key(keyboard('Escape'));
    expect(updated).toHaveBeenCalledOnce();
    expect(view.close).not.toHaveBeenCalled();
    cleanup!();
    cleanup = undefined;
    expect(view.document.removeEventListener).toHaveBeenCalledWith('keydown', view.key);
    expect(view.previous.focus).toHaveBeenCalledOnce();
  });
});
