import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode, type ReactElement } from 'react';
import { runRangeBenchmark } from '../src/lib/performance/range-benchmark';
import type { RangeBenchmarkResponse } from '../src/lib/performance/range-benchmark.worker';

// Production JSX callbacks with hook slots and a controlled worker transport.
// This is state/ownership evidence, not browser rendering or timing evidence.
const hooks = vi.hoisted(() => ({
  states: [] as any[],
  refs: [] as any[],
  cursor: 0,
  refCursor: 0,
  cleanup: undefined as (() => void) | undefined,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (index >= hooks.states.length)
      hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [
      hooks.states[index],
      (next: any) => {
        hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next;
      },
    ];
  },
  useRef: (initial: any) => (hooks.refs[hooks.refCursor++] ??= { current: initial }),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => () => void) => {
    if (!hooks.cleanup) hooks.cleanup = effect();
  },
}));
import RangeBenchmark from '../src/components/RangeBenchmark';
class WorkerStub {
  static all: WorkerStub[] = [];
  requests: unknown[] = [];
  onmessage?: (event: { data: RangeBenchmarkResponse }) => void;
  onerror?: (event: { message: string }) => void;
  terminate = vi.fn();
  postMessage = vi.fn((request: unknown) => {
    this.requests.push(request);
  });
  constructor() {
    WorkerStub.all.push(this);
  }
  emit(data: RangeBenchmarkResponse) {
    this.onmessage?.({ data });
  }
}
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function words(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(words).join('');
  return isValidElement<Record<string, any>>(node) ? words(node.props.children) : '';
}
let downloaded: Blob;
function render() {
  hooks.cursor = hooks.refCursor = 0;
  return elements(RangeBenchmark());
}
function button(label: string) {
  return render().find((e) => e.type === 'button' && words(e.props.children) === label)!;
}
function status() {
  return words(render().find((e) => e.props.role === 'status')!.props.children);
}
beforeEach(() => {
  hooks.cleanup = undefined;
  hooks.states = [];
  hooks.refs = [];
  WorkerStub.all = [];
  vi.stubGlobal('Worker', WorkerStub);
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('document', { hidden: false, createElement: () => ({ click() {} }) });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    downloaded = blob as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.useFakeTimers();
});
afterEach(() => {
  hooks.cleanup?.();
  hooks.cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(['constructor', 'send'])(
  'recovers from worker %s failures without an uncaught event error',
  (mode) => {
    if (mode === 'constructor')
      vi.stubGlobal(
        'Worker',
        class {
          constructor() {
            throw Error('blocked');
          }
        },
      );
    if (mode === 'send') {
      vi.stubGlobal(
        'Worker',
        class extends WorkerStub {
          constructor() {
            super();
            this.postMessage.mockImplementation(() => {
              throw Error('send failed');
            });
          }
        },
      );
    }
    expect(() => button('运行范围基准').props.onClick()).not.toThrow();
    expect(button('运行范围基准')).toBeDefined();
    expect(button('导出范围报告').props.disabled).toBe(true);
    expect(status()).toContain('失败');
    if (mode === 'send') expect(WorkerStub.all.at(-1)!.terminate).toHaveBeenCalled();
  },
);

it('unmount invalidates worker ownership so late progress cannot mutate state', () => {
  button('运行范围基准').props.onClick();
  const worker = WorkerStub.all.at(-1)!;
  hooks.cleanup!();
  const before = [...hooks.states];
  worker.emit({ type: 'progress', completed: 1, total: 30 });
  expect(hooks.states).toEqual(before);
  expect(worker.terminate).toHaveBeenCalled();
});

it('cancels old requests without letting them overwrite a restarted measurement', () => {
  button('运行范围基准').props.onClick();
  const old = WorkerStub.all.at(-1)!;
  button('取消范围基准').props.onClick();
  button('运行范围基准').props.onClick();
  old.emit({ type: 'error', message: 'stale error' });
  expect(status()).not.toContain('stale error');
  WorkerStub.all.at(-1)!.emit({ type: 'progress', completed: 2, total: 30 });
  expect(status()).toContain('2 / 30');
});

it('exports actual workload counts with build provenance and clears stale status on layout change', async () => {
  vi.useRealTimers();
  const result = await runRangeBenchmark({ formulaCount: 3, iterations: 2 });
  button('运行范围基准').props.onClick();
  WorkerStub.all.at(-1)!.emit({ type: 'result', report: result });
  expect(status()).toContain('2 次');
  button('导出范围报告').props.onClick();
  const data = JSON.parse(await downloaded.text());
  expect(data).toMatchObject({
    schema: 1,
    iterations: 2,
    formulaCount: 3,
    build: { version: '0.29.0', mode: 'development' },
  });
  expect(data.notes.join(' ')).not.toContain('10,000');
  expect(data.notes.join(' ')).toContain('3 个公式');
  render()
    .find((e) => e.type === 'select')!
    .props.onChange({ target: { value: 'overlapping' } });
  expect(status()).not.toContain('原始样本可导出');
  expect(button('导出范围报告').props.disabled).toBe(true);
});

it('invalidates a crashed worker and allows a fresh retry', () => {
  button('运行范围基准').props.onClick();
  const old = WorkerStub.all.at(-1)!;
  old.onerror?.({ message: 'failed' });
  expect(button('运行范围基准')).toBeDefined();
  expect(button('导出范围报告').props.disabled).toBe(true);
  const previous = status();
  old.emit({ type: 'progress', completed: 30, total: 30 });
  expect(status()).toBe(previous);
  button('运行范围基准').props.onClick();
  expect(WorkerStub.all.at(-1)).not.toBe(old);
});
