import type { PrintSettings, Sheet } from './types';
import { copyPrintSettings } from './print-settings';
import { columnLabel, MAX_COLUMNS, MAX_ROWS, parseCellKey } from './engine';
import {
  xmlChild,
  xmlChildren,
  xmlElement,
  xmlText,
  type XmlElement,
  type XlsxArchive,
} from './xlsx-archive';

function fail(message: string): never {
  throw new Error(`XLSX 打印设置：${message}`);
}
const int = (value: string | undefined, label: string): number => {
  if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    return fail(`${label}必须为整数。`);
  return Number(value);
};
const bool = (value: string | undefined) => value === '1' || value === 'true';
function one(parent: XmlElement, name: string): XmlElement | undefined {
  const nodes = xmlChildren(parent, name);
  if (nodes.length > 1) fail(`${name} 重复。`);
  return nodes[0];
}
function checkMerges(xml: XmlElement, settings: PrintSettings) {
  for (const merge of xmlChildren(
    one(xml, 'mergeCells') ?? xmlElement('mergeCells'),
    'mergeCell',
  )) {
    const parts = (merge.attributes.ref ?? '').split(':');
    const a = parseCellKey(parts[0]),
      b = parseCellKey(parts[1] ?? parts[0]);
    if (!a || !b || a.row > b.row || a.col > b.col) fail('合并区域无效。');
    for (const [start, end, repeat, breaks] of [
      [a.row, b.row, settings.repeatRows ?? 0, settings.rowBreaks ?? []],
      [a.col, b.col, settings.repeatColumns ?? 0, settings.columnBreaks ?? []],
    ] as const) {
      if (start < repeat && end >= repeat) fail('合并区域跨越重复标题边界。');
      if (breaks.some((position) => start < position && end >= position))
        fail('手动分页跨越合并区域。');
    }
  }
}
function readBreaks(xml: XmlElement, kind: 'rowBreaks' | 'colBreaks'): number[] | undefined {
  const node = one(xml, kind);
  if (!node) return undefined;
  const entries = xmlChildren(node);
  if (entries.length > 1000) fail('单方向手动分页超过 1000 个。');
  // `max` is the span endpoint; the break id itself is on the opposite axis.
  const max = kind === 'rowBreaks' ? MAX_COLUMNS - 1 : MAX_ROWS - 1;
  const positionMax = kind === 'rowBreaks' ? MAX_ROWS - 1 : MAX_COLUMNS - 1;
  const result = entries.map((entry) => {
    if (entry.name !== 'brk' || !bool(entry.attributes.man) || bool(entry.attributes.pt))
      fail('只支持手动整行/整列分页。');
    if (
      (entry.attributes.min !== undefined && int(entry.attributes.min, '分页起点') !== 0) ||
      (entry.attributes.max !== undefined && int(entry.attributes.max, '分页终点') !== max)
    )
      fail('不支持局部区间分页。');
    const position = int(entry.attributes.id, '分页位置');
    if (position < 1 || position > positionMax) fail('分页位置超出工作表边界。');
    return position;
  });
  if (
    node.attributes.count !== undefined &&
    int(node.attributes.count, '分页数量') !== result.length
  )
    fail('分页数量与内容不一致。');
  if (
    node.attributes.manualBreakCount !== undefined &&
    int(node.attributes.manualBreakCount, '手动分页数量') !== result.length
  )
    fail('不支持自动分页记录。');
  return result;
}
function splitTitles(formula: string): string[] {
  const items: string[] = [];
  let part = '',
    quoted = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (ch === "'") {
      part += ch;
      if (quoted && formula[i + 1] === "'") {
        part += formula[++i];
        continue;
      }
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      items.push(part);
      part = '';
    } else part += ch;
  }
  if (quoted) fail('重复标题公式引号未闭合。');
  items.push(part);
  return items;
}
function parseTitles(
  formula: string,
  sheetName: string,
): Pick<PrintSettings, 'repeatRows' | 'repeatColumns'> {
  const result: Pick<PrintSettings, 'repeatRows' | 'repeatColumns'> = {};
  for (const token of splitTitles(formula)) {
    const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Za-z]+|\d+):\$?([A-Za-z]+|\d+)$/.exec(
      token.trim(),
    );
    if (!match || (match[1]?.replaceAll("''", "'") ?? match[2]) !== sheetName)
      fail('只支持本工作表前 N 行/列作为重复标题。');
    const start = match[3],
      end = match[4];
    if (/^\d+$/.test(start)) {
      if (start !== '1' || !/^\d+$/.test(end) || result.repeatRows !== undefined)
        fail('只支持从第 1 行开始的唯一重复标题区间。');
      result.repeatRows = Number(end);
    } else {
      if (
        start.toUpperCase() !== 'A' ||
        !/^[A-Za-z]+$/.test(end) ||
        result.repeatColumns !== undefined
      )
        fail('只支持从 A 列开始的唯一重复标题区间。');
      const point = parseCellKey(`${end}1`);
      if (!point) fail('重复标题列范围无效。');
      result.repeatColumns = point.col + 1;
    }
  }
  return result;
}
function isExcelJsDefaultPrintSettings(settings: PrintSettings): boolean {
  const margins = settings.margins;
  return (
    (settings.paperSize === undefined || settings.paperSize === 'A4') &&
    (settings.orientation === undefined || settings.orientation === 'portrait') &&
    (!margins ||
      (margins.top === 54 &&
        margins.right === 50.4 &&
        margins.bottom === 54 &&
        margins.left === 50.4)) &&
    (!settings.repeatRows || settings.repeatRows === 0) &&
    (!settings.repeatColumns || settings.repeatColumns === 0) &&
    (!settings.rowBreaks || settings.rowBreaks.length === 0) &&
    (!settings.columnBreaks || settings.columnBreaks.length === 0)
  );
}
/** Extracts the supported print subset. Unsupported print semantics fail instead of disappearing. */
export function readXlsxPrintSettings(
  archive: XlsxArchive,
): Map<string, PrintSettings | undefined> {
  const titleByIndex = new Map<number, string>();
  for (const name of xmlChildren(
    one(archive.workbook, 'definedNames') ?? xmlElement('definedNames'),
    'definedName',
  )) {
    if (name.attributes.name === '_xlnm.Print_Area')
      fail('暂不支持打印区域；请在原文件清除后导入。');
    if (name.attributes.name !== '_xlnm.Print_Titles') continue;
    const index = int(name.attributes.localSheetId, '重复标题工作表索引');
    if (index >= archive.sheets.length || titleByIndex.has(index))
      fail('重复标题工作表索引无效或重复。');
    titleByIndex.set(index, xmlText(name));
  }
  const result = new Map<string, PrintSettings | undefined>();
  archive.sheets.forEach((sheet, index) => {
    const xml = sheet.xml,
      setup = one(xml, 'pageSetup'),
      margins = one(xml, 'pageMargins');
    const pagePr = xmlChild(one(xml, 'sheetPr') ?? xmlElement('sheetPr'), 'pageSetUpPr');
    if (pagePr && bool(pagePr.attributes.fitToPage)) fail('暂不支持按页缩放适配。');
    if (setup?.attributes.scale !== undefined && Number(setup.attributes.scale) !== 100)
      fail('暂不支持打印缩放比例。');
    if (one(xml, 'headerFooter') && xmlText(one(xml, 'headerFooter')!).trim())
      fail('暂不支持自定义页眉页脚。');
    const settings: PrintSettings = { repeatRows: 0, repeatColumns: 0 };
    if (setup) {
      if (setup.attributes.paperSize !== undefined) {
        const paper = ({ 9: 'A4', 8: 'A3', 1: 'Letter' } as const)[
          Number(setup.attributes.paperSize) as 9 | 8 | 1
        ];
        if (!paper) fail('只支持 A4、A3、Letter 纸张。');
        settings.paperSize = paper;
      }
      if (setup.attributes.orientation !== undefined) {
        if (!['portrait', 'landscape'].includes(setup.attributes.orientation))
          fail('不支持默认或未知纸张方向。');
        settings.orientation = setup.attributes.orientation as PrintSettings['orientation'];
      }
      if (setup.attributes.pageOrder && setup.attributes.pageOrder !== 'downThenOver')
        fail('暂不支持横向优先的打印页顺序。');
      if (
        bool(setup.attributes.blackAndWhite) ||
        bool(setup.attributes.draft) ||
        bool(setup.attributes.useFirstPageNumber)
      )
        fail('暂不支持黑白、草稿或自定义起始页码。');
    }
    if (margins) {
      const value = (side: string) => {
        const raw = margins.attributes[side];
        const n = Number(raw);
        if (raw === undefined || !Number.isFinite(n) || n < 0) return fail('页边距无效。');
        return n * 72;
      };
      settings.margins = {
        top: value('top'),
        right: value('right'),
        bottom: value('bottom'),
        left: value('left'),
      };
    }
    Object.assign(
      settings,
      titleByIndex.has(index) ? parseTitles(titleByIndex.get(index)!, sheet.name) : {},
    );
    settings.rowBreaks = readBreaks(xml, 'rowBreaks');
    settings.columnBreaks = readBreaks(xml, 'colBreaks');
    const copied = copyPrintSettings(settings)!;
    checkMerges(xml, copied);
    result.set(sheet.name, isExcelJsDefaultPrintSettings(copied) ? undefined : copied);
  });
  return result;
}
const sequence = [
  'sheetPr',
  'dimension',
  'sheetViews',
  'sheetFormatPr',
  'cols',
  'sheetData',
  'sheetCalcPr',
  'sheetProtection',
  'protectedRanges',
  'scenarios',
  'autoFilter',
  'sortState',
  'dataConsolidate',
  'customSheetViews',
  'mergeCells',
  'phoneticPr',
  'conditionalFormatting',
  'dataValidations',
  'hyperlinks',
  'printOptions',
  'pageMargins',
  'pageSetup',
  'headerFooter',
  'rowBreaks',
  'colBreaks',
  'customProperties',
  'cellWatches',
  'ignoredErrors',
  'smartTags',
  'drawing',
  'legacyDrawing',
  'legacyDrawingHF',
  'picture',
  'oleObjects',
  'controls',
  'webPublishItems',
  'tableParts',
  'extLst',
];
function replace(xml: XmlElement, name: string, element?: XmlElement) {
  xml.children = xml.children.filter((child) => typeof child === 'string' || child.name !== name);
  if (!element) return;
  const priority = sequence.indexOf(name);
  const at = xml.children.findIndex(
    (child) => typeof child !== 'string' && sequence.indexOf(child.name) > priority,
  );
  if (at < 0) xml.children.push(element);
  else xml.children.splice(at, 0, element);
}
/** Writes print metadata to real OOXML, including column breaks omitted by ExcelJS. */
export function applyXlsxPrintSettings(archive: XlsxArchive, sheets: Sheet[]): void {
  let definitions = one(archive.workbook, 'definedNames');
  archive.sheets.forEach((target, index) => {
    const source = sheets.find((sheet) => sheet.name === target.name);
    if (!source) fail('导出工作表与 XML 关系不一致。');
    const print = copyPrintSettings(source.printSettings, source);
    if (!print) return;
    print.repeatRows ??= source.frozenRows ?? 0;
    print.repeatColumns ??= 0;
    copyPrintSettings(print, source);
    checkMerges(target.xml, print);
    const margins = print.margins ?? { top: 28, right: 28, bottom: 28, left: 28 };
    replace(
      target.xml,
      'pageMargins',
      xmlElement('pageMargins', {
        top: String(margins.top / 72),
        right: String(margins.right / 72),
        bottom: String(margins.bottom / 72),
        left: String(margins.left / 72),
        header: '0',
        footer: '0',
      }),
    );
    replace(
      target.xml,
      'pageSetup',
      xmlElement('pageSetup', {
        paperSize: String(({ A4: 9, A3: 8, Letter: 1 } as const)[print.paperSize ?? 'A4']),
        orientation: print.orientation ?? 'landscape',
        scale: '100',
      }),
    );
    for (const [name, values, max] of [
      ['rowBreaks', print.rowBreaks ?? [], MAX_COLUMNS - 1],
      ['colBreaks', print.columnBreaks ?? [], MAX_ROWS - 1],
    ] as const) {
      replace(
        target.xml,
        name,
        values.length
          ? xmlElement(
              name,
              { count: String(values.length), manualBreakCount: String(values.length) },
              values.map((id) =>
                xmlElement('brk', { id: String(id), min: '0', max: String(max), man: '1' }),
              ),
            )
          : undefined,
      );
    }
    if (definitions)
      definitions.children = definitions.children.filter(
        (child) =>
          typeof child === 'string' ||
          !(
            child.name === 'definedName' &&
            child.attributes.name === '_xlnm.Print_Titles' &&
            child.attributes.localSheetId === String(index)
          ),
      );
    const quoted = `'${target.name.replaceAll("'", "''")}'`;
    const titles: string[] = [];
    if (print.repeatRows) titles.push(`${quoted}!$1:$${print.repeatRows}`);
    if (print.repeatColumns) titles.push(`${quoted}!$A:$${columnLabel(print.repeatColumns - 1)}`);
    if (titles.length) {
      if (!definitions) {
        definitions = xmlElement('definedNames');
        const at = archive.workbook.children.findIndex(
          (child) => typeof child !== 'string' && child.name === 'calcPr',
        );
        if (at < 0) archive.workbook.children.push(definitions);
        else archive.workbook.children.splice(at, 0, definitions);
      }
      definitions.children.push(
        xmlElement('definedName', { name: '_xlnm.Print_Titles', localSheetId: String(index) }, [
          titles.join(','),
        ]),
      );
    }
  });
}
