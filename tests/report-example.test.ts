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
  onclick?: () => unknown;
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
    return this.onclick?.();
  }
}
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Element);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
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
    querySelectorAll: () => [],
    createElement: () => new Element(),
    activeElement: null,
  };
  const window = {
    addEventListener: (_: string, callback: () => void) => {
      dispose = callback;
    },
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
  return { ...result, $ };
}
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
