import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render() {}, unmount() {} }) }));
import * as sdk from '../src/sdk';

// Executes the distributed example's actual handlers with its real SDK controller.
// These elements are substitutes; this is not a Canvas/browser acceptance test.
class Element {
  className = '';
  classList = { add() {} };
  dataset: Record<string, string> = {};
  value = '';
  textContent = '';
  disabled = false;
  hidden = false;
  checked = false;
  options: Element[] = [];
  files: File[] = [];
  listeners = new Map<string, (...args: any[]) => void>();
  addEventListener(type: string, callback: (...args: any[]) => void) {
    this.listeners.set(type, callback);
  }
  removeEventListener(type: string) {
    this.listeners.delete(type);
  }
  onclick?: (event?: { detail: number }) => unknown;
  onchange?: () => unknown;
  onkeydown?: (event: { key: string; isComposing?: boolean; keyCode?: number }) => unknown;
  replaceChildren(...children: Element[]) {
    this.options = children;
  }
  querySelectorAll() {
    return [];
  }
  setAttribute() {}
  removeAttribute() {}
  click() {
    return this.onclick?.({ detail: 0 });
  }
}
let dispose: (() => void) | undefined;
const storage = new Map<string, string>();
let failStorageWrites = false;
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failStorageWrites) throw new Error('storage quota exceeded');
      storage.set(key, value);
    },
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  storage.clear();
  failStorageWrites = false;
  vi.unstubAllGlobals();
});
function mount() {
  const html = readFileSync(new URL('../examples/report.html', import.meta.url), 'utf8');
  const source = html
    .match(/<script type="module">([\s\S]*?)<\/script>/)![1]
    .replace(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\.\/src\/sdk\/index.tsx';/, 'const {$1} = sdk;');
  const elements = new Map<string, Element>();
  const $ = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector)!;
  };
  for (const [id, value] of Object.entries({
    'page-size': '0',
    format: 'xlsx',
    'clipboard-mode': 'visible',
  }))
    $(`#${id}`).value = value;
  $('#format').options = ['xlsx', 'csv', 'pdf', 'json'].map((value) =>
    Object.assign(new Element(), { value }),
  );
  const document = {
    querySelector: $,
    querySelectorAll: (selector: string) => {
      if (selector !== '[data-layout]') return [];
      const button = $('[data-layout="list"]');
      button.dataset.layout = 'list';
      return [button];
    },
    createElement: () => new Element(),
    activeElement: null,
  };
  const listeners = new Map<string, (...args: any[]) => void>();
  const window = {
    confirm: vi.fn(() => true),
    addEventListener: (type: string, callback: () => void) => {
      listeners.set(type, callback);
      if (type === 'unload') dispose = callback;
    },
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const run = new Function(
    'sdk',
    'document',
    'window',
    'setInterval',
    'clearInterval',
    source + '\nreturn {grid, report};',
  );
  const result = run(
    sdk,
    document,
    window,
    () => 0,
    () => {},
  ) as { grid: sdk.LuminaSpreadsheet; report: (mode: string) => Promise<void> };
  return { ...result, $, listeners, confirm: window.confirm };
}
it('preserves edits, drafts and history when replacement or import confirmation is cancelled', async () => {
  const { grid, $, confirm, report } = mount();
  await report('sheets');
  grid.setCell('A1', 'keep edited workbook');
  const before = grid.toJSON();
  $('#formula').value = 'uncommitted draft';
  $('#formula').listeners.get('input')!();
  confirm.mockReturnValue(false);
  await $('[data-layout="list"]').click();
  expect(grid.toJSON()).toEqual(before);
  expect($('#formula').value).toBe('uncommitted draft');
  $('#page-size').value = '10';
  await $('#page-size').onchange!();
  expect($('#page-size').value).toBe('0');
  expect(grid.toJSON()).toEqual(before);
  const file = new File(['{}'], 'incoming.json');
  const read = vi.spyOn(file, 'arrayBuffer');
  const importing = vi.spyOn(grid, 'import');
  $('#json-file').value = 'incoming.json';
  $('#json-file').files = [file];
  await $('#json-file').onchange!();
  expect($('#json-file').value).toBe('');
  expect(importing).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(grid.toJSON()).toEqual(before);
  expect($('#formula').value).toBe('uncommitted draft');
  expect(confirm).toHaveBeenCalledTimes(3);
  grid.undo();
  expect(grid.getCell('A1')?.value).toBe('指标');
  grid.redo();
  expect(grid.toJSON()).toEqual({ ...before, updatedAt: grid.toJSON().updatedAt });
  confirm.mockReturnValue(true);
  await $('[data-layout="list"]').click();
  expect(grid.sheetInfos).toHaveLength(1);
  expect(grid.getCell('A1')?.value).toBe('月份');
});

it('does not request replacement confirmation in an unedited session', async () => {
  const { $, confirm } = mount();
  await $('[data-layout="list"]').click();
  $('#page-size').value = '10';
  await $('#page-size').onchange!();
  expect(confirm).not.toHaveBeenCalled();
});
it('persists an edited report and restores it on the next mount', async () => {
  const first = mount();
  await first.report('sheets');
  first.$('#sheet-select').value = first.grid.sheetInfos[0].id;
  first.$('#sheet-select').onchange!();
  first.grid.setCell('C2', 245000);
  first.$('#sheet-select').value = first.grid.sheetInfos[1].id;
  first.$('#sheet-select').onchange!();
  first.$('#formula').value = '本机草稿';
  first.$('#formula').listeners.get('input')!();
  const saved = JSON.parse(storage.get('lumina.report.example.v1')!);
  expect(saved.version).toBe(1);
  expect(saved.workbook.sheets).toHaveLength(2);
  expect(saved.workbook.sheets[0].cells.C2.value).toBe(245000);
  expect(saved.formulaDraft.value).toBe('本机草稿');
  dispose!();
  dispose = undefined;

  const second = mount();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(second.grid.sheetInfos).toHaveLength(2);
  expect(second.grid.getValue('B2')).toBe(8344000);
  expect(second.$('#formula').value).toBe('本机草稿');
  expect(second.$('#session-note').textContent).toContain('已恢复本机浏览器');
});
it('warns before reload when browser storage rejects the local draft', async () => {
  const { grid, report, $ } = mount();
  await report('list');
  failStorageWrites = true;
  grid.setCell('A1', 'memory only');
  expect($('#session-note').textContent).toContain('拒绝本机保存');
  expect(storage.has('lumina.report.example.v1')).toBe(false);
});
it('restores the latest sheet and selection after navigation without another edit', async () => {
  const first = mount();
  await first.report('sheets');
  first.grid.setActiveSheet(first.grid.sheetInfos[0].id);
  first.grid.setCell('C2', 245000);
  first.grid.setActiveSheet(first.grid.sheetInfos[1].id);
  first.grid.select({ row: 1, col: 1 });
  const saved = JSON.parse(storage.get('lumina.report.example.v1')!);
  expect(saved.activeSheetId).toBe(first.grid.activeSheetInfo.id);
  expect(saved.selection).toEqual({ row: 1, col: 1 });
  dispose!();
  dispose = undefined;
  const second = mount();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(second.grid.activeSheetInfo.name).toBe('经营汇总');
  expect(second.grid.selectedRange).toEqual({ row: 1, col: 1 });
  expect(second.$('#formula').value).toBe("=SUM('销售明细'!C2:C37)");
  expect(second.grid.getValue('B2')).toBe(8344000);
});
it('reuses the workbook snapshot during typing and navigation and refreshes it after edits', async () => {
  const { grid, report, $ } = mount();
  await report('sheets');
  grid.setActiveSheet(grid.sheetInfos[0].id);
  const snapshot = vi.spyOn(grid, 'toJSON');
  grid.setCell('C2', 245000);
  expect(snapshot).toHaveBeenCalledTimes(1);
  for (const value of ['d', 'dr', 'draft']) {
    $('#formula').value = value;
    $('#formula').listeners.get('input')!();
  }
  grid.setActiveSheet(grid.sheetInfos[1].id);
  grid.select({ row: 1, col: 1 });
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(JSON.parse(storage.get('lumina.report.example.v1')!).formulaDraft).toBeNull();
  grid.undo();
  expect(snapshot).toHaveBeenCalledTimes(2);
  const saved = JSON.parse(storage.get('lumina.report.example.v1')!);
  expect(saved.workbook.sheets[0].cells.C2.value).toBe(100000);
  expect(saved.activeSheetId).toBe(grid.activeSheetInfo.id);
});
it('warns and retains the previous recoverable copy when a new report exceeds the restore limit', async () => {
  const { grid, $ } = mount();
  grid.setCell('A1', 'recoverable');
  const previous = storage.get('lumina.report.example.v1');
  const workbook = grid.toJSON();
  workbook.name = 'x'.repeat(5_000_000);
  vi.spyOn(grid, 'toJSON').mockReturnValue(workbook);
  grid.setCell('A1', 'still in memory');
  expect($('#session-note').textContent).toContain('超过本机恢复容量');
  expect(storage.get('lumina.report.example.v1')).toBe(previous);
  expect(grid.getValue('A1')).toBe('still in memory');
});
it('protects memory edits, rejected drafts and structure changes until successful replacement', async () => {
  const { grid, report, $, listeners } = mount();
  const prevented = () => {
    const event = { preventDefault: vi.fn(), returnValue: undefined };
    listeners.get('beforeunload')!(event);
    if (event.preventDefault.mock.calls.length) expect(event.returnValue).toBe('');
    return event.preventDefault.mock.calls.length > 0;
  };
  expect(prevented()).toBe(false);
  grid.setCell('A1', 'unsaved');
  expect(prevented()).toBe(true);
  grid.undo();
  expect(prevented()).toBe(true);
  await report('validation');
  expect(prevented()).toBe(false);
  $('#formula').listeners.get('input')!();
  expect(prevented()).toBe(true);
  await report('list');
  $('#report').listeners.get('input')!();
  expect(prevented()).toBe(true);
  await report('list');
  grid.insertRows(2, 1);
  expect(prevented()).toBe(true);
  await report('list');
  dispose!();
  dispose = undefined;
  expect(listeners.has('beforeunload')).toBe(false);
  expect($('#report').listeners.size).toBe(0);
});
it('changes report zoom and retains the preference across report replacement', async () => {
  const { grid, report, $ } = mount();
  const before = grid.toJSON();
  $('#report-zoom').value = '150';
  $('#report-zoom').onchange!();
  expect(grid.zoom).toBe(150);
  expect(grid.toJSON()).toEqual(before);
  expect($('#status').dataset.error).toBe('false');
  await report('sheets');
  expect(grid.zoom).toBe(150);
  $('#report-zoom').value = 'invalid';
  $('#report-zoom').onchange!();
  expect($('#report-zoom').value).toBe('150');
  expect(grid.zoom).toBe(150);
  expect($('#status').dataset.error).toBe('true');
});

it('does not clear edited-session protection when an export finishes or fails', async () => {
  const { grid, $, listeners } = mount();
  grid.setCell('A1', 'keep');
  const exported = vi.spyOn(grid, 'export').mockResolvedValue(undefined);
  await $('#export').onclick!();
  const event = { preventDefault: vi.fn(), returnValue: undefined };
  listeners.get('beforeunload')!(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  exported.mockRejectedValue(new Error('cancelled download'));
  await $('#export').onclick!();
  listeners.get('beforeunload')!(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
});

it('restores the formula draft when a cancelled beforeunload returns focus', async () => {
  const { grid, $, listeners, report } = mount();
  await report('list');
  $('#formula').value = 'Safari cancelled draft';
  $('#formula').listeners.get('input')!();
  const before = listeners.get('beforeunload')!({ preventDefault() {}, returnValue: '' });
  expect(before).toBeUndefined();
  grid.select({ row: 1, col: 1 });
  $('#formula').value = 'stale after prompt';
  listeners.get('focus')!();
  expect($('#formula').value).toBe('Safari cancelled draft');
  expect($('#selected').textContent).toBe('A1');
  expect($('#session-note').textContent).toContain('保存');
});

it('does not restore an old unload draft after a newer input or successful Apply', async () => {
  const { grid, $, listeners, report } = mount();
  await report('list');
  $('#formula').value = 'old pending draft';
  $('#formula').listeners.get('input')!();
  const warn = () => listeners.get('beforeunload')!({ preventDefault() {}, returnValue: '' });
  warn();
  $('#formula').value = 'newer draft';
  $('#formula').listeners.get('input')!();
  listeners.get('focus')!();
  expect($('#formula').value).toBe('newer draft');
  warn();
  $('#apply').click();
  listeners.get('focus')!();
  expect(grid.getValue('A1')).toBe('newer draft');
  expect($('#formula').value).toBe('newer draft');
  expect(JSON.parse(storage.get('lumina.report.example.v1')!).formulaDraft).toBeNull();
});

it('does not restore an unload selection or draft into a replacement report', async () => {
  const { grid, $, listeners, report } = mount();
  await report('list');
  grid.select({ row: 1, col: 1 });
  $('#formula').value = 'old report draft';
  $('#formula').listeners.get('input')!();
  listeners.get('beforeunload')!({ preventDefault() {}, returnValue: '' });
  await report('formulas');
  listeners.get('focus')!();
  expect($('#formula').value).toBe('场景');
  expect(grid.selectedRange).toEqual({ row: 0, col: 0 });
  expect($('#status').textContent).toContain('已生成公式示例');
});

it('does not apply partial IME text by click, keyboard or pointer fallback', async () => {
  const { grid, $, report } = mount();
  await report('list');
  const initial = grid.getValue('A1');
  const set = vi.spyOn(grid, 'setCell');
  const formula = $('#formula');
  formula.listeners.get('compositionstart')!();
  formula.value = '未完成候选';
  formula.listeners.get('input')!();
  $('#apply').click();
  formula.onkeydown!({ key: 'Enter' });
  $('#apply').listeners.get('mousedown')!({ button: 0 });
  $('#apply').listeners.get('mouseup')!({ button: 0 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(set).not.toHaveBeenCalled();
  expect(grid.getValue('A1')).toBe(initial);
  formula.value = '最终中文';
  formula.listeners.get('compositionend')!();
  formula.listeners.get('input')!();
  $('#apply').click();
  expect(set).toHaveBeenCalledOnce();
  expect(grid.getValue('A1')).toBe('最终中文');
  expect(formula.value).toBe('最终中文');
});

it('cancels a queued pointer Apply when a new composition starts', async () => {
  const { grid, $, report } = mount();
  await report('list');
  const set = vi.spyOn(grid, 'setCell');
  $('#formula').value = 'pending pointer';
  $('#formula').listeners.get('input')!();
  $('#apply').listeners.get('mousedown')!({ button: 0 });
  $('#apply').listeners.get('mouseup')!({ button: 0 });
  $('#formula').listeners.get('compositionstart')!();
  $('#formula').listeners.get('compositionend')!();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(set).not.toHaveBeenCalled();
});

it('keeps an edited session alive when pagehide is cancelled by the browser', async () => {
  const { grid, $, listeners } = mount();
  grid.setCell('A1', 'keep through cancelled navigation');
  $('#formula').value = 'draft through cancelled navigation';
  $('#formula').listeners.get('input')!();
  expect(listeners.has('unload')).toBe(true);
  expect(listeners.has('pagehide')).toBe(false);
  expect(listeners.has('beforeunload')).toBe(true);
  expect(grid.getCell('A1')?.value).toBe('keep through cancelled navigation');
  expect($('#formula').value).toBe('draft through cancelled navigation');
  const event = { preventDefault: vi.fn(), returnValue: undefined };
  listeners.get('beforeunload')!(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.returnValue).toBe('');
});

it('exposes actual multi-sheet formula recalculation and workbook undo in the example', async () => {
  const { grid, report, $ } = mount();
  await report('sheets');
  expect($('#status').dataset.error).toBe('false');
  expect($('#sheet-select').options.map((option) => option.textContent)).toEqual([
    '销售明细',
    '经营汇总',
  ]);
  expect(grid.activeSheetInfo.name).toBe('经营汇总');
  expect(grid.getValue('B2')).toBe(8199000);
  expect(grid.getValue('B3')).toBe(4212000);
  const [detail, summary] = grid.sheetInfos;
  $('#sheet-select').value = detail.id;
  $('#sheet-select').onchange!();
  grid.setCell('C2', 200000);
  $('#sheet-select').value = summary.id;
  $('#sheet-select').onchange!();
  expect(grid.getValue('B2')).toBe(8299000);
  $('#undo').click();
  expect(grid.activeSheetInfo.id).toBe(summary.id);
  expect(grid.getValue('B2')).toBe(8199000);
  expect($('#selected').textContent).toBe('A1');
  expect($('#formula').value).toBe('指标');
});
it('refreshes directory and readonly controls when replacing the multi-sheet demo', async () => {
  const { grid, report, $ } = mount();
  await report('sheets');
  await report('paged');
  expect(grid.sheetInfos).toHaveLength(1);
  expect(grid.activeSheetInfo.name).toBe('分页数据');
  expect($('#sheet-select').options.map((option) => option.textContent)).toEqual(['分页数据']);
  expect($('#formula').disabled).toBe(true);
  expect($('#format').value).toBe('csv');
  expect($('#refresh').hidden).toBe(false);
  await report('list');
  expect(grid.sheetInfos).toHaveLength(1);
  expect($('#sheet-select').options).toHaveLength(1);
  expect($('#sheet-select').disabled).toBe(true);
  expect($('#formula').disabled).toBe(false);
  expect($('#refresh').hidden).toBe(true);
  expect($('#format').options.every((option) => !option.disabled)).toBe(true);
});
it('does not commit formula drafts on IME confirmation keys', async () => {
  const { grid, report, $ } = mount();
  await report('sheets');
  $('#formula').value = '草稿';
  $('#formula').onkeydown!({ key: 'Enter', isComposing: true });
  $('#formula').onkeydown!({ key: 'Enter', keyCode: 229 });
  expect(grid.getCell('A1')?.value).toBe('指标');
  $('#formula').onkeydown!({ key: 'Enter' });
  expect(grid.getCell('A1')?.value).toBe('草稿');
});

it('refreshes the formula bar immediately after applying a formula', async () => {
  const { grid, report, $ } = mount();
  await report('formulas');
  grid.select({ row: 0, col: 1 });
  $('#formula').value = '=SUM(1,2,3)';
  $('#apply').click();
  expect(grid.getCell('B1')?.value).toBe('=SUM(1,2,3)');
  expect(grid.getValue('B1')).toBe(6);
  expect($('#selected').textContent).toBe('B1');
  expect($('#value').textContent).toBe('结果：6');
  expect($('#formula').value).toBe('=SUM(1,2,3)');
});
it('keeps pointer fallback single-shot when Safari loses or delays a click', async () => {
  const first = mount();
  await first.report('list');
  first.$('#formula').value = '1.00';
  first.$('#formula').listeners.get('input')!();
  const firstApply = first.$('#apply');
  const firstSet = vi.spyOn(first.grid, 'setCell');
  firstApply.listeners.get('mousedown')!({ button: 0 });
  firstApply.listeners.get('mouseup')!({ button: 0 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(firstSet).toHaveBeenCalledTimes(1);
  expect(first.grid.getValue('A1')).toBe(1);
  expect(first.$('#formula').value).toBe('1');
  await firstApply.onclick!({ detail: 1 });
  expect(firstSet).toHaveBeenCalledTimes(1);
  first.$('#formula').value = 'keyboard after fallback';
  first.$('#formula').onkeydown!({ key: 'Enter' });
  expect(firstSet).toHaveBeenCalledTimes(2);
  expect(first.grid.getValue('A1')).toBe('keyboard after fallback');
  dispose!();
  dispose = undefined;

  const second = mount();
  await second.report('list');
  second.$('#formula').value = 'normal pointer click';
  second.$('#formula').listeners.get('input')!();
  const secondSet = vi.spyOn(second.grid, 'setCell');
  second.$('#apply').listeners.get('mousedown')!({ button: 0 });
  second.$('#apply').listeners.get('mouseup')!({ button: 0 });
  await second.$('#apply').click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(secondSet).toHaveBeenCalledTimes(1);
  expect(second.grid.getValue('A1')).toBe('normal pointer click');
});

it('does not infer a completed activation from the native release-before-down anomaly', async () => {
  const { grid, $, report } = mount();
  await report('list');
  $('#formula').value = 'retain incomplete activation';
  $('#formula').listeners.get('input')!();
  const set = vi.spyOn(grid, 'setCell');
  const apply = $('#apply');
  // Observed after mouse-cancelling Safari's native leave-page sheet, including
  // on a control page without Lumina. The first activation has no final release.
  apply.listeners.get('pointerup')!({ isPrimary: true, button: 0, pointerType: 'mouse' });
  apply.listeners.get('mouseup')!({ button: 0 });
  apply.listeners.get('pointerdown')!({ isPrimary: true, button: 0 });
  apply.listeners.get('mousedown')!({ button: 0 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(set).not.toHaveBeenCalled();
  expect(grid.getValue('A1')).toBe('月份');
  expect($('#formula').value).toBe('retain incomplete activation');

  apply.listeners.get('mousedown')!({ button: 0 });
  apply.listeners.get('mouseup')!({ button: 0 });
  await apply.onclick!({ detail: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(set).toHaveBeenCalledTimes(1);
  expect(grid.getValue('A1')).toBe('retain incomplete activation');
  grid.undo();
  expect(grid.getValue('A1')).toBe('月份');
});

it('does not apply a pointer release to a different cell, a disabled button or a secondary button', async () => {
  const { grid, $, report } = mount();
  await report('list');
  $('#formula').value = 'keep as draft';
  $('#formula').listeners.get('input')!();
  const set = vi.spyOn(grid, 'setCell');
  $('#apply').listeners.get('mouseup')!({ button: 0 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(set).not.toHaveBeenCalled();
  $('#apply').listeners.get('mousedown')!({ button: 0 });
  $('#apply').listeners.get('pointerleave')!();
  $('#apply').listeners.get('mouseup')!({ button: 0 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(set).not.toHaveBeenCalled();
  $('#apply').listeners.get('mouseup')!({ button: 2 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(set).not.toHaveBeenCalled();
  $('#apply').disabled = true;
  $('#apply').listeners.get('mouseup')!({ button: 0 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(set).not.toHaveBeenCalled();
  $('#apply').disabled = false;
  $('#apply').listeners.get('mousedown')!({ button: 0 });
  $('#apply').listeners.get('mouseup')!({ button: 0 });
  grid.select({ row: 0, col: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(set).not.toHaveBeenCalled();
});

it('exposes the financial formula examples shipped by the engine', async () => {
  const { grid, report } = mount();
  await report('formulas');
  expect(grid.getValue('B18')).toBeCloseTo(0.2488833566, 8);
  expect(grid.getValue('B19')).toBeCloseTo(0.0292285408, 8);
});

it('uses SDK import ownership so edits cancel late parsing instead of being overwritten', async () => {
  const { grid, $, report } = mount();
  await report('sheets');
  const incoming = grid.toJSON();
  incoming.name = 'late incoming';
  let resolve!: (bytes: ArrayBuffer) => void;
  const file = new File(['{}'], 'incoming.json');
  file.arrayBuffer = () =>
    new Promise((yes) => {
      resolve = yes;
    });
  $('#json-file').files = [file];
  const pending = $('#json-file').onchange!();
  grid.setCell('A1', 'new edit');
  await pending;
  resolve(new TextEncoder().encode(JSON.stringify(incoming)).buffer);
  await Promise.resolve();
  expect(grid.toJSON().name).not.toBe('late incoming');
  expect(grid.getCell('A1')?.value).toBe('new edit');
  expect($('#status').textContent).toBe('操作已取消');
});

it('makes sheets from an imported workbook selectable', async () => {
  const { grid, $, report } = mount();
  await report('sheets');
  const incoming = grid.toJSON();
  incoming.name = 'imported workbook';
  incoming.sheets[0].name = 'Imported detail';
  await report('list');
  $('#json-file').files = [new File([JSON.stringify(incoming)], 'incoming.json')];
  await $('#json-file').onchange!();
  expect(grid.toJSON().name).toBe('imported workbook');
  expect($('#sheet-select').options.map((option) => option.textContent)).toEqual([
    'Imported detail',
    '经营汇总',
  ]);
  $('#sheet-select').value = incoming.sheets[0].id;
  $('#sheet-select').onchange!();
  expect(grid.activeSheetInfo.name).toBe('Imported detail');
});

it('materializes the complete bounded source and unlocks static editing and export', async () => {
  const { grid, report, $ } = mount();
  await report('paged');
  await report('snapshot');
  expect($('#status').dataset.error).toBe('false');
  expect(grid.activeSheetInfo.readOnly).toBe(false);
  expect(grid.toJSON().sheets[0].dataSource).toEqual({ kind: 'static', totalRows: 200 });
  expect(grid.getCell('A200')?.value).toBe(200);
  expect(grid.getCell('C200')?.value).toBe(2990);
  expect($('#format').options.every((option) => !option.disabled)).toBe(true);
  expect($('#formula').disabled).toBe(false);
  expect($('#cancel').hidden).toBe(true);
  grid.setCell('C200', 5000);
  grid.undo();
  expect(grid.getCell('C200')?.value).toBe(2990);
});

it('cancels materialization without replacing the current workbook', async () => {
  const { grid, report, $ } = mount();
  const id = grid.toJSON().id;
  const pending = report('snapshot');
  $('#cancel').click();
  await pending;
  expect(grid.toJSON().id).toBe(id);
  expect($('#status').textContent).toBe('操作已取消');
  expect($('#cancel').hidden).toBe(true);
});

it('never overwrites a newer example or edit with a late materialized workbook', async () => {
  const { grid, report, $ } = mount();
  const pending = report('snapshot');
  await report('sheets');
  await pending;
  expect(grid.sheetInfos).toHaveLength(2);
  expect($('#status').dataset.error).toBe('false');
  const again = report('snapshot');
  grid.setCell('A1', 'keep edit');
  await again;
  expect(grid.getCell('A1')?.value).toBe('keep edit');
  expect($('#cancel').hidden).toBe(true);
});

function pendingImport($: ReturnType<typeof mount>['$'], incoming: sdk.Workbook) {
  let resolve!: (bytes: ArrayBuffer) => void;
  const file = new File(['{}'], 'delayed.json');
  file.arrayBuffer = () =>
    new Promise<ArrayBuffer>((yes) => {
      resolve = yes;
    });
  $('#json-file').files = [file];
  const pending = $('#json-file').onchange!();
  return {
    pending,
    finish: () => resolve(new TextEncoder().encode(JSON.stringify(incoming)).buffer),
  };
}

it('cancels import waiting from the shared cancel button and preserves the old workbook', async () => {
  const { grid, $ } = mount();
  const before = grid.toJSON();
  const incoming = structuredClone(before);
  incoming.name = 'late file';
  const operation = pendingImport($, incoming);
  const cancelVisible = !$('#cancel').hidden;
  $('#cancel').click();
  const settled = await Promise.race([
    Promise.resolve(operation.pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 40)),
  ]);
  operation.finish();
  await operation.pending;
  expect(cancelVisible).toBe(true);
  expect(settled).toBe(true);
  expect(grid.toJSON()).toEqual(before);
  expect($('#status').textContent).toBe('操作已取消');
  expect($('#cancel').hidden).toBe(true);
});

it('prevents an older file from committing while a newer snapshot is still being generated', async () => {
  const { grid, report, $ } = mount();
  const before = grid.toJSON();
  const incoming = structuredClone(before);
  incoming.name = 'late file';
  const operation = pendingImport($, incoming);
  const generating = report('snapshot');
  operation.finish();
  await operation.pending;
  const during = grid.toJSON();
  const cancelVisible = !$('#cancel').hidden;
  $('#cancel').click();
  await generating;
  expect(during).toEqual(before);
  expect(cancelVisible).toBe(true);
  expect(grid.toJSON()).toEqual(before);
  expect($('#status').textContent).toBe('操作已取消');
});

it('keeps a new import cancellable after superseding an older import', async () => {
  const { grid, $ } = mount();
  const before = grid.toJSON();
  const first = pendingImport($, before);
  const second = pendingImport($, { ...before, name: 'newer file' });
  await first.pending;
  expect($('#cancel').hidden).toBe(false);
  first.finish();
  second.finish();
  await second.pending;
  expect(grid.toJSON().name).toBe('newer file');
  expect($('#cancel').hidden).toBe(true);
});

it('keeps a newer import cancel control visible after sheet navigation stops an export', async () => {
  const { grid, report, $ } = mount();
  await report('sheets');
  const operation = pendingImport($, grid.toJSON());
  $('#sheet-select').value = grid.sheetInfos[0].id;
  $('#sheet-select').onchange!();
  expect($('#cancel').hidden).toBe(false);
  $('#cancel').click();
  await operation.pending;
  operation.finish();
  expect($('#cancel').hidden).toBe(true);
});

it('aborts file waiting on pagehide without applying late input or changing the final status', async () => {
  const { grid, $ } = mount();
  const operation = pendingImport($, grid.toJSON());
  const before = $('#status').textContent;
  dispose!();
  dispose = undefined;
  const settled = await Promise.race([
    Promise.resolve(operation.pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 40)),
  ]);
  operation.finish();
  await operation.pending;
  expect(settled).toBe(true);
  expect($('#status').textContent).toBe(before);
  expect($('#cancel').hidden).toBe(true);
});

it.each(['00123', '9007199254740993', '0.1234567890123456789', '1e-999', '3e-324', '-0.00'])(
  'preserves numeric-looking input %s in the standalone formula bar',
  async (text) => {
    const { grid, report, $ } = mount();
    await report('sheets');
    $('#formula').value = text;
    $('#apply').click();
    expect(grid.getCell('A1')?.value).toBe(text);
  },
);
