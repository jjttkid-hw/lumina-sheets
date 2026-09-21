import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { returnFocusNextFrame } from '../src/lib/focus-return';
let frame: () => void;
beforeEach(() =>
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frame = callback;
    return 1;
  }),
);
afterEach(() => vi.unstubAllGlobals());
function make() {
  const editor = {};
  const document = { activeElement: editor, body: {}, documentElement: {} };
  const target = {
    ownerDocument: document,
    isConnected: true,
    contains: (node: unknown) => node === editor,
    focus: vi.fn(),
  };
  return {
    document,
    target,
    schedule: () => returnFocusNextFrame(target as unknown as HTMLElement),
  };
}
it.each(['unchanged', 'body', 'documentElement'] as const)(
  'restores focus when the editor is %s',
  (state) => {
    const t = make();
    t.schedule();
    if (state !== 'unchanged') t.document.activeElement = t.document[state];
    frame();
    expect(t.target.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  },
);
it('preserves focus moved to a host input before the frame runs', () => {
  const t = make();
  t.schedule();
  t.document.activeElement = { hostInput: true };
  frame();
  expect(t.target.focus).not.toHaveBeenCalled();
});
it('does not focus an unmounted instance', () => {
  const t = make();
  t.schedule();
  t.target.isConnected = false;
  frame();
  expect(t.target.focus).not.toHaveBeenCalled();
});
it('preserves host focus already changed synchronously by the commit callback', () => {
  const t = make();
  t.document.activeElement = { hostInput: true };
  const request = vi.fn();
  vi.stubGlobal('requestAnimationFrame', request);
  t.schedule();
  expect(request).not.toHaveBeenCalled();
});
it('ignores a missing target', () => {
  const request = vi.fn();
  vi.stubGlobal('requestAnimationFrame', request);
  returnFocusNextFrame(null);
  expect(request).not.toHaveBeenCalled();
});
