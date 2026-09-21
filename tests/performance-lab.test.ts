import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode, type ReactElement } from 'react';
import { createBlankWorkbook } from '../src/lib/seed';
import type { LabRequest, LabResponse } from '../src/lib/performance/lab.worker';

// Production JSX callbacks with hook slots and a controlled worker transport.
// This is state/ownership evidence, not browser rendering or timing evidence.
const hooks = vi.hoisted(() => ({
  states: [] as any[],
  refs: [] as any[],
  cursor: 0,
  refCursor: 0,
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
  useEffect: () => {},
}));
vi.mock('../src/components/Spreadsheet', () => ({ default: () => null }));
vi.mock('../src/components/RangeBenchmark', () => ({ default: () => null }));
import PerformanceLab from '../src/components/PerformanceLab';
class WorkerStub {
  static all: WorkerStub[] = [];
  requests: LabRequest[] = [];
  onmessage?: (event: { data: LabResponse }) => void;
  onerror?: (event: { message: string }) => void;
  terminate = vi.fn();
  postMessage = vi.fn((request: LabRequest) => {
    this.requests.push(request);
  });
  constructor() {
    WorkerStub.all.push(this);
  }
  emit(data: LabResponse) {
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
  return elements(PerformanceLab({}));
}
function button(label: string) {
  return render().find((e) => e.type === 'button' && words(e.props.children) === label)!;
}
function status() {
  return words(render().find((e) => e.props.role === 'status')!.props.children);
}
function load() {
  button('加载数据').props.onClick();
  const worker = WorkerStub.all.at(-1)!;
  const workbook = createBlankWorkbook();
  worker.emit({ type: 'start', workbook, storedCells: 100000 });
  worker.emit({ type: 'ready', generatedMs: 1, storedCells: 100000, formulaCount: 10000 });
  return worker;
}
function calculate(worker: WorkerStub) {
  button('测量后台公式').props.onClick();
  const request = worker.requests.at(-1)!;
  if (request.type !== 'calculate') throw Error('No calculation request');
  return request.id;
}
function result(worker: WorkerStub, id: number) {
  worker.emit({ type: 'calculated', id, targets: 10, elapsedMs: 2, firstValue: 5, lastValue: 50 });
}
async function report() {
  button('导出实测报告').props.onClick();
  return JSON.parse(await downloaded.text());
}
beforeEach(() => {
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('clear samples invalidates in-flight calculation and allows an independent new measurement', async () => {
  const worker = load();
  const old = calculate(worker);
  button('清空样本').props.onClick();
  const ready = button('测量后台公式');
  expect(ready).toBeDefined();
  expect(ready.props.disabled).toBe(false);
  const next = calculate(worker);
  result(worker, old);
  expect((await report()).workerCalculation).toBeNull();
  result(worker, next);
  expect((await report()).workerCalculation.targets).toBe(10);
});

it('reset discards the previous scrolling run state as well as samples', async () => {
  load();
  button('跨视区采样').props.onClick();
  button('清空样本').props.onClick();
  const output = await report();
  expect(output.canvas.frames).toBe(0);
  expect(output.scrollSampling).toMatchObject({ completed: 0, status: 'not-started' });
});

it('late calculation errors after reset do not overwrite a newer result', async () => {
  const worker = load();
  const old = calculate(worker);
  button('清空样本').props.onClick();
  worker.emit({ type: 'error', id: old, message: 'stale failure' } as LabResponse);
  expect(status()).not.toContain('stale failure');
});

it('worker failure invalidates transport and cannot be followed by a successful stale result', async () => {
  const worker = load();
  const id = calculate(worker);
  worker.onerror?.({ message: 'transport failed' });
  result(worker, id);
  expect((await report()).workerCalculation).toBeNull();
  expect(worker.terminate).toHaveBeenCalled();
  expect(button('测量后台公式').props.disabled).toBe(true);
});

it('a synchronous post failure settles the calculation control', () => {
  const worker = load();
  worker.postMessage.mockImplementation(() => {
    throw Error('post failed');
  });
  expect(() => button('测量后台公式').props.onClick()).not.toThrow();
  expect(status()).toContain('post failed');
  expect(button('测量后台公式').props.disabled).toBe(true);
});

it('clears previous results while measuring and accepts only the matching failure', async () => {
  const worker = load();
  const first = calculate(worker);
  result(worker, first);
  const next = calculate(worker);
  expect((await report()).workerCalculation).toBeNull();
  worker.emit({ type: 'error', id: first, message: 'old error' });
  expect(status()).not.toContain('old error');
  worker.emit({ type: 'error', id: next, message: 'current error' });
  expect(status()).toContain('current error');
  expect(button('测量后台公式').props.disabled).toBe(false);
  result(worker, next);
  expect((await report()).workerCalculation).toBeNull();
});

it('reload owns its worker and rejects all messages from the terminated worker', async () => {
  const old = load();
  const id = calculate(old);
  const current = load();
  result(old, id);
  old.onerror?.({ message: 'old worker' });
  expect((await report()).workerCalculation).toBeNull();
  const next = calculate(current);
  result(current, next);
  expect((await report()).workerCalculation.targets).toBe(10);
});

it('exports the embedded build identity instead of guessing a release from measurement time', async () => {
  load();
  const output = await report();
  expect(output.build).toMatchObject({ schema: 1, version: '0.29.0', mode: 'development' });
  expect(output.build.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(output.build.scope).toContain('final artifacts');
});
