import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Comment, Revision, Workbook } from '../src/lib/types';

// Run App itself and its real handlers/effects. Child components remain JSX
// boundaries; only hooks, browser globals, and async persistence are substituted.
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  cursor: 0,
  dirty: false,
  effects: [] as Array<() => void>,
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const memo = (factory: () => unknown, deps?: unknown[]) => {
    const index = hooks.cursor++;
    if (!hooks.slots[index] || !same(hooks.slots[index].deps, deps))
      hooks.slots[index] = { value: factory(), deps };
    return hooks.slots[index].value;
  };
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (!hooks.slots[index])
        hooks.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [
        hooks.slots[index].value,
        (value: unknown) => {
          const next = typeof value === 'function' ? value(hooks.slots[index].value) : value;
          if (!Object.is(next, hooks.slots[index].value)) hooks.dirty = true;
          hooks.slots[index].value = next;
        },
      ];
    },
    useRef: (initial: unknown) => (hooks.slots[hooks.cursor++] ??= { current: initial }),
    useMemo: memo,
    useCallback: (callback: unknown, deps?: unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.slots[index];
      if (!previous || !same(previous.deps, deps)) {
        const slot = { deps, cleanup: undefined as undefined | (() => void) };
        hooks.slots[index] = slot;
        hooks.effects.push(() => {
          previous?.cleanup?.();
          slot.cleanup = effect() || undefined;
        });
      }
    },
  };
});
const adapter = vi.hoisted(() => ({
  loadWorkbooks: vi.fn(),
  putWorkbook: vi.fn(),
  queuePatch: vi.fn(),
  flush: vi.fn(),
  loadRevisions: vi.fn(),
  loadComments: vi.fn(),
  saveRevisions: vi.fn(),
  saveComments: vi.fn(),
  stats: { backend: 'indexeddb' },
}));
vi.mock('../src/lib/persistence', () => ({ getPersistence: () => adapter }));
const fileIO = vi.hoisted(() => ({ importFile: vi.fn() }));
vi.mock('../src/lib/io', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/io')>()),
  importFile: fileIO.importFile,
}));
vi.mock('../src/lib/calculation', () => ({
  createCalculationRuntime: () => ({
    calculate: async (_book: unknown, _targets: unknown, revision: number) => ({
      revision,
      values: {},
    }),
    dispose: vi.fn(),
  }),
}));
import App from '../src/App';
import Spreadsheet from '../src/components/Spreadsheet';
import Modal from '../src/components/Modal';
import { createBlankWorkbook } from '../src/lib/seed';

type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<Record<string, any>>(node) ? text(node.props.children) : '';
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function workbook(id: string) {
  const book = createBlankWorkbook(id);
  book.id = id;
  book.sheets[0].cells.A1 = { value: id };
  return book;
}
function revision(book: Workbook): Revision {
  return {
    id: `${book.id}-revision`,
    name: `${book.id}的历史`,
    createdAt: book.createdAt,
    workbook: book,
  };
}
function comment(book: Workbook): Comment {
  return {
    id: `${book.id}-comment`,
    sheetId: book.sheets[0].id,
    cell: 'A1',
    text: `${book.id}的批注`,
    createdAt: book.createdAt,
    resolved: false,
  };
}
function mount() {
  let tree: Element;
  function render() {
    let count = 0;
    do {
      hooks.cursor = 0;
      hooks.dirty = false;
      tree = App();
      const effects = hooks.effects.splice(0);
      effects.forEach((effect) => effect());
      if (++count > 30) throw new Error('App did not settle after its effects');
    } while (hooks.dirty);
  }
  render();
  return {
    render,
    async settle() {
      // Flush the finite Promise chains (hydration, effects, save acknowledgments)
      // without advancing toast/debounce timers or waiting on deferred IO.
      for (let turn = 0; turn < 20; turn++) {
        await Promise.resolve();
        if (hooks.dirty) render();
      }
    },
    all: () => elements(tree),
    editor: () => elements(tree).find((node) => node.type === Spreadsheet),
    visibleText: () => text(tree),
    click(label: string) {
      const node = elements(tree).find(
        (element) =>
          typeof element.props.onClick === 'function' &&
          (element.props['aria-label'] === label ||
            element.props.label === label ||
            element.props.title === label ||
            (element.type === 'button' && text(element) === label)),
      );
      if (!node) throw new Error(`Missing action: ${label}`);
      node.props.onClick();
      render();
    },
    closeModal() {
      const node = elements(tree).find((element) => element.type === Modal);
      if (!node) throw new Error('Missing modal');
      node.props.onClose();
      render();
    },
  };
}

let storage: Map<string, string>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.dirty = false;
  hooks.effects = [];
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('window', {
    innerWidth: 1200,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('location', { hash: '', pathname: '/', search: '' });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  adapter.loadWorkbooks.mockResolvedValue([]);
  adapter.putWorkbook.mockResolvedValue(undefined);
  adapter.flush.mockResolvedValue(undefined);
  adapter.loadRevisions.mockResolvedValue([]);
  adapter.loadComments.mockResolvedValue([]);
  adapter.saveRevisions.mockResolvedValue(undefined);
  adapter.saveComments.mockResolvedValue(undefined);
});
afterEach(() => {
  hooks.slots.forEach((slot) => slot?.cleanup?.());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('App workspace hydration and async record ownership', () => {
  it('keeps the editor unavailable after load failure and restores it only after a successful retry', async () => {
    const first = deferred<Workbook[]>(),
      retry = deferred<Workbook[]>(),
      saved = workbook('恢复的工作簿');
    adapter.loadWorkbooks.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const app = mount();
    expect(app.editor()).toBeUndefined();
    expect(adapter.loadComments).not.toHaveBeenCalled();
    first.reject(new Error('Temporary read transaction failure'));
    await app.settle();
    expect(app.visibleText()).toContain('读取失败');
    expect(app.editor()).toBeUndefined();
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    expect(adapter.queuePatch).not.toHaveBeenCalled();
    app.click('重试读取');
    expect(adapter.loadWorkbooks).toHaveBeenCalledTimes(2);
    expect(app.editor()).toBeUndefined();
    retry.resolve([saved]);
    await app.settle();
    expect(app.editor()?.props.workbook.id).toBe(saved.id);
    expect(app.visibleText()).toContain('已保存到本地');
    expect(adapter.loadComments).toHaveBeenCalledExactlyOnceWith(saved.id);
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
  });

  it('restores the requested active workbook after asynchronous hydration without overwriting saved books', async () => {
    const a = workbook('A'),
      b = workbook('B'),
      pending = deferred<Workbook[]>();
    storage.set('lumina.v1.activeWorkbook', JSON.stringify(b.id));
    adapter.loadWorkbooks.mockReturnValue(pending.promise);
    const app = mount();
    expect(app.editor()).toBeUndefined();
    pending.resolve([a, b]);
    await app.settle();
    expect(app.editor()?.props.workbook.id).toBe(b.id);
    expect(app.editor()?.props.sheet.cells.A1.value).toBe('B');
    expect(JSON.parse(storage.get('lumina.v1.activeWorkbook')!)).toBe(b.id);
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    expect(adapter.queuePatch).not.toHaveBeenCalled();
  });

  it('ignores delayed initial history and comments after switching to another workbook', async () => {
    const a = workbook('A'),
      b = workbook('B'),
      oldHistory = deferred<Revision[]>(),
      oldComments = deferred<Comment[]>();
    adapter.loadWorkbooks.mockResolvedValue([a, b]);
    adapter.loadRevisions.mockImplementation((id: string) =>
      id === a.id ? oldHistory.promise : Promise.resolve([revision(b)]),
    );
    adapter.loadComments.mockImplementation((id: string) =>
      id === a.id ? oldComments.promise : Promise.resolve([comment(b)]),
    );
    const app = mount();
    await app.settle();
    expect(app.editor()?.props.workbook.id).toBe(a.id);
    app.click(b.name);
    await app.settle();
    oldHistory.resolve([revision(a)]);
    oldComments.resolve([comment(a)]);
    await app.settle();
    // Inspect immediately after opening, before the new read can overwrite an
    // incorrectly accepted old response and mask the race.
    app.click('版本历史');
    expect(app.visibleText()).toContain('B的历史');
    expect(app.visibleText()).not.toContain('A的历史');
    app.click('保存版本');
    expect(adapter.saveRevisions.mock.lastCall?.[0]).toBe(b.id);
    expect(
      adapter.saveRevisions.mock.lastCall?.[1].every((item: Revision) => item.workbook.id === b.id),
    ).toBe(true);
    app.closeModal();
    app.click('批注');
    expect(app.visibleText()).toContain('B的批注');
    expect(app.visibleText()).not.toContain('A的批注');
  });

  it('ignores stale history and comment reads started by opening their panels', async () => {
    const a = workbook('A'),
      b = workbook('B'),
      oldHistory = deferred<Revision[]>(),
      oldComments = deferred<Comment[]>();
    let historyReads = 0,
      commentReads = 0;
    adapter.loadWorkbooks.mockResolvedValue([a, b]);
    adapter.loadRevisions.mockImplementation((id: string) =>
      id === a.id && ++historyReads > 1
        ? oldHistory.promise
        : Promise.resolve([revision(id === a.id ? a : b)]),
    );
    adapter.loadComments.mockImplementation((id: string) =>
      id === a.id && ++commentReads > 1
        ? oldComments.promise
        : Promise.resolve([comment(id === a.id ? a : b)]),
    );
    const app = mount();
    await app.settle();
    app.click('版本历史');
    app.closeModal();
    app.click('批注');
    app.closeModal();
    app.click(b.name);
    await app.settle();
    oldHistory.resolve([revision(a)]);
    oldComments.resolve([comment(a)]);
    await app.settle();
    app.click('版本历史');
    expect(app.visibleText()).toContain('B的历史');
    expect(app.visibleText()).not.toContain('A的历史');
    app.closeModal();
    app.click('批注');
    expect(app.visibleText()).toContain('B的批注');
    expect(app.visibleText()).not.toContain('A的批注');
  });

  it('imports through the real file input handler and saves its base before subsequent cell patches', async () => {
    const existing = workbook('现有工作簿'),
      imported = workbook('导入工作簿'),
      parsed = deferred<Workbook>(),
      stored = deferred<void>();
    adapter.loadWorkbooks.mockResolvedValue([existing]);
    fileIO.importFile.mockReturnValue(parsed.promise);
    const app = mount();
    await app.settle();
    adapter.putWorkbook.mockReturnValueOnce(stored.promise);
    const input = app.all().find((node) => node.type === 'input' && node.props.type === 'file')!;
    const file = new File(['{}'], 'import.json', { type: 'application/json' });
    const handling = input.props.onChange({ target: { files: [file] } });
    app.render();
    expect(fileIO.importFile).toHaveBeenCalledExactlyOnceWith(file);
    expect(app.editor()?.props.workbook.id).toBe(existing.id);
    parsed.resolve(imported);
    await handling;
    await app.settle();
    expect(app.editor()?.props.workbook.id).toBe(imported.id);
    expect(adapter.putWorkbook).toHaveBeenCalledExactlyOnceWith(imported);
    const editor = app.editor()!;
    editor.props.onPatch(editor.props.sheet.id, [{ key: 'A1', cell: { value: '导入后编辑' } }]);
    app.render();
    await app.settle();
    expect(app.editor()?.props.sheet.cells.A1.value).toBe('导入后编辑');
    expect(adapter.queuePatch).not.toHaveBeenCalled();
    expect(app.visibleText()).toContain('正在保存');
    stored.resolve();
    await app.settle();
    expect(adapter.queuePatch).toHaveBeenCalledWith(imported.id, {
      kind: 'cell',
      sheetId: imported.sheets[0].id,
      key: 'A1',
      cell: { value: '导入后编辑' },
    });
    expect(adapter.putWorkbook.mock.calls[0][0].sheets[0].cells.A1.value).toBe(imported.id);
    expect(app.visibleText()).toContain('已保存到本地');
  });

  it('serializes adding a sheet, editing it immediately, undo, and redo without losing the new sheet base', async () => {
    const existing = workbook('连续编辑'),
      stored = deferred<void>();
    adapter.loadWorkbooks.mockResolvedValue([existing]);
    const app = mount();
    await app.settle();
    adapter.putWorkbook.mockReturnValueOnce(stored.promise);
    app.click('新增工作表');
    await app.settle();
    const added = app.editor()!;
    expect(added.props.workbook.sheets).toHaveLength(2);
    const sheetId = added.props.sheet.id;
    expect(sheetId).not.toBe(existing.sheets[0].id);
    added.props.onPatch(sheetId, [{ key: 'A1', cell: { value: '首笔数据' } }]);
    app.render();
    await app.settle();
    expect(adapter.putWorkbook).toHaveBeenCalledTimes(1);
    expect(adapter.putWorkbook.mock.calls[0][0].sheets[1].cells.A1).toBeUndefined();
    expect(adapter.queuePatch).not.toHaveBeenCalled();
    app.click('撤销');
    expect(app.editor()?.props.sheet.cells.A1).toBeUndefined();
    app.click('重做');
    expect(app.editor()?.props.sheet.cells.A1.value).toBe('首笔数据');
    stored.resolve();
    await app.settle();
    expect(adapter.putWorkbook).toHaveBeenCalledTimes(3);
    expect(adapter.queuePatch).toHaveBeenCalledWith(existing.id, {
      kind: 'cell',
      sheetId,
      key: 'A1',
      cell: { value: '首笔数据' },
    });
    const writes = adapter.putWorkbook.mock.calls.map(([book]) => book as Workbook);
    expect(writes[1].sheets[1].cells.A1).toBeUndefined();
    expect(writes[2].sheets[1].cells.A1.value).toBe('首笔数据');
    expect(adapter.putWorkbook.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.queuePatch.mock.invocationCallOrder[0],
    );
    expect(adapter.queuePatch.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.putWorkbook.mock.invocationCallOrder[1],
    );
    expect(app.visibleText()).toContain('已保存到本地');
  });
});
