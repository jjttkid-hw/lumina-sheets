import FormulaBar from '../src/components/FormulaBar';
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
vi.mock('../src/lib/persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/persistence')>()),
  getPersistence: () => adapter,
}));
const fileIO = vi.hoisted(() => ({ importFile: vi.fn(), exportWorkbook: vi.fn() }));
vi.mock('../src/lib/io', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/io')>()),
  importFile: fileIO.importFile,
  exportWorkbook: fileIO.exportWorkbook,
}));
const calculation = vi.hoisted(() => ({ calculate: vi.fn(), dispose: vi.fn() }));
const calculationFactory = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/calculation', () => ({ createCalculationRuntime: calculationFactory }));
const statistics = vi.hoisted(() => ({
  selection: vi.fn(),
  population: vi.fn(),
  analytics: vi.fn(),
}));
vi.mock('../src/lib/workspace-stats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/workspace-stats')>();
  return {
    readSelectionStats: (...args: Parameters<typeof actual.readSelectionStats>) => {
      statistics.selection();
      return actual.readSelectionStats(...args);
    },
    readSheetPopulation: (...args: Parameters<typeof actual.readSheetPopulation>) => {
      statistics.population();
      return actual.readSheetPopulation(...args);
    },
  };
});
vi.mock('../src/components/Analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/Analytics')>();
  return {
    ...actual,
    readWorkbookAnalytics: (...args: Parameters<typeof actual.readWorkbookAnalytics>) => {
      statistics.analytics(args[0].activeSheetId);
      return actual.readWorkbookAnalytics(...args);
    },
  };
});
import App from '../src/App';
import Spreadsheet from '../src/components/Spreadsheet';
import Modal from '../src/components/Modal';
import ValidationDialog from '../src/components/ValidationDialog';
import StructureDialog from '../src/components/StructureDialog';
import HyperlinkDialog from '../src/components/HyperlinkDialog';
import RichTextDialog from '../src/components/RichTextDialog';
import SheetRenameDialog from '../src/components/SheetRenameDialog';
import SortDialog from '../src/components/SortDialog';
import RecoveryDialog from '../src/components/RecoveryDialog';
import type { DataValidationRule } from '../src/lib/data-validation';
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
  calculation.calculate.mockImplementation(async (_book, _targets, revision) => ({
    revision,
    values: {},
  }));
  calculationFactory.mockReturnValue(calculation);
});
afterEach(() => {
  hooks.slots.forEach((slot) => slot?.cleanup?.());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('App workspace hydration and async record ownership', () => {
  it.each(['success', 'failure'] as const)(
    'does not update state or show notifications after an unmounted version save ends with %s',
    async (outcome) => {
      adapter.loadWorkbooks.mockResolvedValue([workbook('version-unmount')]);
      const gate = deferred<void>();
      adapter.saveRevisions.mockReturnValue(gate.promise);
      const app = mount();
      await app.settle();
      app.click('版本历史');
      await app.settle();
      app.click('保存版本');
      await app.settle();
      expect(adapter.saveRevisions).toHaveBeenCalledOnce();
      hooks.slots.forEach((slot) => {
        slot?.cleanup?.();
        if (slot) slot.cleanup = undefined;
      });
      hooks.dirty = false;
      if (outcome === 'success') gate.resolve();
      else gate.reject(new Error('late failure'));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(hooks.dirty).toBe(false);
    },
  );
  it.each(['comments', 'revisions'] as const)(
    'discards pending %s reads after unmount',
    async (kind) => {
      const book = workbook('read-unmount');
      adapter.loadWorkbooks.mockResolvedValue([book]);
      const gate = deferred<any[]>();
      (kind === 'comments' ? adapter.loadComments : adapter.loadRevisions).mockReturnValue(
        gate.promise,
      );
      const app = mount();
      await app.settle();
      app.click(kind === 'comments' ? '批注' : '版本历史');
      await app.settle();
      hooks.slots.forEach((slot) => {
        slot?.cleanup?.();
        if (slot) slot.cleanup = undefined;
      });
      hooks.dirty = false;
      gate.resolve(kind === 'comments' ? [comment(book)] : [revision(book)]);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(hooks.dirty).toBe(false);
    },
  );
  it('keeps the leave guard active for memory-only workspaces', async () => {
    adapter.stats.backend = 'memory';
    try {
      adapter.loadWorkbooks.mockResolvedValue([workbook('session-only')]);
      const app = mount();
      await app.settle();
      const guard = vi
        .mocked(window.addEventListener)
        .mock.calls.find(([name]) => name === 'beforeunload')![1] as (event: any) => void;
      const event = { preventDefault: vi.fn(), returnValue: undefined };
      guard(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.returnValue).toBe('');
    } finally {
      adapter.stats.backend = 'indexeddb';
    }
  });
  it('guards leaving while a Canvas or formula-bar draft is uncommitted', async () => {
    adapter.loadWorkbooks.mockResolvedValue([workbook('draft-guard')]);
    const app = mount();
    await app.settle();
    const guard = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([name]) => name === 'beforeunload')![1] as (event: any) => void;
    const leaving = () => {
      const event = { preventDefault: vi.fn(), returnValue: undefined };
      guard(event);
      return event;
    };
    expect(leaving().preventDefault).not.toHaveBeenCalled();
    const editor = app.editor()!;
    editor.props.onDraftStateChange(true);
    expect(leaving().preventDefault).toHaveBeenCalledOnce();
    const bar = app.all().find((node) => node.type === FormulaBar)!;
    bar.props.onDraftStateChange(true);
    expect(leaving().preventDefault).toHaveBeenCalledOnce();
    editor.props.onDraftStateChange(false);
    expect(leaving().preventDefault).toHaveBeenCalledOnce();
    bar.props.onDraftStateChange(false);
    expect(leaving().preventDefault).not.toHaveBeenCalled();
  });
  it('guards leaving during pending/failed saves and clears the guard after a successful durable retry', async () => {
    const book = workbook('unsaved');
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    const guard = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([name]) => name === 'beforeunload')![1] as (event: any) => void;
    const leaving = () => {
      const event = { preventDefault: vi.fn(), returnValue: undefined };
      guard(event);
      return event;
    };
    expect(leaving().preventDefault).not.toHaveBeenCalled();
    const gate = deferred<void>();
    adapter.putWorkbook.mockReturnValueOnce(gate.promise);
    app.click('更多工作簿操作');
    app.click('创建副本');
    expect(leaving().preventDefault).toHaveBeenCalledOnce();
    await app.settle();
    gate.reject(new Error('quota'));
    await app.settle();
    expect(leaving().preventDefault).toHaveBeenCalledOnce();
    app.click('重试保存');
    await app.settle();
    expect(leaving().preventDefault).not.toHaveBeenCalled();
    hooks.slots.forEach((slot) => slot?.cleanup?.());
    expect(window.removeEventListener).toHaveBeenCalledWith('beforeunload', guard);
  });
  it.each(['shared', 'duplicate'])(
    'keeps the %s copy suffix and name intact through workbook validation',
    async (kind) => {
      const original = workbook('long-name');
      const suffix = kind === 'shared' ? ' · 共享副本' : ' · 副本';
      const prefix = 'x'.repeat(200 - suffix.length - 1);
      original.name = `${prefix}😀${'y'.repeat(suffix.length - 1)}`;
      adapter.loadWorkbooks.mockResolvedValue([original]);
      if (kind === 'shared') {
        const encoded = btoa(
          String.fromCharCode(...new TextEncoder().encode(JSON.stringify(original))),
        );
        vi.stubGlobal('location', {
          hash: `#snapshot=${encodeURIComponent(encoded)}`,
          pathname: '/',
          search: '',
        });
      }
      const app = mount();
      await app.settle();
      if (kind === 'duplicate') {
        app.click('更多工作簿操作');
        app.click('创建副本');
        await app.settle();
      }
      const copy = app.editor()!.props.workbook;
      expect(copy.id).not.toBe(original.id);
      expect(copy.name).toBe(prefix + suffix);
      const { validateWorkbook } =
        await vi.importActual<typeof import('../src/lib/io')>('../src/lib/io');
      expect(validateWorkbook(copy).name).toBe(copy.name);
      expect(adapter.putWorkbook).toHaveBeenCalledExactlyOnceWith(copy);
    },
  );
  it.each(['encoding', 'structure', 'base64', 'empty'])(
    'ignores a %s-damaged shared link without saving fallback content or changing the active document',
    async (kind) => {
      const first = workbook('stored-first'),
        active = workbook('stored-active');
      adapter.loadWorkbooks.mockResolvedValue([first, active]);
      storage.set('lumina.v1.activeWorkbook', JSON.stringify(active.id));
      let encoded = '';
      if (kind === 'base64') encoded = '!invalid!';
      else if (kind !== 'empty') {
        const incoming = createBlankWorkbook('BYTE_MARKER');
        const json = kind === 'structure' ? '{"sheets":[]}' : JSON.stringify(incoming);
        const [prefix, suffix = ''] = json.split('BYTE_MARKER');
        const bytes = new Uint8Array([
          ...new TextEncoder().encode(prefix),
          ...(kind === 'encoding' ? [0xff] : []),
          ...new TextEncoder().encode(suffix),
        ]);
        encoded = btoa(String.fromCharCode(...bytes));
      }
      vi.stubGlobal('location', {
        hash: `#snapshot=${encodeURIComponent(encoded)}`,
        pathname: '/',
        search: '',
      });
      const app = mount();
      await app.settle();
      expect(app.editor()!.props.workbook.id).toBe(active.id);
      expect(adapter.putWorkbook).not.toHaveBeenCalled();
      expect(app.visibleText()).toContain('分享链接无效');
    },
  );
  it('keeps a valid Unicode shared copy active after hydration without replacing its local original', async () => {
    const original = workbook('local-original');
    original.name = '中文😀�';
    adapter.loadWorkbooks.mockResolvedValue([original]);
    const encoded = btoa(
      String.fromCharCode(...new TextEncoder().encode(JSON.stringify(original))),
    );
    vi.stubGlobal('location', {
      hash: `#snapshot=${encodeURIComponent(encoded)}`,
      pathname: '/',
      search: '',
    });
    const app = mount();
    await app.settle();
    const copy = app.editor()!.props.workbook;
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('中文😀� · 共享副本');
    expect(adapter.putWorkbook).toHaveBeenCalledExactlyOnceWith(copy);
    app.click(original.name);
    expect(app.editor()!.props.workbook.id).toBe(original.id);
  });
  it.each(['success', 'failure'] as const)(
    'cancels import promptly and ignores late %s without affecting a new import',
    async (kind) => {
      const original = workbook('原件'),
        old = deferred<Workbook>(),
        next = deferred<Workbook>();
      adapter.loadWorkbooks.mockResolvedValue([original]);
      fileIO.importFile.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
      const app = mount();
      await app.settle();
      const input = () =>
        app.all().find((node) => node.type === 'input' && node.props.type === 'file')!;
      const pending = input().props.onChange({ target: { files: [new File(['a'], 'old.csv')] } });
      app.render();
      app.click('取消文件操作');
      await pending;
      await app.settle();
      expect(app.visibleText()).not.toContain('正在处理文件');
      expect(app.editor()!.props.workbook.id).toBe(original.id);
      expect(adapter.putWorkbook).not.toHaveBeenCalled();
      const latest = input().props.onChange({ target: { files: [new File(['a'], 'new.csv')] } });
      app.render();
      if (kind === 'success') old.resolve(workbook('旧文件'));
      else old.reject(Error('迟到失败'));
      await app.settle();
      expect(app.visibleText()).toContain('正在处理文件');
      const imported = workbook('新文件');
      next.resolve(imported);
      await latest;
      await app.settle();
      expect(app.editor()!.props.workbook.id).toBe(imported.id);
      expect(adapter.putWorkbook).toHaveBeenCalledExactlyOnceWith(imported);
    },
  );

  it('cancels recovery-file reads without opening a stale selection dialog', async () => {
    adapter.loadWorkbooks.mockResolvedValue([workbook('原件')]);
    const app = mount();
    await app.settle();
    const gate = deferred<ArrayBuffer>();
    const file = new File(['{}'], 'recovery.json');
    vi.spyOn(file, 'arrayBuffer').mockReturnValue(gate.promise);
    const pending = app
      .all()
      .find((node) => node.type === 'input' && node.props.type === 'file')!
      .props.onChange({ target: { files: [file] } });
    app.render();
    app.click('取消文件操作');
    await pending;
    gate.resolve(
      new TextEncoder().encode(
        JSON.stringify({
          format: 'lumina-recovery',
          version: 1,
          records: [{ workbook: workbook('旧备份') }],
        }),
      ).buffer,
    );
    await app.settle();
    expect(app.all().some((node) => node.type === RecoveryDialog)).toBe(false);
    expect(fileIO.importFile).not.toHaveBeenCalled();
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'unmount'] as const)(
    'passes export cancellation and isolates the snapshot on %s',
    async (action) => {
      const original = workbook('原件'),
        pending = deferred<void>();
      adapter.loadWorkbooks.mockResolvedValue([original]);
      fileIO.exportWorkbook.mockReturnValue(pending.promise);
      const app = mount();
      await app.settle();
      app.click('导出');
      app.click('Excel 工作簿.xlsx');
      const [snapshot, , options] = fileIO.exportWorkbook.mock.lastCall!;
      expect(snapshot).not.toBe(app.editor()!.props.workbook);
      expect(snapshot.sheets[0].cells).not.toBe(app.editor()!.props.sheet.cells);
      if (action === 'cancel') app.click('取消文件操作');
      else
        hooks.slots.forEach((slot) => {
          slot?.cleanup?.();
          if (slot) slot.cleanup = undefined;
        });
      expect(options.signal.aborted).toBe(true);
      pending.resolve();
      if (action === 'cancel') {
        await app.settle();
        expect(app.visibleText()).not.toContain('文件已导出');
        expect(app.visibleText()).not.toContain('正在处理文件');
      }
    },
  );
  it('retains a stored paged snapshot as readonly and explains its incomplete content', async () => {
    const book = workbook('A');
    book.sheets[0].dataSource = { kind: 'paged', totalRows: 1000 };
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    expect(app.editor()!.props.readOnly).toBe(true);
    expect(app.editor()!.props.sheet.dataSource).toEqual(book.sheets[0].dataSource);
    expect(app.visibleText()).toContain('内容可能未完整加载');
    const editor = app.editor()!;
    expect(() =>
      editor.props.onPatch(editor.props.sheet.id, [{ key: 'A1', cell: { value: 'changed' } }]),
    ).toThrow('只读');
    app.render();
    expect(app.editor()!.props.sheet.cells.A1.value).toBe('A');
    expect(adapter.queuePatch).not.toHaveBeenCalled();
  });
  it('captures the clicked version, caps confirmed history at twenty and restores it with undo', async () => {
    const book = workbook('A'),
      write = deferred<void>();
    const stored = Array.from({ length: 20 }, (_, i) => ({
      ...revision(book),
      id: `r${i}`,
      name: `旧版本 ${i}`,
    }));
    adapter.loadWorkbooks.mockResolvedValue([book]);
    adapter.loadRevisions.mockResolvedValue(stored);
    adapter.saveRevisions.mockReturnValueOnce(write.promise);
    const app = mount();
    await app.settle();
    app.click('版本历史');
    await app.settle();
    app.click('保存版本');
    await app.settle();
    const captured = adapter.saveRevisions.mock.lastCall![1] as Revision[];
    expect(captured).toHaveLength(20);
    expect(captured.at(-1)!.id).toBe('r18');
    app.closeModal();
    const editor = app.editor()!;
    editor.props.onPatch(editor.props.sheet.id, [{ key: 'A1', cell: { value: 'later edit' } }]);
    app.render();
    await app.settle();
    expect(captured[0].workbook.sheets[0].cells.A1.value).toBe('A');
    adapter.loadRevisions.mockResolvedValue(captured);
    write.resolve();
    await app.settle();
    app.click('版本历史');
    await app.settle();
    expect(app.visibleText()).not.toContain('旧版本 19');
    app.click('恢复');
    await app.settle();
    expect(app.editor()!.props.sheet.cells.A1.value).toBe('A');
    app.click('撤销');
    await app.settle();
    expect(app.editor()!.props.sheet.cells.A1.value).toBe('later edit');
  });
  it('prevents overwriting unread history and retries a failed history read', async () => {
    const book = workbook('A'),
      read = deferred<Revision[]>();
    adapter.loadWorkbooks.mockResolvedValue([book]);
    adapter.loadRevisions.mockReturnValue(read.promise);
    const app = mount();
    await app.settle();
    app.click('版本历史');
    app.click('保存版本');
    await app.settle();
    expect(adapter.saveRevisions).not.toHaveBeenCalled();
    read.reject(new Error('read failure'));
    await app.settle();
    expect(app.visibleText()).toContain('版本历史读取失败');
    adapter.loadRevisions.mockResolvedValue([revision(book)]);
    app.click('重试读取版本历史');
    await app.settle();
    app.click('保存版本');
    await app.settle();
    expect(adapter.saveRevisions.mock.lastCall?.[1]).toHaveLength(2);
    expect(adapter.saveRevisions.mock.lastCall?.[1][1].id).toBe(revision(book).id);
  });
  it('keeps confirmed recovery points on save failure and suppresses duplicate saves', async () => {
    const book = workbook('A'),
      write = deferred<void>();
    adapter.loadWorkbooks.mockResolvedValue([book]);
    adapter.loadRevisions.mockResolvedValue([revision(book)]);
    adapter.saveRevisions.mockReturnValueOnce(write.promise);
    const app = mount();
    await app.settle();
    app.click('版本历史');
    await app.settle();
    const save = app.all().find((n) => n.type === 'button' && text(n) === '保存版本')!.props
      .onClick;
    save();
    save();
    app.render();
    await app.settle();
    expect(adapter.saveRevisions).toHaveBeenCalledOnce();
    expect(app.visibleText()).not.toContain('已保存当前版本');
    expect(app.visibleText()).not.toContain('手动保存 ·');
    app.closeModal();
    const reads = adapter.loadRevisions.mock.calls.length;
    app.click('版本历史');
    expect(adapter.loadRevisions).toHaveBeenCalledTimes(reads);
    write.reject(new Error('quota'));
    await app.settle();
    expect(app.visibleText()).toContain('已有恢复点未更改');
    expect(app.visibleText()).toContain('A的历史');
    app.click('保存版本');
    await app.settle();
    expect(adapter.saveRevisions.mock.lastCall?.[1]).toHaveLength(2);
    expect(app.visibleText()).toContain('已保存当前版本');
  });
  it('waits for pending version writes on A→B→A and rejects stale save callbacks', async () => {
    const a = workbook('A'),
      b = workbook('B'),
      write = deferred<void>();
    let stored = [revision(a)];
    adapter.loadWorkbooks.mockResolvedValue([a, b]);
    adapter.loadRevisions.mockImplementation(async (id: string) =>
      id === a.id ? stored : [revision(b)],
    );
    adapter.saveRevisions.mockImplementationOnce(async (_id: string, items: Revision[]) => {
      await write.promise;
      stored = items;
    });
    const app = mount();
    await app.settle();
    app.click('版本历史');
    await app.settle();
    const oldSave = app.all().find((n) => n.type === 'button' && text(n) === '保存版本')!.props
      .onClick;
    app.click('保存版本');
    await app.settle();
    app.closeModal();
    app.click(b.name);
    await app.settle();
    app.click(a.name);
    await app.settle();
    app.click('版本历史');
    await app.settle();
    expect(app.visibleText()).toContain('正在读取版本历史');
    write.resolve();
    await app.settle();
    expect(app.visibleText()).toContain('手动保存 ·');
    oldSave();
    await app.settle();
    expect(adapter.saveRevisions).toHaveBeenCalledOnce();
  });
  it.each(['history', 'comments'])(
    'shows a recoverable read error for malformed %s records instead of rendering them',
    async (kind) => {
      const book = workbook('A');
      adapter.loadWorkbooks.mockResolvedValue([book]);
      const read = kind === 'history' ? adapter.loadRevisions : adapter.loadComments;
      read.mockResolvedValue([null]);
      const app = mount();
      await app.settle();
      app.click(kind === 'history' ? '版本历史' : '批注');
      await app.settle();
      expect(app.visibleText()).toContain(kind === 'history' ? '版本历史读取失败' : '批注读取失败');
      expect(adapter.saveRevisions).not.toHaveBeenCalled();
      expect(adapter.saveComments).not.toHaveBeenCalled();
      read.mockResolvedValue(kind === 'history' ? [revision(book)] : [comment(book)]);
      app.click(kind === 'history' ? '重试读取版本历史' : '重试读取批注');
      await app.settle();
      expect(app.visibleText()).not.toContain('读取失败');
    },
  );
  it.each(['missing-sheet', 'outside', 'hidden'])(
    'keeps the current sheet and comments panel when a comment target is %s',
    async (kind) => {
      const book = workbook('A');
      const note = comment(book);
      if (kind === 'missing-sheet') note.sheetId = 'deleted';
      if (kind === 'outside') note.cell = 'XFD1048576';
      if (kind === 'hidden') book.sheets[0].hiddenRows = [0];
      adapter.loadWorkbooks.mockResolvedValue([book]);
      adapter.loadComments.mockResolvedValue([note]);
      const app = mount();
      await app.settle();
      app.click('批注');
      await app.settle();
      const before = structuredClone(app.editor()!.props.workbook);
      const selection = app.editor()!.props.selection;
      adapter.putWorkbook.mockClear();
      app
        .all()
        .find((n) => n.props.className === 'comment-cell')!
        .props.onClick();
      await app.settle();
      expect(app.editor()!.props.workbook).toEqual(before);
      expect(app.editor()!.props.selection).toEqual(selection);
      expect(app.all().some((n) => n.props.title === '把想法留在数据旁')).toBe(true);
      expect(app.visibleText()).toContain(kind === 'hidden' ? '隐藏' : '不存在');
      expect(adapter.putWorkbook).not.toHaveBeenCalled();
    },
  );
  it('navigates a valid cross-sheet comment to its merged anchor', async () => {
    const book = workbook('A');
    const destination = structuredClone(book.sheets[0]);
    destination.id = 'destination';
    destination.name = 'Destination';
    destination.merges = [{ start: { row: 2, col: 2 }, end: { row: 3, col: 3 } }];
    book.sheets.push(destination);
    adapter.loadWorkbooks.mockResolvedValue([book]);
    adapter.loadComments.mockResolvedValue([
      { ...comment(book), sheetId: destination.id, cell: 'D4' },
    ]);
    const app = mount();
    await app.settle();
    app.click('批注');
    await app.settle();
    app
      .all()
      .find((n) => n.props.className === 'comment-cell')!
      .props.onClick();
    await app.settle();
    expect(app.editor()!.props.sheet.id).toBe(destination.id);
    expect(app.editor()!.props.selection).toEqual({ row: 2, col: 2 });
    expect(app.all().some((n) => n.props.title === '把想法留在数据旁')).toBe(false);
  });
  it('retains the recycle-bin copy until its restored snapshot is saved, including on failure', async () => {
    const active = workbook('A'),
      archived = workbook('Archived');
    const raw = JSON.stringify([archived]);
    storage.set('lumina.v1.trash', raw);
    adapter.loadWorkbooks.mockResolvedValue([active]);
    const app = mount();
    await app.settle();
    const write = deferred<void>();
    adapter.putWorkbook.mockImplementationOnce(() => write.promise);
    app
      .all()
      .find((n) => String(n.props.className).includes('trash-nav'))!
      .props.onClick();
    app.render();
    app.click('恢复工作簿');
    await app.settle();
    expect(storage.get('lumina.v1.trash')).toBe(raw);
    expect(app.visibleText()).toContain(archived.name);
    write.reject(new Error('quota'));
    await app.settle();
    expect(storage.get('lumina.v1.trash')).toBe(raw);
    expect(app.visibleText()).toContain('恢复失败');
    adapter.putWorkbook.mockResolvedValue(undefined);
    app.click('恢复工作簿');
    await app.settle();
    expect(storage.get('lumina.v1.trash')).toBe('[]');
    expect(app.editor()!.props.workbook.id).toBe(archived.id);
    expect(app.visibleText()).toContain('工作簿已恢复');
  });
  it('retains the recycle-bin source when cleanup fails after the restored snapshot is saved', async () => {
    const active = workbook('A'),
      archived = workbook('Archived');
    const raw = JSON.stringify([archived]);
    storage.set('lumina.v1.trash', raw);
    adapter.loadWorkbooks.mockResolvedValue([active]);
    const app = mount();
    await app.settle();
    const original = localStorage.setItem;
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'lumina.v1.trash') throw new Error('denied');
      original(key, value);
    });
    app
      .all()
      .find((n) => String(n.props.className).includes('trash-nav'))!
      .props.onClick();
    app.render();
    app.click('恢复工作簿');
    await app.settle();
    expect(adapter.putWorkbook).toHaveBeenCalledWith(expect.objectContaining({ id: archived.id }));
    expect(storage.get('lumina.v1.trash')).toBe(raw);
    expect(app.visibleText()).toContain('回收站更新失败');
  });
  it('keeps a newer recycle-bin snapshot if it changes during restoration', async () => {
    const active = workbook('A'),
      archived = workbook('Archived');
    storage.set('lumina.v1.trash', JSON.stringify([archived]));
    adapter.loadWorkbooks.mockResolvedValue([active]);
    const app = mount();
    await app.settle();
    const write = deferred<void>();
    adapter.putWorkbook.mockImplementationOnce(() => write.promise);
    app
      .all()
      .find((n) => String(n.props.className).includes('trash-nav'))!
      .props.onClick();
    app.render();
    app.click('恢复工作簿');
    await app.settle();
    const newer = structuredClone(archived);
    newer.sheets[0].cells.A1 = { value: 'newer archive' };
    const raw = JSON.stringify([newer]);
    storage.set('lumina.v1.trash', raw);
    write.resolve();
    await app.settle();
    expect(storage.get('lumina.v1.trash')).toBe(raw);
    expect(app.visibleText()).toContain('恢复失败');
  });
  it('archives the latest edited workbook and current directory after the browser lock is granted', async () => {
    const book = workbook('A'),
      other = workbook('Other');
    adapter.loadWorkbooks.mockResolvedValue([book]);
    let enter!: () => void;
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          (_name, _options, callback) =>
            new Promise<void>((resolve) => {
              enter = () => {
                callback();
                resolve();
              };
            }),
        ),
      },
    });
    const app = mount();
    await app.settle();
    app.click('更多工作簿操作');
    app.click('移到回收站');
    expect(storage.has('lumina.v1.trash')).toBe(false);
    const editor = app.editor()!;
    editor.props.onPatch(editor.props.sheet.id, [
      { key: 'A1', cell: { value: 'edited while waiting' } },
    ]);
    await app.settle();
    storage.set('lumina.v1.trash', JSON.stringify([other]));
    enter();
    await app.settle();
    const saved = JSON.parse(storage.get('lumina.v1.trash')!);
    expect(saved.map((item: Workbook) => item.id)).toEqual([book.id, other.id]);
    expect(saved[0].sheets[0].cells.A1.value).toBe('edited while waiting');
    expect(app.editor()!.props.workbook.id).not.toBe(book.id);
  });
  it('checks the restore source again inside the cleanup lock', async () => {
    const active = workbook('A'),
      archived = workbook('Archived');
    storage.set('lumina.v1.trash', JSON.stringify([archived]));
    adapter.loadWorkbooks.mockResolvedValue([active]);
    let enter!: () => void;
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          (_name, _options, callback) =>
            new Promise<void>((resolve, reject) => {
              enter = () => {
                try {
                  callback();
                  resolve();
                } catch (error) {
                  reject(error);
                }
              };
            }),
        ),
      },
    });
    const app = mount();
    await app.settle();
    app
      .all()
      .find((n) => String(n.props.className).includes('trash-nav'))!
      .props.onClick();
    app.render();
    app.click('恢复工作簿');
    await app.settle();
    expect(enter).toBeTypeOf('function');
    const raw = JSON.stringify([{ ...archived, name: 'changed while waiting' }]);
    storage.set('lumina.v1.trash', raw);
    enter();
    await app.settle();
    expect(storage.get('lumina.v1.trash')).toBe(raw);
    expect(app.visibleText()).toContain('恢复失败');
  });
  it.each(['null', '{}', '[null]', '[{"id":"bad"}]', 'broken json'])(
    'shows a recoverable startup error for damaged recycle-bin data %s without rewriting it',
    async (raw) => {
      const book = workbook('A');
      storage.set('lumina.v1.trash', raw);
      adapter.loadWorkbooks.mockResolvedValue([book]);
      const app = mount();
      await app.settle();
      expect(app.visibleText()).toContain('回收站');
      expect(app.visibleText()).toContain('读取失败');
      expect(adapter.putWorkbook).not.toHaveBeenCalled();
      expect(storage.get('lumina.v1.trash')).toBe(raw);
      storage.set('lumina.v1.trash', '[]');
      app.click('重试读取');
      await app.settle();
      expect(app.editor()!.props.workbook.id).toBe(book.id);
    },
  );
  it('does not save stale fallback content over an unreadable primary workbook and permits retry', async () => {
    const old = workbook('旧版本');
    storage.set('lumina.v1.workbooks', JSON.stringify([old]));
    const damaged = { ...structuredClone(old), sheets: [] };
    adapter.loadWorkbooks.mockResolvedValue([damaged]);
    const app = mount();
    await app.settle();
    expect(app.visibleText()).toContain('工作簿内容损坏');
    expect(app.editor()).toBeUndefined();
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    expect(storage.get('lumina.v1.workbooks')).toBe(JSON.stringify([old]));
    const repaired = structuredClone(old);
    repaired.sheets[0].cells.A1 = { value: '新内容' };
    adapter.loadWorkbooks.mockResolvedValue([repaired]);
    app.click('重试读取');
    await app.settle();
    expect(app.editor()!.props.workbook.sheets[0].cells.A1.value).toBe('新内容');
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
  });
  it('opens valid primary documents with a warning when another document is damaged', async () => {
    const good = workbook('可用文档');
    adapter.loadWorkbooks.mockResolvedValue([null, good] as any);
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rescue');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const app = mount();
    await app.settle();
    expect(app.editor()!.props.workbook.id).toBe(good.id);
    expect(app.visibleText()).toContain('1 本工作簿未能打开');
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    app.click('下载恢复备份');
    await app.settle();
    expect(link.click).toHaveBeenCalledOnce();
    const bundle = JSON.parse(await (create.mock.calls[0][0] as Blob).text());
    expect(bundle.records.map((record: any) => record.workbook)).toEqual([null, good]);
    expect(app.visibleText()).toContain('已导出部分数据');
    expect(app.editor()!.props.workbook.id).toBe(good.id);
  });
  it('downloads a partial recovery bundle from failed startup and retains raw recycle-bin data', async () => {
    const book = workbook('A');
    storage.set('lumina.v1.trash', '{broken');
    Object.defineProperty(localStorage, 'length', { get: () => storage.size });
    (localStorage as any).key = (index: number) => [...storage.keys()][index] ?? null;
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rescue');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const app = mount();
    await app.settle();
    app.click('下载恢复备份');
    await app.settle();
    expect(link.click).toHaveBeenCalledOnce();
    const bundle = JSON.parse(await (create.mock.calls[0][0] as Blob).text());
    expect(bundle.complete).toBe(false);
    expect(bundle.records[0].workbook.id).toBe(book.id);
    expect(bundle.legacy['lumina.v1.trash']).toBe('{broken');
    expect(app.visibleText()).toContain('已导出部分数据');
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
  });
  it('downloads legacy rescue data when the primary workbook directory is malformed', async () => {
    const book = workbook('可救援');
    const damaged = { unexpected: 'directory' };
    storage.set('lumina.v1.trash', JSON.stringify([book]));
    Object.defineProperty(localStorage, 'length', { get: () => storage.size });
    (localStorage as any).key = (index: number) => [...storage.keys()][index] ?? null;
    adapter.loadWorkbooks.mockResolvedValue(damaged as any);
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rescue');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const app = mount();
    await app.settle();
    app.click('下载恢复备份');
    await app.settle();
    expect(link.click).toHaveBeenCalledOnce();
    const bundle = JSON.parse(await (create.mock.calls[0][0] as Blob).text());
    expect(bundle.complete).toBe(false);
    expect(bundle.records).toEqual([]);
    expect(bundle.damagedWorkbookDirectory).toEqual(damaged);
    expect(bundle.legacy['lumina.v1.trash']).toBe(JSON.stringify([book]));
    expect(app.visibleText()).toContain('已导出部分数据');
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
  });
  it('discards a pending startup recovery download after a successful retry', async () => {
    const book = workbook('A');
    storage.set('lumina.v1.trash', '{broken');
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const create = vi.spyOn(URL, 'createObjectURL');
    const app = mount();
    await app.settle();
    const pending = deferred<Workbook[]>();
    adapter.loadWorkbooks.mockReturnValueOnce(pending.promise);
    app.click('下载恢复备份');
    await app.settle();
    expect(app.visibleText()).toContain('正在准备恢复备份');
    storage.set('lumina.v1.trash', '[]');
    app.click('重试读取');
    await app.settle();
    expect(app.editor()!.props.workbook.id).toBe(book.id);
    pending.resolve([book]);
    await app.settle();
    expect(create).not.toHaveBeenCalled();
  });
  it.each(['foreign', 'invalid'])(
    'rejects %s recovery points without changing workbook, saves or undo history',
    async (kind) => {
      const book = workbook('A');
      const point = revision(kind === 'foreign' ? workbook('B') : book);
      point.workbook = structuredClone(point.workbook);
      if (kind === 'invalid') point.workbook.sheets[0].rowCount = 0;
      adapter.loadWorkbooks.mockResolvedValue([book]);
      adapter.loadRevisions.mockResolvedValue([point]);
      const app = mount();
      await app.settle();
      app.click('版本历史');
      await app.settle();
      const before = structuredClone(app.editor()!.props.workbook);
      adapter.putWorkbook.mockClear();
      app.click('恢复');
      await app.settle();
      expect(app.editor()!.props.workbook).toEqual(before);
      expect(adapter.putWorkbook).not.toHaveBeenCalled();
      expect(app.all().some((n) => n.props.role === 'alert')).toBe(true);
      app.closeModal();
      app.click('撤销');
      expect(app.editor()!.props.workbook).toEqual(before);
    },
  );
  it('blocks comment writes until a successful read and retries failed reads without replacing old comments', async () => {
    const book = workbook('A');
    const read = deferred<Comment[]>();
    adapter.loadWorkbooks.mockResolvedValue([book]);
    adapter.loadComments.mockReturnValue(read.promise);
    const app = mount();
    await app.settle();
    app.click('批注');
    const input = () => app.all().find((n) => n.props.className === 'comment-input')!;
    expect(input().props.disabled).toBe(true);
    input().props.onChange({ target: { value: 'new' } });
    app.render();
    app.click('添加批注');
    await app.settle();
    expect(adapter.saveComments).not.toHaveBeenCalled();
    read.reject(new Error('read failed'));
    await app.settle();
    expect(app.visibleText()).toContain('批注读取失败');
    adapter.loadComments.mockResolvedValue([comment(book)]);
    app.click('重试读取批注');
    await app.settle();
    expect(input().props.disabled).toBe(false);
    app.click('添加批注');
    await app.settle();
    expect(adapter.saveComments.mock.lastCall?.[1].map((c: Comment) => c.text)).toEqual([
      'A的批注',
      'new',
    ]);
  });
  it('keeps the comment draft and confirmed list on write failure, then retries once', async () => {
    const book = workbook('A');
    const write = deferred<void>();
    adapter.loadWorkbooks.mockResolvedValue([book]);
    adapter.loadComments.mockResolvedValue([comment(book)]);
    adapter.saveComments.mockReturnValueOnce(write.promise);
    const app = mount();
    await app.settle();
    app.click('批注');
    await app.settle();
    const input = () => app.all().find((n) => n.props.className === 'comment-input')!;
    input().props.onChange({ target: { value: 'draft' } });
    app.render();
    const add = app.all().find((n) => n.type === 'button' && text(n) === '添加批注')!;
    add.props.onClick();
    add.props.onClick();
    app.render();
    await app.settle();
    expect(adapter.saveComments).toHaveBeenCalledOnce();
    expect(input().props.disabled).toBe(true);
    expect(app.visibleText()).not.toContain('批注已保存');
    app.closeModal();
    const reads = adapter.loadComments.mock.calls.length;
    app.click('批注');
    expect(adapter.loadComments).toHaveBeenCalledTimes(reads);
    write.reject(new Error('quota'));
    await app.settle();
    expect(input().props.value).toBe('draft');
    expect(app.visibleText()).toContain('批注保存失败');
    expect(app.visibleText()).toContain('A的批注');
    app.click('添加批注');
    await app.settle();
    expect(adapter.saveComments).toHaveBeenCalledTimes(2);
    expect(input().props.value).toBe('');
    expect(app.visibleText()).toContain('批注已保存');
  });
  it('does not mark a comment resolved until storage succeeds', async () => {
    const book = workbook('A');
    adapter.loadWorkbooks.mockResolvedValue([book]);
    adapter.loadComments.mockResolvedValue([comment(book)]);
    adapter.saveComments.mockRejectedValueOnce(new Error('quota'));
    const app = mount();
    await app.settle();
    app.click('批注');
    await app.settle();
    app.click('标记已解决');
    await app.settle();
    expect(app.visibleText()).toContain('A的批注');
    expect(app.visibleText()).toContain('批注保存失败');
    app.click('标记已解决');
    await app.settle();
    expect(app.visibleText()).not.toContain('A的批注');
    expect(adapter.saveComments.mock.lastCall?.[1][0].resolved).toBe(true);
  });
  it('waits for an outstanding comment save when returning to its workbook and ignores old handlers', async () => {
    const a = workbook('A'),
      b = workbook('B');
    const write = deferred<void>();
    let stored = [comment(a)];
    adapter.loadWorkbooks.mockResolvedValue([a, b]);
    adapter.loadComments.mockImplementation(async (id: string) =>
      id === a.id ? stored : [comment(b)],
    );
    adapter.saveComments.mockImplementationOnce(async (_id: string, items: Comment[]) => {
      await write.promise;
      stored = items;
    });
    const app = mount();
    await app.settle();
    app.click('批注');
    await app.settle();
    app
      .all()
      .find((n) => n.props.className === 'comment-input')!
      .props.onChange({ target: { value: 'saved A' } });
    app.render();
    const oldAdd = app.all().find((n) => n.type === 'button' && text(n) === '添加批注')!.props
      .onClick;
    app.click('添加批注');
    await app.settle();
    app.closeModal();
    app.click(b.name);
    await app.settle();
    oldAdd();
    expect(adapter.saveComments).toHaveBeenCalledOnce();
    app.click(a.name);
    await app.settle();
    const reads = adapter.loadComments.mock.calls.length;
    app.click('批注');
    await app.settle();
    expect(adapter.loadComments).toHaveBeenCalledTimes(reads);
    expect(app.visibleText()).toContain('正在读取批注');
    write.resolve();
    await app.settle();
    expect(app.visibleText()).toContain('saved A');
    expect(app.visibleText()).not.toContain('B的批注');
    oldAdd();
    await app.settle();
    expect(adapter.saveComments).toHaveBeenCalledOnce();
    expect(app.all().find((n) => n.props.className === 'comment-input')!.props.disabled).toBe(
      false,
    );
  });
  it('rejects damaged recovery bytes before opening a dialog or saving a corrupted copy', async () => {
    const original = workbook('保留原件');
    adapter.loadWorkbooks.mockResolvedValue([original]);
    const app = mount();
    await app.settle();
    adapter.putWorkbook.mockClear();
    const backup = {
      format: 'lumina-recovery',
      version: 1,
      complete: true,
      records: [{ workbook: { ...workbook('incoming'), name: 'BYTE_MARKER' } }],
    };
    const [prefix, suffix] = JSON.stringify(backup).split('BYTE_MARKER');
    const input = () =>
      app.all().find((node) => node.type === 'input' && node.props.type === 'file')!;
    await input().props.onChange({
      target: { files: [new File([prefix, new Uint8Array([0xff]), suffix], 'backup.json')] },
    });
    await app.settle();
    expect(app.visibleText()).toContain('UTF-8');
    expect(app.all().some((node) => node.type === RecoveryDialog)).toBe(false);
    expect(app.editor()!.props.workbook).toEqual(original);
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    expect(fileIO.importFile).not.toHaveBeenCalled();
    const valid = new File(
      ['\uFEFF', JSON.stringify(backup).replace('BYTE_MARKER', '中文😀�')],
      'backup.json',
    );
    await input().props.onChange({ target: { files: [valid] } });
    await app.settle();
    const dialog = app.all().find((node) => node.type === RecoveryDialog)!;
    expect(dialog.props.backup.records[0].name).toBe('中文😀�');
    dialog.props.onRestore(0);
    await app.settle();
    expect(app.editor()!.props.workbook.name).toBe('中文😀�（恢复副本）');
    expect(adapter.putWorkbook).toHaveBeenCalledOnce();
  });
  it('previews recovery records and restores only the selected workbook as a new saved copy', async () => {
    const original = workbook('恢复原件');
    original.sheets[0].dataValidations = [
      {
        id: 'positive',
        sheetId: original.sheets[0].id,
        kind: 'whole',
        operator: 'greaterThan',
        value: 0,
        range: { start: { row: 0, col: 0 }, end: { row: 2, col: 0 } },
      },
    ];
    adapter.loadWorkbooks.mockResolvedValue([original]);
    const app = mount();
    await app.settle();
    adapter.putWorkbook.mockClear();
    const file = new File(
      [
        JSON.stringify({
          format: 'lumina-recovery',
          version: 1,
          complete: false,
          warnings: ['partial'],
          records: [
            { workbook: { name: '损坏' } },
            { workbook: original, comments: [{ text: 'do not import' }] },
          ],
        }),
      ],
      'recovery.json',
    );
    await app
      .all()
      .find((node) => node.type === 'input' && node.props.type === 'file')!
      .props.onChange({ target: { files: [file] } });
    app.render();
    const dialog = app.all().find((node) => node.type === RecoveryDialog)!;
    expect(dialog.props.backup.partial).toBe(true);
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    expect(() => dialog.props.onRestore(0)).toThrow();
    expect(app.editor()!.props.workbook.id).toBe(original.id);
    dialog.props.onRestore(1);
    app.render();
    await app.settle();
    const recovered = app.editor()!.props.workbook;
    expect(recovered.id).not.toBe(original.id);
    expect(recovered.sheets[0].dataValidations[0].sheetId).toBe(recovered.sheets[0].id);
    expect(adapter.putWorkbook).toHaveBeenCalledExactlyOnceWith(recovered);
    expect(adapter.saveComments).not.toHaveBeenCalled();
    app.click(original.name);
    expect(app.editor()!.props.workbook.id).toBe(original.id);
  });
  it('imports legacy historical snapshots as saved independent workbooks without merging auxiliary data', async () => {
    const original = workbook('当前文档');
    const archived = structuredClone(original);
    archived.name = '归档版本';
    archived.sheets[0].cells.A1 = { value: 123 };
    adapter.loadWorkbooks.mockResolvedValue([original]);
    const app = mount();
    await app.settle();
    adapter.putWorkbook.mockClear();
    const storageBefore = JSON.stringify(localStorage);
    const file = new File(
      [
        JSON.stringify({
          format: 'lumina-recovery',
          version: 1,
          complete: false,
          records: [],
          legacy: {
            'lumina.v1.workbooks': '{broken',
            'lumina.v1.history.archived': JSON.stringify([
              { name: 'checkpoint', createdAt: archived.updatedAt, workbook: archived },
            ]),
          },
        }),
      ],
      'rescue.json',
    );
    await app
      .all()
      .find((node) => node.type === 'input' && node.props.type === 'file')!
      .props.onChange({ target: { files: [file] } });
    app.render();
    const dialog = app.all().find((node) => node.type === RecoveryDialog)!;
    expect(dialog.props.backup.records[0].source).toBe('旧版历史');
    expect(dialog.props.backup.directoryWarnings).toHaveLength(1);
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    dialog.props.onRestore(0);
    app.render();
    await app.settle();
    const copy = app.editor()!.props.workbook;
    expect(copy.name).toBe('归档版本（恢复副本）');
    expect(copy.id).not.toBe(original.id);
    expect(copy.sheets[0].cells.A1.value).toBe(123);
    expect(adapter.putWorkbook).toHaveBeenCalledExactlyOnceWith(copy);
    expect(adapter.saveComments).not.toHaveBeenCalled();
    expect(JSON.stringify(localStorage)).toBe(storageBefore);
  });
  it('ignores a recovery file that finishes reading after a newer ordinary import', async () => {
    const original = workbook('旧文档');
    adapter.loadWorkbooks.mockResolvedValue([original]);
    const app = mount();
    await app.settle();
    const pending = deferred<ArrayBuffer>();
    const file = new File(['{}'], 'late-recovery.json');
    vi.spyOn(file, 'arrayBuffer').mockReturnValue(pending.promise);
    const input = () =>
      app.all().find((node) => node.type === 'input' && node.props.type === 'file')!;
    const first = input().props.onChange({ target: { files: [file] } });
    fileIO.importFile.mockResolvedValue(workbook('最新导入'));
    await input().props.onChange({ target: { files: [new File(['a'], 'latest.csv')] } });
    pending.resolve(
      new TextEncoder().encode(
        JSON.stringify({
          format: 'lumina-recovery',
          version: 1,
          records: [{ workbook: original }],
        }),
      ).buffer,
    );
    await first;
    app.render();
    await app.settle();
    expect(app.editor()!.props.workbook.name).toBe('最新导入');
    expect(app.all().some((node) => node.type === RecoveryDialog)).toBe(false);
  });
  it('cancels recovery selection without writes and rejects oversized files before reading', async () => {
    const original = workbook('保留原件');
    adapter.loadWorkbooks.mockResolvedValue([original]);
    const app = mount();
    await app.settle();
    adapter.putWorkbook.mockClear();
    const input = () =>
      app.all().find((node) => node.type === 'input' && node.props.type === 'file')!;
    await input().props.onChange({
      target: {
        files: [
          new File(
            [
              JSON.stringify({
                format: 'lumina-recovery',
                version: 1,
                records: [{ workbook: original }],
              }),
            ],
            'backup.json',
          ),
        ],
      },
    });
    app.render();
    app
      .all()
      .find((node) => node.type === RecoveryDialog)!
      .props.onClose();
    app.render();
    expect(app.all().some((node) => node.type === RecoveryDialog)).toBe(false);
    expect(app.editor()!.props.workbook.id).toBe(original.id);
    const oversized = new File(['{}'], 'large.json');
    Object.defineProperty(oversized, 'size', { value: 21 * 1024 * 1024 });
    const read = vi.spyOn(oversized, 'arrayBuffer');
    await input().props.onChange({ target: { files: [oversized] } });
    app.render();
    expect(read).not.toHaveBeenCalled();
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    expect(app.visibleText()).toContain('20 MB');
  });
  it('commits row structure and cross-sheet formulas in one saved undo step', async () => {
    const book = workbook('结构操作');
    const sheet = book.sheets[0];
    sheet.name = '明细';
    sheet.cells = { A1: { value: 10 }, A2: { value: 20 }, B2: { value: '=A2*2' } };
    sheet.hiddenRows = [1];
    sheet.rowHeights = { 1: 48 };
    sheet.dataValidations = [
      {
        id: 'amount',
        kind: 'whole',
        value: 0,
        operator: 'greaterThan',
        range: { start: { row: 1, col: 0 }, end: { row: 2, col: 0 } },
      },
    ];
    book.sheets.push({
      id: 'summary',
      name: '汇总',
      rowCount: 100,
      colCount: 16,
      cells: { A1: { value: "='明细'!A2" } },
    });
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    adapter.putWorkbook.mockClear();
    app.click('插入或删除行列');
    app
      .all()
      .find((node) => node.type === StructureDialog)!
      .props.onApply({ axis: 'row', kind: 'insert', index: 1, count: 2 });
    app.render();
    await app.settle();
    const updated = app.editor()!.props.sheet;
    expect(updated.cells.B4.value).toBe('=A4*2');
    expect(updated.hiddenRows).toEqual([3]);
    expect(updated.rowHeights).toEqual({ 3: 48 });
    expect(updated.dataValidations[0].range.start.row).toBe(3);
    expect(app.editor()!.props.selection).toEqual({ row: 1, col: 3 });
    expect(adapter.putWorkbook).toHaveBeenCalledOnce();
    expect(adapter.putWorkbook.mock.lastCall![0].sheets[1].cells.A1.value).toBe("='明细'!A4");
    app.click('撤销');
    await app.settle();
    expect(app.editor()!.props.sheet.cells.B2.value).toBe('=A2*2');
    expect(adapter.putWorkbook.mock.lastCall![0].sheets[1].cells.A1.value).toBe("='明细'!A2");
    app.click('重做');
    await app.settle();
    expect(app.editor()!.props.sheet.cells.B4.value).toBe('=A4*2');
    expect(app.all().some((node) => node.type === StructureDialog)).toBe(false);
  });
  it.each(['详情', ''])(
    'moves a link labelled %j to the merge master and preserves XLSX export and undo',
    async (label) => {
      // ExcelJS/ZIP streams need real timers; the surrounding App-only tests
      // normally freeze timers to keep notifications deterministic.
      vi.useRealTimers();
      const book = workbook('合并链接');
      const source = {
        value: label,
        style: { bold: true },
        hyperlink: { target: 'https://example.com', tooltip: '来源' },
      };
      book.sheets[0].cells = { B1: source };
      adapter.loadWorkbooks.mockResolvedValue([book]);
      const app = mount();
      await app.settle();
      app.editor()!.props.onSelect({ row: 0, col: 0, endRow: 0, endCol: 1 });
      app.render();
      app.click('合并或取消合并单元格');
      await app.settle();
      const merged = app.editor()!.props.sheet;
      expect(merged.cells.A1).toEqual(source);
      expect(merged.cells.B1).toEqual({ value: '', style: { bold: true } });
      expect(merged.merges).toEqual([{ start: { row: 0, col: 0 }, end: { row: 0, col: 1 } }]);
      const { workbookToXlsx, workbookFromXlsx } = await import('../src/lib/io');
      const imported = await workbookFromXlsx(await workbookToXlsx({ ...book, sheets: [merged] }));
      expect(imported.sheets[0].cells.A1.hyperlink).toEqual(source.hyperlink);
      app.click('撤销');
      await app.settle();
      expect(app.editor()!.props.sheet.cells).toEqual(book.sheets[0].cells);
      expect(app.editor()!.props.sheet.merges ?? []).toEqual([]);
      app.click('重做');
      await app.settle();
      expect(app.editor()!.props.sheet.cells).toEqual(merged.cells);
      expect(app.editor()!.props.sheet.merges).toEqual(merged.merges);
    },
  );
  it.each([true, false])(
    'refuses a merge containing text and an empty-label link (link at master: %s)',
    async (linkAtMaster) => {
      const book = workbook('保留空文字链接');
      const link = { value: '', hyperlink: { target: 'https://example.com' } };
      const text = { value: '已有内容' };
      book.sheets[0].cells = { A1: linkAtMaster ? link : text, B1: linkAtMaster ? text : link };
      adapter.loadWorkbooks.mockResolvedValue([book]);
      const app = mount();
      await app.settle();
      app.editor()!.props.onSelect({ row: 0, col: 0, endRow: 0, endCol: 1 });
      app.render();
      const original = app.editor()!.props.sheet;
      adapter.queuePatch.mockClear();
      adapter.putWorkbook.mockClear();
      app.click('合并或取消合并单元格');
      await app.settle();
      expect(app.editor()!.props.sheet).toBe(original);
      expect(app.visibleText()).toContain('有内容或链接');
      expect(adapter.queuePatch).not.toHaveBeenCalled();
      expect(adapter.putWorkbook).not.toHaveBeenCalled();
    },
  );
  it('persists sorted rows and related links together and restores both on undo', async () => {
    const book = workbook('排序链接'),
      other = createBlankWorkbook().sheets[0];
    book.sheets[0].name = 'Data';
    book.sheets[0].frozenRows = 0;
    book.sheets[0].cells = { A1: { value: 2 }, A2: { value: 1 } };
    other.name = 'Links';
    other.cells = { A1: { value: 'record', hyperlink: { target: '#Data!A1' } } };
    book.sheets.push(other);
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    app.click('排序');
    app.click('升序排列');
    const dialog = app.all().find((node) => node.type === SortDialog)!;
    dialog.props.onSort({ startRow: 0, rowCount: 2, keys: [{ column: 0, direction: 'asc' }] });
    await app.settle();
    expect(app.editor()!.props.sheet.cells.A1.value).toBe(1);
    expect(app.editor()!.props.workbook.sheets[1].cells.A1.hyperlink.target).toBe('#Data!A2');
    app.click('撤销');
    await app.settle();
    expect(app.editor()!.props.sheet.cells.A1.value).toBe(2);
    expect(app.editor()!.props.workbook.sheets[1].cells.A1.hyperlink.target).toBe('#Data!A1');
    app.click('重做');
    await app.settle();
    expect(app.editor()!.props.workbook.sheets[1].cells.A1.hyperlink.target).toBe('#Data!A2');
  });
  it('renames a sheet and related references in one undo step, rejecting stale callbacks', async () => {
    const book = workbook('重命名测试'),
      other = createBlankWorkbook().sheets[0];
    book.sheets[0].name = 'Data';
    other.name = 'Summary';
    other.cells = {
      A1: { value: '=Data!A1' },
      B1: { value: 'link', hyperlink: { target: '#Data!A1' } },
    };
    book.sheets.push(other);
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    app.click('重命名当前工作表');
    const dialog = app.all().find((node) => node.type === SheetRenameDialog)!;
    expect(() => dialog.props.onApply('Summary')).toThrow('已存在');
    expect(app.editor()!.props.sheet.name).toBe('Data');
    dialog.props.onApply('新 名称');
    await app.settle();
    expect(app.editor()!.props.sheet.name).toBe('新 名称');
    expect(app.editor()!.props.workbook.sheets[1].cells.A1.value).toBe("='新 名称'!A1");
    expect(app.editor()!.props.workbook.sheets[1].cells.B1.hyperlink.target).toBe("#'新 名称'!A1");
    expect(() => dialog.props.onApply('late')).toThrow('已变化');
    app.click('撤销');
    await app.settle();
    expect(app.editor()!.props.sheet.name).toBe('Data');
    expect(app.editor()!.props.workbook.sheets[1].cells.B1.hyperlink.target).toBe('#Data!A1');
    app.click('重做');
    await app.settle();
    expect(app.editor()!.props.sheet.name).toBe('新 名称');
    app.click('重命名当前工作表');
    const cancelled = app.all().find((node) => node.type === SheetRenameDialog)!;
    cancelled.props.onClose();
    expect(() => cancelled.props.onApply('late')).toThrow('已变化');
  });
  it('saves inline formatting as one undoable patch and rejects invalid or stale dialog callbacks', async () => {
    const book = workbook('局部样式');
    book.sheets[0].cells.D2 = {
      value: '销售增长',
      style: { italic: true },
      hyperlink: { target: '#A1' },
    };
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    app.click('局部文字格式');
    const dialog = app.all().find((node) => node.type === RichTextDialog)!;
    const address = dialog.props.address,
      original = structuredClone(dialog.props.cell);
    expect(() => dialog.props.onApply({ ...original, value: 'changed' })).toThrow('不能修改文字');
    expect(() => dialog.props.onApply({ ...original, richText: [{ text: 'mismatch' }] })).toThrow(
      '一致',
    );
    const richText = [
      { text: '销售', style: { bold: true } },
      { text: '增长', style: { color: '#198754' } },
    ];
    dialog.props.onApply({
      ...original,
      richText,
      hyperlink: { target: '#B1' },
      style: { italic: false },
    });
    expect(() => dialog.props.onApply(original)).toThrow('已变化');
    await app.settle();
    expect(app.editor()!.props.sheet.cells[address]).toEqual({ ...original, richText });
    app.click('撤销');
    await app.settle();
    expect(app.editor()!.props.sheet.cells[address]).toEqual(original);
    app.click('重做');
    await app.settle();
    expect(app.editor()!.props.sheet.cells[address].richText).toEqual(richText);
    app.click('局部文字格式');
    const closed = app.all().find((node) => node.type === RichTextDialog)!;
    closed.props.onClose();
    expect(() => closed.props.onApply(original)).toThrow('已变化');
    await app.settle();
    app.click('局部文字格式');
    const stale = app.all().find((node) => node.type === RichTextDialog)!;
    app.editor()!.props.onSelect({ row: 0, col: 0 });
    await app.settle();
    expect(() => stale.props.onApply(original)).toThrow('已变化');
  });
  it('saves hyperlink edits with undo and rejects callbacks after the dialog closes', async () => {
    adapter.loadWorkbooks.mockResolvedValue([workbook('链接编辑')]);
    const app = mount();
    await app.settle();
    app.click('单元格链接');
    const dialog = app.all().find((node) => node.type === HyperlinkDialog)!;
    const address = dialog.props.address;
    const original = app.editor()!.props.sheet.cells[address];
    dialog.props.onApply({
      value: '详情',
      hyperlink: { target: 'https://example.com', tooltip: 'source' },
    });
    await app.settle();
    expect(app.editor()!.props.sheet.cells[address].hyperlink?.target).toBe('https://example.com');
    expect(app.all().some((node) => node.type === HyperlinkDialog)).toBe(false);
    expect(() => dialog.props.onApply({ value: 'late' })).toThrow('已变化');
    app.click('撤销');
    await app.settle();
    expect(app.editor()!.props.sheet.cells[address]).toEqual(original);
    app.click('重做');
    await app.settle();
    expect(app.editor()!.props.sheet.cells[address].hyperlink?.tooltip).toBe('source');
    app.click('单元格链接');
    const cancelled = app.all().find((node) => node.type === HyperlinkDialog)!;
    cancelled.props.onClose();
    expect(() => cancelled.props.onApply({ value: 'late' })).toThrow('已变化');
  });
  it('navigates a saved internal link and rejects a repeated stale navigation callback', async () => {
    const book = workbook('链接跳转');
    book.sheets[0].cells.D2 = { value: '详情', hyperlink: { target: "#'目标 表'!$B$8" } };
    book.sheets.push({
      id: 'destination',
      name: '目标 表',
      rowCount: 100,
      colCount: 16,
      cells: { B8: { value: 'found' } },
    });
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    app.click('单元格链接');
    const dialog = app.all().find((node) => node.type === HyperlinkDialog)!;
    dialog.props.onNavigate();
    await app.settle();
    expect(app.editor()!.props.sheet.id).toBe('destination');
    expect(app.editor()!.props.selection).toEqual({ row: 7, col: 1 });
    expect(app.all().some((node) => node.type === HyperlinkDialog)).toBe(false);
    expect(() => dialog.props.onNavigate()).toThrow('已变化');
  });
  it.each(['hiddenRows', 'hiddenColumns'] as const)(
    'keeps the source sheet, selection and dialog when a link resolves to a master in %s',
    async (axis) => {
      const book = workbook('隐藏合并链接');
      book.sheets[0].cells.D2 = { value: '详情', hyperlink: { target: "#'目标 表'!B2" } };
      book.sheets.push({
        id: 'destination',
        name: '目标 表',
        rowCount: 100,
        colCount: 16,
        cells: { A1: { value: 'found' } },
        merges: [{ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } }],
        [axis]: [0],
      });
      adapter.loadWorkbooks.mockResolvedValue([book]);
      const app = mount();
      await app.settle();
      const original = app.editor()!.props;
      app.click('单元格链接');
      const dialog = app.all().find((node) => node.type === HyperlinkDialog)!;
      adapter.putWorkbook.mockClear();
      adapter.queuePatch.mockClear();
      expect(() => dialog.props.onNavigate()).toThrow('主格');
      await app.settle();
      expect(app.editor()!.props.sheet).toBe(original.sheet);
      expect(app.editor()!.props.selection).toEqual(original.selection);
      expect(app.all().some((node) => node.type === HyperlinkDialog)).toBe(true);
      expect(adapter.putWorkbook).not.toHaveBeenCalled();
      expect(adapter.queuePatch).not.toHaveBeenCalled();
    },
  );
  it('rejects structure beyond workspace quotas without saving or consuming undo', async () => {
    const book = workbook('结构限额');
    book.sheets[0].colCount = 256;
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    const before = app.editor()!.props.sheet;
    adapter.putWorkbook.mockClear();
    adapter.queuePatch.mockClear();
    app.click('插入或删除行列');
    const dialog = app.all().find((node) => node.type === StructureDialog)!;
    expect(() =>
      dialog.props.onApply({ axis: 'column', kind: 'insert', index: 0, count: 1 }),
    ).toThrow('256 列');
    app.render();
    await app.settle();
    expect(app.editor()!.props.sheet).toBe(before);
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    expect(adapter.queuePatch).not.toHaveBeenCalled();
    expect(app.all().some((node) => node.type === StructureDialog)).toBe(true);
    app.click('撤销');
    expect(app.editor()!.props.sheet).toBe(before);
  });
  it('deletes columns with #REF references and restores them on undo', async () => {
    const book = workbook('删除列');
    book.sheets[0].cells = { A1: { value: 3 }, B1: { value: '=A1*2' } };
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    app.click('插入或删除行列');
    app
      .all()
      .find((node) => node.type === StructureDialog)!
      .props.onApply({ axis: 'column', kind: 'delete', index: 0, count: 1 });
    app.render();
    await app.settle();
    expect(app.editor()!.props.sheet.cells.A1.value).toBe('=#REF!*2');
    app.click('撤销');
    expect(app.editor()!.props.sheet.cells.B1.value).toBe('=A1*2');
  });
  it.each(['success', 'failure'])(
    'opens only the latest chosen import and ignores late %s from an older file',
    async (result) => {
      const original = workbook('原工作簿'),
        first = deferred<Workbook>(),
        second = deferred<Workbook>();
      adapter.loadWorkbooks.mockResolvedValue([original]);
      fileIO.importFile.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const app = mount();
      await app.settle();
      const input = () =>
        app.all().find((node) => node.type === 'input' && node.props.type === 'file')!;
      const old = input().props.onChange({ target: { files: [new File(['{}'], 'old.json')] } });
      await app.settle();
      app.render();
      const latest = input().props.onChange({ target: { files: [new File(['{}'], 'new.json')] } });
      const imported = workbook('最新文件');
      second.resolve(imported);
      await latest;
      await app.settle();
      expect(app.editor()!.props.workbook.id).toBe(imported.id);
      if (result === 'success') first.resolve(workbook('旧文件'));
      else first.reject(new Error('旧文件解析失败'));
      await old;
      await app.settle();
      expect(app.editor()!.props.workbook.id).toBe(imported.id);
      expect(adapter.putWorkbook).toHaveBeenCalledExactlyOnceWith(imported);
    },
  );

  it('does not add or persist a file that finishes after App unmount', async () => {
    adapter.loadWorkbooks.mockResolvedValue([workbook('卸载导入')]);
    const parsed = deferred<Workbook>();
    fileIO.importFile.mockReturnValue(parsed.promise);
    const app = mount();
    await app.settle();
    const input = app.all().find((node) => node.type === 'input' && node.props.type === 'file')!;
    const pending = input.props.onChange({ target: { files: [new File(['{}'], 'late.json')] } });
    hooks.slots.forEach((slot) => {
      slot?.cleanup?.();
      if (slot) slot.cleanup = undefined;
    });
    parsed.resolve(workbook('迟到文件'));
    await pending;
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
  });

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
    await app.settle();
    app.click('保存版本');
    await app.settle();
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
    await app.settle();
    app.render();
    expect(fileIO.importFile).toHaveBeenCalledExactlyOnceWith(file, expect.any(AbortSignal));
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
    expect(adapter.putWorkbook).toHaveBeenCalledTimes(1);
    expect(adapter.queuePatch).toHaveBeenCalledWith(existing.id, {
      kind: 'cell',
      sheetId,
      key: 'A1',
      cell: { value: '首笔数据' },
    });
    expect(adapter.queuePatch.mock.calls.map(([, patch]) => patch.cell)).toEqual([
      { value: '首笔数据' },
      null,
      { value: '首笔数据' },
    ]);
    expect(adapter.putWorkbook.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.queuePatch.mock.invocationCallOrder[0],
    );
    expect(app.visibleText()).toContain('已保存到本地');
  });
});

describe('App validation rule editing', () => {
  it('reuses dashboard and selection statistics across presentation edits, and refreshes on data and active-sheet changes', async () => {
    const book = workbook('统计缓存');
    book.sheets[0].cells = { A1: { value: 2 }, B1: { value: '=A1*3' } };
    book.sheets.push({
      ...book.sheets[0],
      id: 'second-stats',
      name: '统计第二页',
      cells: { A1: { value: 17 } },
    });
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    const select = () => {
      app.editor()!.props.onSelect({ row: 0, col: 0, endRow: 0, endCol: 1 });
      app.render();
    };
    select();
    expect(app.visibleText()).toContain('求和：8');
    statistics.selection.mockClear();
    statistics.population.mockClear();
    statistics.analytics.mockClear();
    select();
    app.click('收藏工作簿');
    const editor = app.editor()!;
    editor.props.onChange({ ...editor.props.sheet, columnWidths: { 0: 240 } });
    app.render();
    app.click('撤销');
    app.click('重做');
    const styled = app.editor()!;
    styled.props.onPatch(styled.props.sheet.id, [
      { key: 'A1', cell: { value: 2, style: { bold: true } } },
    ]);
    app.render();
    await app.settle();
    expect(statistics.selection).not.toHaveBeenCalled();
    expect(statistics.population).not.toHaveBeenCalled();
    expect(statistics.analytics).not.toHaveBeenCalled();
    const current = app.editor()!;
    current.props.onPatch(current.props.sheet.id, [{ key: 'A1', cell: { value: 3 } }]);
    app.render();
    await app.settle();
    expect(app.visibleText()).toContain('求和：12');
    expect(statistics.selection).toHaveBeenCalledOnce();
    expect(statistics.population).toHaveBeenCalledOnce();
    expect(statistics.analytics).toHaveBeenCalledOnce();
    app.click('撤销');
    await app.settle();
    expect(app.visibleText()).toContain('求和：8');
    app.click('重做');
    await app.settle();
    expect(app.visibleText()).toContain('求和：12');
    statistics.population.mockClear();
    app.click('统计第二页');
    await app.settle();
    expect(app.visibleText()).toContain('求和：17');
    expect(statistics.analytics).toHaveBeenLastCalledWith('second-stats');
    expect(statistics.population).toHaveBeenCalledOnce();
  });

  it('reuses calculation through layout, style and favorite edits, but invalidates values and their undo', async () => {
    const book = workbook('计算调度');
    book.sheets[0].cells = { A1: { value: 2 }, B1: { value: '=A1*2' } };
    calculation.calculate.mockImplementation(async (source, _targets, revision) => ({
      revision,
      values:
        source.id === book.id
          ? { [`${book.sheets[0].id}:B1`]: Number(source.sheets[0].cells.A1.value) * 2 }
          : {},
    }));
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    calculation.calculate.mockClear();
    const editor = app.editor()!,
      version = editor.props.calculationVersion;
    editor.props.onChange({ ...editor.props.sheet, columnWidths: { 0: 240 } });
    app.render();
    app.click('撤销');
    app.click('重做');
    app.click('收藏工作簿');
    const styled = app.editor()!;
    styled.props.onPatch(styled.props.sheet.id, [
      { key: 'A1', cell: { value: 2, style: { bold: true } } },
    ]);
    app.render();
    await app.settle();
    expect(calculation.calculate).not.toHaveBeenCalled();
    expect(app.editor()!.props.calculationVersion).toBe(version);
    expect(app.editor()!.props.getValue).toBe(editor.props.getValue);
    expect(app.editor()!.props.getValue(app.editor()!.props.sheet, 'B1')).toBe(4);
    const current = app.editor()!;
    current.props.onPatch(current.props.sheet.id, [{ key: 'A1', cell: { value: 3 } }]);
    app.render();
    await app.settle();
    expect(calculation.calculate).toHaveBeenCalledTimes(1);
    expect(app.editor()!.props.getValue(app.editor()!.props.sheet, 'B1')).toBe(6);
    app.click('撤销');
    await app.settle();
    expect(calculation.calculate).toHaveBeenCalledTimes(2);
    expect(app.editor()!.props.getValue(app.editor()!.props.sheet, 'B1')).toBe(4);
  });

  it('rejects late results after value edits while accepting results across presentation changes', async () => {
    const book = workbook('迟到计算');
    book.sheets[0].cells = { A1: { value: 2 }, B1: { value: '=A1*2' } };
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    const first = deferred<any>(),
      second = deferred<any>();
    calculation.calculate.mockClear();
    calculation.calculate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const edit = (value: number) => {
      const editor = app.editor()!;
      editor.props.onPatch(editor.props.sheet.id, [{ key: 'A1', cell: { value } }]);
      app.render();
    };
    edit(3);
    const revision1 = calculation.calculate.mock.calls[0][2];
    const firstSignal = calculation.calculate.mock.calls[0][3] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);
    edit(4);
    const revision2 = calculation.calculate.mock.calls[1][2];
    const secondSignal = calculation.calculate.mock.calls[1][3] as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    const editor = app.editor()!,
      id = editor.props.sheet.id;
    editor.props.onChange({ ...editor.props.sheet, columnWidths: { 0: 200 } });
    app.render();
    expect(secondSignal.aborted).toBe(false);
    second.resolve({ revision: revision2, values: { [`${id}:B1`]: 8 } });
    await app.settle();
    expect(app.editor()!.props.getValue(app.editor()!.props.sheet, 'B1')).toBe(8);
    first.resolve({ revision: revision1, values: { [`${id}:B1`]: 999 } });
    await app.settle();
    expect(app.editor()!.props.getValue(app.editor()!.props.sheet, 'B1')).toBe(8);
    expect(calculation.calculate).toHaveBeenCalledTimes(2);
  });

  it('uses latest-only scheduling and cancels obsolete work when all formulas are removed or the App unmounts', async () => {
    const book = workbook('计算取消');
    book.sheets[0].cells = { A1: { value: 2 }, B1: { value: '=A1*2' } };
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    expect(calculationFactory).toHaveBeenCalledExactlyOnceWith({
      queueMode: 'latest',
      timeoutMs: 30_000,
      reuseSheets: true,
    });
    const oldSignal = calculation.calculate.mock.lastCall![3] as AbortSignal;
    calculation.calculate.mockClear();
    const editor = app.editor()!;
    editor.props.onPatch(editor.props.sheet.id, [{ key: 'B1', cell: { value: 7 } }]);
    app.render();
    await app.settle();
    expect(oldSignal.aborted).toBe(true);
    expect(calculation.calculate).not.toHaveBeenCalled();
    expect(app.editor()!.props.getValue(app.editor()!.props.sheet, 'B1')).toBe(7);
    app.click('撤销');
    await app.settle();
    const restoredSignal = calculation.calculate.mock.lastCall![3] as AbortSignal;
    expect(restoredSignal.aborted).toBe(false);
    hooks.slots.forEach((slot) => {
      slot?.cleanup?.();
      if (slot) slot.cleanup = undefined;
    });
    expect(restoredSignal.aborted).toBe(true);
    expect(calculation.dispose).toHaveBeenCalledOnce();
  });

  it('discards cached and pending results when importing new content with the same workbook and sheet ids', async () => {
    const book = workbook('替换计算');
    book.sheets[0].cells = { A1: { value: 2 }, B1: { value: '=A1*2' } };
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    calculation.calculate.mockClear();
    const old = deferred<any>(),
      current = deferred<any>();
    calculation.calculate.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const editor = app.editor()!;
    editor.props.onPatch(editor.props.sheet.id, [{ key: 'A1', cell: { value: 3 } }]);
    app.render();
    const oldRevision = calculation.calculate.mock.calls[0][2];
    const imported = structuredClone(book);
    imported.sheets[0].cells.A1.value = 10;
    fileIO.importFile.mockResolvedValue(imported);
    const input = app.all().find((node) => node.type === 'input' && node.props.type === 'file')!;
    await input.props.onChange({ target: { files: [new File(['{}'], 'replace.json')] } });
    await app.settle();
    const newRevision = calculation.calculate.mock.calls[1][2];
    expect(newRevision).not.toBe(oldRevision);
    const read = () => app.editor()!.props.getValue(app.editor()!.props.sheet, 'B1');
    expect(read()).toBe(20);
    old.resolve({ revision: oldRevision, values: { [`${editor.props.sheet.id}:B1`]: 999 } });
    await app.settle();
    expect(read()).toBe(20);
    current.resolve({ revision: newRevision, values: { [`${editor.props.sheet.id}:B1`]: 20 } });
    await app.settle();
    expect(read()).toBe(20);
    expect(calculation.calculate).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch worker requests when the workbook has no formulas', async () => {
    adapter.loadWorkbooks.mockResolvedValue([workbook('无公式')]);
    const app = mount();
    await app.settle();
    calculation.calculate.mockClear();
    const editor = app.editor()!;
    editor.props.onPatch(editor.props.sheet.id, [{ key: 'A1', cell: { value: 100 } }]);
    app.render();
    await app.settle();
    expect(calculation.calculate).not.toHaveBeenCalled();
    expect(app.editor()!.props.getValue(app.editor()!.props.sheet, 'A1')).toBe(100);
  });

  it('uses the current synchronous evaluator when background calculation fails', async () => {
    const book = workbook('计算回退');
    book.sheets[0].cells = { A1: { value: 2 }, B1: { value: '=A1*2' } };
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    calculation.calculate.mockRejectedValue(new Error('worker unavailable'));
    const editor = app.editor()!;
    editor.props.onPatch(editor.props.sheet.id, [{ key: 'A1', cell: { value: 5 } }]);
    app.render();
    await app.settle();
    expect(app.editor()!.props.getValue(app.editor()!.props.sheet, 'B1')).toBe(10);
  });

  it('records ordinary edits and undo/redo without cloning or persisting a whole workbook', async () => {
    adapter.loadWorkbooks.mockResolvedValue([workbook('补丁历史')]);
    const app = mount();
    await app.settle();
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      const editor = app.editor()!;
      editor.props.onPatch(editor.props.sheet.id, [{ key: 'B2', cell: { value: 'changed' } }]);
      app.render();
      app.click('撤销');
      expect(app.editor()!.props.sheet.cells.B2).toBeUndefined();
      app.click('重做');
      expect(app.editor()!.props.sheet.cells.B2.value).toBe('changed');
      await app.settle();
      expect(
        clone.mock.calls.some(([input]) => input && typeof input === 'object' && 'sheets' in input),
      ).toBe(false);
      expect(adapter.putWorkbook).not.toHaveBeenCalled();
      expect(adapter.queuePatch.mock.calls.map(([, patch]) => patch.cell)).toEqual([
        { value: 'changed' },
        null,
        { value: 'changed' },
      ]);
    } finally {
      clone.mockRestore();
    }
  });

  it('undoes a layout patch without undoing later sheet selection or favorite state', async () => {
    const book = workbook('跨表历史');
    book.sheets.push({
      ...structuredClone(book.sheets[0]),
      id: 'second',
      name: '第二页',
      cells: {},
    });
    adapter.loadWorkbooks.mockResolvedValue([book]);
    const app = mount();
    await app.settle();
    const editor = app.editor()!;
    expect(editor.props.onChange({ ...editor.props.sheet, columnWidths: { 0: 250 } })).toBe(true);
    app.render();
    await app.settle();
    expect(adapter.queuePatch.mock.lastCall?.[1]).toEqual({
      kind: 'sheet-meta',
      sheetId: book.sheets[0].id,
      changes: { columnWidths: { 0: 250 } },
    });
    app.click('第二页');
    app.click('收藏工作簿');
    await app.settle();
    adapter.putWorkbook.mockClear();
    app.click('撤销');
    expect(app.editor()!.props.sheet.id).toBe('second');
    expect(app.editor()!.props.workbook.starred).toBe(true);
    expect(app.editor()!.props.workbook.sheets[0].columnWidths).toEqual(
      book.sheets[0].columnWidths,
    );
    app.click('重做');
    expect(app.editor()!.props.workbook.sheets[0].columnWidths).toEqual({ 0: 250 });
    await app.settle();
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
  });

  const rule = (): DataValidationRule => ({
    id: 'quantity',
    range: { start: { row: 0, col: 0 }, end: { row: 20, col: 0 } },
    kind: 'whole',
    operator: 'between',
    min: 1,
    max: 10,
    allowBlank: false,
    message: '数量须为 1 到 10 的整数',
  });
  function dialog(app: ReturnType<typeof mount>) {
    const result = app.all().find((node) => node.type === ValidationDialog);
    if (!result) throw new Error('Missing validation dialog');
    return result;
  }
  it.each(['ctrlKey', 'metaKey'])(
    'keeps the validation editor mounted when %s+K is pressed, then allows search after closing',
    async (modifier) => {
      adapter.loadWorkbooks.mockResolvedValue([workbook('草稿快捷键')]);
      const app = mount();
      await app.settle();
      const searchShortcut = () => {
        const listener = vi
          .mocked(window.addEventListener)
          .mock.calls.filter(([type]) => type === 'keydown')
          .at(-1)![1] as (event: KeyboardEvent) => void;
        const preventDefault = vi.fn();
        listener({
          key: 'k',
          [modifier]: true,
          preventDefault,
          target: null,
        } as unknown as KeyboardEvent);
        app.render();
        expect(preventDefault).toHaveBeenCalledOnce();
      };
      app.click('数据验证');
      const originalKey = dialog(app).key;
      searchShortcut();
      expect(dialog(app).key).toBe(originalKey);
      expect(app.all().some((node) => node.type === Modal)).toBe(false);
      expect(adapter.queuePatch).not.toHaveBeenCalled();
      expect(adapter.putWorkbook).not.toHaveBeenCalled();
      dialog(app).props.onClose();
      app.render();
      searchShortcut();
      expect(app.all().some((node) => node.type === ValidationDialog)).toBe(false);
      expect(app.all().some((node) => node.type === Modal)).toBe(true);
    },
  );
  it.each([{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }])(
    'does not dispatch global shortcuts for an owned or composing event %j',
    async (signal) => {
      adapter.loadWorkbooks.mockResolvedValue([workbook('快捷键归属')]);
      const app = mount();
      await app.settle();
      app
        .editor()!
        .props.onPatch(app.editor()!.props.sheet.id, [{ key: 'A1', cell: { value: 'edited' } }]);
      app.render();
      await app.settle();
      const listener = vi
        .mocked(window.addEventListener)
        .mock.calls.filter(([type]) => type === 'keydown')
        .at(-1)![1] as (event: KeyboardEvent) => void;
      adapter.flush.mockClear();
      for (const modifier of ['ctrlKey', 'metaKey']) {
        for (const key of ['k', 's', 'z', 'y']) {
          const preventDefault = vi.fn();
          listener({
            key,
            [modifier]: true,
            target: null,
            preventDefault,
            ...signal,
          } as unknown as KeyboardEvent);
          app.render();
          expect(preventDefault).not.toHaveBeenCalled();
          expect(app.editor()!.props.sheet.cells.A1.value).toBe('edited');
          expect(app.all().some((node) => node.type === Modal)).toBe(false);
        }
      }
      expect(adapter.flush).not.toHaveBeenCalled();
      listener({
        key: 'z',
        ctrlKey: true,
        target: null,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent);
      app.render();
      expect(app.editor()!.props.sheet.cells.A1?.value).not.toBe('edited');
    },
  );
  it('applies metadata atomically without rewriting existing invalid values, then enforces future edits and restores rules with undo/redo', async () => {
    const existing = workbook('填报规则');
    existing.sheets[0].cells.A1 = { value: 20, style: { bold: true } };
    existing.sheets[0].cells.B1 = { value: '=A1*2' };
    adapter.loadWorkbooks.mockResolvedValue([existing]);
    const app = mount();
    await app.settle();
    const before = app.editor()!.props.sheet.cells;
    const getValue = app.editor()!.props.getValue;
    calculation.calculate.mockClear();
    statistics.selection.mockClear();
    statistics.population.mockClear();
    statistics.analytics.mockClear();
    app.click('数据验证');
    const input = [rule()];
    dialog(app).props.onSave(input);
    app.render();
    input[0].range.end.row = 0;
    await app.settle();
    const edited = app.editor()!;
    expect(edited.props.sheet.cells).toBe(before);
    expect(edited.props.sheet.cells.A1).toEqual({ value: 20, style: { bold: true } });
    expect(edited.props.sheet.dataValidations[0].range.end.row).toBe(20);
    expect(adapter.queuePatch).toHaveBeenCalledExactlyOnceWith(existing.id, {
      kind: 'sheet-meta',
      sheetId: existing.sheets[0].id,
      changes: { dataValidations: [rule()] },
    });
    expect(app.all().some((node) => node.type === ValidationDialog)).toBe(false);
    expect(() =>
      edited.props.onPatch(edited.props.sheet.id, [{ key: 'A2', cell: { value: 11 } }]),
    ).toThrow('数量须为 1 到 10 的整数');
    expect(edited.props.sheet.cells.A2).toBeUndefined();
    app.click('撤销');
    expect(app.editor()!.props.sheet.dataValidations).toBeUndefined();
    expect(app.editor()!.props.sheet.cells.A1.value).toBe(20);
    app.click('重做');
    expect(app.editor()!.props.sheet.dataValidations).toEqual([rule()]);
    expect(app.editor()!.props.sheet.cells.A1.value).toBe(20);
    await app.settle();
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    expect(adapter.queuePatch.mock.calls.map(([, patch]) => patch.changes.dataValidations)).toEqual(
      [[rule()], undefined, [rule()]],
    );
    expect(calculation.calculate).not.toHaveBeenCalled();
    expect(app.editor()!.props.getValue).toBe(getValue);
    expect(getValue(app.editor()!.props.sheet, 'B1')).toBe(40);
    expect(statistics.selection).not.toHaveBeenCalled();
    expect(statistics.population).not.toHaveBeenCalled();
    expect(statistics.analytics).not.toHaveBeenCalled();
  });

  it('keeps invalid configurations open with no storage or history mutation; cancellation discards the editor', async () => {
    adapter.loadWorkbooks.mockResolvedValue([workbook('规则校验')]);
    const app = mount();
    await app.settle();
    app.click('数据验证');
    expect(() => dialog(app).props.onSave([{ ...rule(), min: 100 }])).toThrow();
    app.render();
    expect(dialog(app)).toBeDefined();
    expect(adapter.queuePatch).not.toHaveBeenCalled();
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    expect(app.editor()!.props.sheet.dataValidations).toBeUndefined();
    expect(app.all().find((node) => node.props.label === '撤销')?.props.disabled).toBe(true);
    dialog(app).props.onClose();
    app.render();
    expect(app.all().some((node) => node.type === ValidationDialog)).toBe(false);
  });

  it('keeps redo available after saving unchanged rules and supports clearing all rules as one undoable edit', async () => {
    const existing = workbook('规则清除');
    existing.sheets[0].dataValidations = [rule()];
    adapter.loadWorkbooks.mockResolvedValue([existing]);
    const app = mount();
    await app.settle();
    const editor = app.editor()!;
    editor.props.onPatch(editor.props.sheet.id, [{ key: 'B2', cell: { value: '备注' } }]);
    app.render();
    app.click('撤销');
    await app.settle();
    adapter.queuePatch.mockClear();
    adapter.putWorkbook.mockClear();
    app.click('数据验证');
    dialog(app).props.onSave([rule()]);
    app.render();
    await app.settle();
    expect(adapter.queuePatch).not.toHaveBeenCalled();
    expect(adapter.putWorkbook).not.toHaveBeenCalled();
    expect(app.all().find((node) => node.props.label === '重做')?.props.disabled).toBe(false);
    app.click('重做');
    expect(app.editor()!.props.sheet.cells.B2.value).toBe('备注');
    app.click('数据验证');
    dialog(app).props.onSave([]);
    app.render();
    await app.settle();
    expect(app.editor()!.props.sheet.dataValidations).toEqual([]);
    expect(adapter.queuePatch.mock.lastCall?.[1]).toEqual({
      kind: 'sheet-meta',
      sheetId: existing.sheets[0].id,
      changes: { dataValidations: [] },
    });
    app.click('撤销');
    expect(app.editor()!.props.sheet.dataValidations).toEqual([rule()]);
    expect(app.editor()!.props.sheet.cells.B2.value).toBe('备注');
  });
});

it('preserves an address draft across same-cell selection and value updates', async () => {
  adapter.loadWorkbooks.mockResolvedValue([workbook('address')]);
  const app = mount();
  await app.settle();
  const bar = () => app.all().find((node) => node.type === FormulaBar)!;
  app.editor()!.props.onSelect({ row: 0, col: 0 });
  app.render();
  bar().props.onAddressChange('C3');
  app.render();
  app.editor()!.props.onSelect({ row: 0, col: 0 });
  bar().props.onCommit('changed');
  app.render();
  expect(bar().props.address).toBe('C3');
  bar().props.onAddressSubmit();
  app.render();
  expect(app.editor()!.props.selection).toEqual({ row: 2, col: 2 });
  bar().props.onCommit('destination');
  app.render();
  expect(app.editor()!.props.sheet.cells.C3.value).toBe('destination');
  expect(app.editor()!.props.sheet.cells.A1.value).toBe('changed');
});

it('resets an address draft when the selected cell changes', async () => {
  adapter.loadWorkbooks.mockResolvedValue([workbook('address-reset')]);
  const app = mount();
  await app.settle();
  const bar = () => app.all().find((node) => node.type === FormulaBar)!;
  bar().props.onAddressChange('Z99');
  app.render();
  app.editor()!.props.onSelect({ row: 1, col: 1 });
  app.render();
  expect(bar().props.address).toBe('B2');
});

it.each(['1e-999', '3e-324', '-0.00', '0.1234567890123456789'])(
  'preserves precision-sensitive input %s in the workspace formula bar',
  async (value) => {
    adapter.loadWorkbooks.mockResolvedValue([workbook('input')]);
    const app = mount();
    await app.settle();
    app.editor()!.props.onSelect({ row: 0, col: 0 });
    app.render();
    const bar = app.all().find((node) => node.type === FormulaBar)!;
    expect(bar).toBeDefined();
    bar.props.onCommit(value);
    app.render();
    expect(app.editor()!.props.sheet.cells.A1.value).toBe(value);
  },
);
