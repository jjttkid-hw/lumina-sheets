import type ExcelJS from 'exceljs';
import {
  readXlsxArchive,
  xmlChildren,
  xmlText,
  type XlsxArchive,
  type XmlElement,
} from './xlsx-archive';
import { cellKey, parseCellKey } from './engine';
import { copyDataValidationRules, type DataValidationRule } from './data-validation';
import type { CellRange, Sheet } from './types';

export const XLSX_VALIDATION_LIMITS = Object.freeze({
  rules: 1_000,
  modelEntries: 100_000,
  inlineListLength: 255,
  messageLength: 225,
});
export class XlsxValidationError extends Error {
  readonly code = 'XLSX_VALIDATION_UNSUPPORTED';
  constructor(
    message: string,
    public readonly address?: string,
  ) {
    super(`XLSX 数据验证：${message}${address ? `（${address}）` : ''}`);
    this.name = 'XlsxValidationError';
  }
}
type ValidationModel = Record<string, unknown>;
type ValidationWorksheet = ExcelJS.Worksheet & {
  dataValidations: {
    model: ValidationModel;
    add(address: string, validation: ExcelJS.DataValidation): unknown;
  };
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const operators = [
  'between',
  'notBetween',
  'equal',
  'notEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
];
function fail(message: string, address?: string): never {
  throw new XlsxValidationError(message, address);
}
function intersects(a: CellRange, b: CellRange) {
  return (
    a.start.row <= b.end.row &&
    b.start.row <= a.end.row &&
    a.start.col <= b.end.col &&
    b.start.col <= a.end.col
  );
}
function rangeName(range: CellRange) {
  const a = cellKey(range.start.row, range.start.col),
    b = cellKey(range.end.row, range.end.col);
  return a === b ? a : `${a}:${b}`;
}
function ranges(address: string): CellRange[] {
  if (!address.trim() || address.length > 32_768) fail('无效或过长的 sqref', address.slice(0, 100));
  const parts = address.trim().split(/\s+/);
  if (parts.length > XLSX_VALIDATION_LIMITS.rules) fail('sqref 分片超过 1,000 个');
  return parts.map((part) => {
    const [a, b, extra] = part.split(':');
    const start = parseCellKey(a),
      end = parseCellKey(b ?? a);
    if (extra !== undefined || !start || !end || start.row > end.row || start.col > end.col)
      fail('只支持工作表内的 A1 单格或矩形范围', part);
    return { start, end };
  });
}
function assertNoOverlap(rules: readonly DataValidationRule[]) {
  for (let i = 0; i < rules.length; i++)
    for (let j = 0; j < i; j++)
      if (intersects(rules[i].range, rules[j].range))
        fail('重叠规则无法表示为 Excel 的每格一条规则', rangeName(rules[i].range));
}
function inlineList(values: readonly unknown[], address?: string): string {
  if (
    !values.length ||
    values.some((v) => typeof v !== 'string' || !v || /[,"\r\n\u0000-\u001f]/.test(v))
  )
    fail(
      '内联列表仅支持非空文本，不能含逗号、双引号、换行或控制字符；数值/布尔列表需使用 JSON 保留类型',
      address,
    );
  const text = (values as string[]).join(',');
  // Excel's source limit is 255 characters. Include quote delimiters conservatively.
  if (text.length + 2 > XLSX_VALIDATION_LIMITS.inlineListLength)
    fail('内联列表含引号分隔符最多 255 个 UTF-16 代码单元', address);
  return `"${text}"`;
}
function message(value: unknown, address?: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > XLSX_VALIDATION_LIMITS.messageLength)
    fail('错误提示最多 225 个 UTF-16 代码单元', address);
  return value;
}
function numeric(value: unknown, address?: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'string' &&
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
  ) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fail('只支持常量数字边界，不支持引用、外部链接或计算公式', address);
}
function toExcel(rule: DataValidationRule): ExcelJS.DataValidation {
  const address = rangeName(rule.range);
  const base = {
    type: rule.kind,
    allowBlank: rule.allowBlank !== false,
    showErrorMessage: true,
    errorStyle: 'stop',
    ...(rule.message !== undefined ? { error: message(rule.message, address) } : {}),
  };
  if (rule.kind === 'list')
    return { ...base, type: 'list', formulae: [inlineList(rule.values, address)] };
  return {
    ...base,
    type: rule.kind,
    operator: rule.operator,
    formulae: 'value' in rule ? [rule.value] : [rule.min, rule.max],
  };
}

/** Applies compact range validation entries atomically, without touching worksheet cells. */
export function exportXlsxValidationRules(
  ws: ExcelJS.Worksheet,
  sheet: Pick<Sheet, 'id' | 'dataValidations'>,
): void {
  const rules = copyDataValidationRules(sheet.dataValidations ?? []);
  if (rules.some((rule) => rule.sheetId !== undefined && rule.sheetId !== sheet.id))
    fail('规则指向其他工作表，不能静默忽略');
  assertNoOverlap(rules);
  const entries = rules.map((rule) => [rangeName(rule.range), toExcel(rule)] as const);
  const target = (ws as ValidationWorksheet).dataValidations;
  if (!target || !object(target.model)) fail('ExcelJS 工作表未提供 dataValidations');
  if (Object.keys(target.model).some((key) => target.model[key] !== undefined))
    fail('目标工作表已有数据验证，请使用空目标工作表导出');
  for (const [address, rule] of entries) target.add(address, rule);
}

function fromExcel(
  raw: unknown,
  range: CellRange,
  id: string,
  sheetId?: string,
): DataValidationRule {
  const address = rangeName(range);
  if (!object(raw)) fail('无效规则对象', address);
  const allowed = [
    'type',
    'operator',
    'formulae',
    'allowBlank',
    'showErrorMessage',
    'errorStyle',
    'error',
    'errorTitle',
    'prompt',
    'promptTitle',
    'showInputMessage',
  ];
  for (const key of Object.keys(raw))
    if (!allowed.includes(key)) fail(`不支持规则属性 ${key}`, address);
  if (!['whole', 'decimal', 'textLength', 'list'].includes(String(raw.type)))
    fail(`不支持 ${String(raw.type)} 规则`, address);
  if (raw.allowBlank !== undefined && typeof raw.allowBlank !== 'boolean')
    fail('allowBlank 必须为布尔值', address);
  if (raw.showErrorMessage !== true || (raw.errorStyle !== undefined && raw.errorStyle !== 'stop'))
    fail('只支持阻止无效输入的 Stop 错误策略', address);
  if (raw.prompt || raw.promptTitle || raw.errorTitle || raw.showInputMessage)
    fail('尚不支持输入提示或自定义标题，无法无损导入', address);
  const error = message(raw.error, address);
  const base = {
    id,
    range,
    allowBlank: raw.allowBlank === true,
    ...(sheetId !== undefined ? { sheetId } : {}),
    ...(error !== undefined ? { message: error } : {}),
  };
  if (!Array.isArray(raw.formulae)) fail('缺少公式边界', address);
  if (raw.type === 'list') {
    if (
      raw.operator !== undefined ||
      raw.formulae.length !== 1 ||
      typeof raw.formulae[0] !== 'string'
    )
      fail('无效内联列表规则', address);
    const source = raw.formulae[0];
    if (!source.startsWith('"') || !source.endsWith('"'))
      fail('列表只支持内联文本，不支持范围、名称或外部引用', address);
    const values = source.slice(1, -1).split(',');
    inlineList(values, address);
    return copyDataValidationRules([{ ...base, kind: 'list', values }])[0];
  }
  const operator = raw.operator ?? 'between';
  if (!operators.includes(String(operator))) fail('不支持的比较运算符', address);
  const paired = operator === 'between' || operator === 'notBetween';
  if (raw.formulae.length !== (paired ? 2 : 1)) fail('边界数量与运算符不匹配', address);
  const values = raw.formulae.map((value) => numeric(value, address));
  try {
    return copyDataValidationRules([
      {
        ...base,
        kind: raw.type,
        operator,
        ...(paired ? { min: values[0], max: values[1] } : { value: values[0] }),
      },
    ])[0];
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), address);
  }
}
function signature(rule: DataValidationRule): string {
  const { id: _id, range: _range, ...rest } = rule;
  return JSON.stringify(rest);
}
function compact(rules: DataValidationRule[]): DataValidationRule[] {
  // ExcelJS's already-loaded models may contain one entry per cell. Merge equal
  // rectangles in two passes without enumerating any additional coordinates.
  const grouped = new Map<string, DataValidationRule[]>();
  for (const rule of rules) {
    const key = signature(rule);
    const group = grouped.get(key) ?? [];
    group.push(rule);
    grouped.set(key, group);
  }
  const result: DataValidationRule[] = [];
  for (const group of grouped.values()) {
    group.sort(
      (a, b) =>
        a.range.start.row - b.range.start.row ||
        a.range.end.row - b.range.end.row ||
        a.range.start.col - b.range.start.col,
    );
    const horizontal: DataValidationRule[] = [];
    for (const rule of group) {
      const last = horizontal.at(-1);
      if (
        last &&
        last.range.start.row === rule.range.start.row &&
        last.range.end.row === rule.range.end.row &&
        last.range.end.col + 1 === rule.range.start.col
      )
        last.range.end.col = rule.range.end.col;
      else horizontal.push(rule);
    }
    horizontal.sort(
      (a, b) =>
        a.range.start.col - b.range.start.col ||
        a.range.end.col - b.range.end.col ||
        a.range.start.row - b.range.start.row,
    );
    const vertical: DataValidationRule[] = [];
    for (const rule of horizontal) {
      const last = vertical.at(-1);
      if (
        last &&
        last.range.start.col === rule.range.start.col &&
        last.range.end.col === rule.range.end.col &&
        last.range.end.row + 1 === rule.range.start.row
      )
        last.range.end.row = rule.range.end.row;
      else vertical.push(rule);
    }
    result.push(...vertical);
  }
  if (result.length > XLSX_VALIDATION_LIMITS.rules) fail('压缩后的规则范围超过 1,000 个');
  assertNoOverlap(result);
  return result.map((rule, i) => ({ ...rule, id: `xlsx-validation-${i + 1}` }));
}

/** For trusted ExcelJS models. Untrusted XLSX must use extractXlsxValidationRules before ExcelJS loads. */
export function importXlsxValidationRules(
  ws: ExcelJS.Worksheet,
  sheetId: string,
): DataValidationRule[] {
  const model = (ws as ValidationWorksheet).dataValidations?.model;
  if (!object(model)) fail('ExcelJS 工作表未提供 dataValidations');
  const entries = Object.entries(model);
  if (entries.length > XLSX_VALIDATION_LIMITS.modelEntries)
    fail('已展开的 ExcelJS 验证模型超过 100,000 项');
  const rules: DataValidationRule[] = [];
  for (const [address, raw] of entries) {
    if (raw === undefined) continue; // ExcelJS remove() deliberately leaves undefined entries.
    for (const range of ranges(address)) {
      if (rules.length >= XLSX_VALIDATION_LIMITS.modelEntries) fail('验证模型分片超过 100,000 项');
      rules.push(fromExcel(raw, range, `tmp-${rules.length}`, sheetId));
    }
  }
  return compact(rules);
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function boolean(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fail(`无效布尔属性 ${name}`);
}
function sheetXmlRules(root: XmlElement): DataValidationRule[] {
  const rules: DataValidationRule[] = [];
  const walk = (element: XmlElement, parent?: XmlElement) => {
    if (element.name === 'dataValidation' || element.name === 'dataValidations') {
      if (element.uri !== MAIN) fail('不支持扩展命名空间中的验证规则');
    }
    if (element.name === 'dataValidation') {
      if (parent?.name !== 'dataValidations' || parent.uri !== MAIN) fail('数据验证 XML 结构错误');
      const data: Record<string, unknown> = { formulae: [] };
      const address = element.attributes.sqref;
      if (!address) fail('验证规则缺少 sqref');
      for (const [name, value] of Object.entries(element.attributes)) {
        if (name === 'sqref' || name === 'xmlns' || name.startsWith('xmlns:')) continue;
        if (['allowBlank', 'showErrorMessage', 'showInputMessage'].includes(name))
          data[name] = boolean(value, name);
        else if (
          [
            'type',
            'operator',
            'errorStyle',
            'error',
            'errorTitle',
            'prompt',
            'promptTitle',
          ].includes(name)
        )
          data[name] = value;
        else fail(`不支持验证属性 ${name}`, address);
      }
      for (const formula of xmlChildren(element)) {
        if (
          formula.uri !== MAIN ||
          !['formula1', 'formula2'].includes(formula.name) ||
          xmlChildren(formula).length
        )
          fail(`不支持验证子元素 ${formula.name}`, address);
        const index = formula.name === 'formula1' ? 0 : 1;
        const values = data.formulae as unknown[];
        if (values[index] !== undefined) fail('重复的公式边界', address);
        const text = xmlText(formula);
        if (text.length > 8192) fail('验证公式过长', address);
        values[index] = text;
      }
      // Sparse formula slots (formula2 without formula1) are malformed.
      const formulae = data.formulae as unknown[];
      if (
        formulae.some((value) => value === undefined) ||
        (formulae.length && formulae[0] === undefined)
      )
        fail('缺少 formula1', address);
      for (const range of ranges(address)) {
        if (rules.length >= XLSX_VALIDATION_LIMITS.rules) fail('原始验证范围超过 1,000 个');
        rules.push(fromExcel(data, range, `xlsx-validation-${rules.length + 1}`));
      }
      return;
    }
    for (const child of xmlChildren(element)) walk(child, element);
  };
  walk(root);
  assertNoOverlap(rules);
  return rules;
}

/**
 * Reads original OOXML before ExcelJS can expand ranges or parseFloat a formula.
 * Result keys are worksheet names; returned rules contain compact rectangles.
 * Pass an existing archive to share decompression with print-layout handling.
 * Then load with source.xlsx.load(buffer, { ignoreNodes: ['dataValidations'] }).
 */
export async function extractXlsxValidationRules(
  input: ArrayBuffer | Uint8Array | XlsxArchive,
): Promise<Map<string, DataValidationRule[]>> {
  const archive =
    input instanceof ArrayBuffer || ArrayBuffer.isView(input)
      ? await readXlsxArchive(input as ArrayBuffer | Uint8Array)
      : input;
  const result = new Map<string, DataValidationRule[]>();
  for (const sheet of archive.sheets) result.set(sheet.name, sheetXmlRules(sheet.xml));
  return result;
}
