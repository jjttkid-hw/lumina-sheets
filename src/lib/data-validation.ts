import { cellKey, MAX_COLUMNS, MAX_ROWS, parseCellKey } from './engine';
import type { CellRange, CellValue } from './types';

export const DATA_VALIDATION_LIMITS = Object.freeze({
  rules: 1_000,
  listValues: 1_000,
  totalListValues: 100_000,
  idLength: 100,
  sheetIdLength: 200,
  messageLength: 500,
  cellTextLength: 32_767,
});

export type ValidationOperator =
  | 'between'
  | 'notBetween'
  | 'equal'
  | 'notEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual';

interface ValidationRuleBase {
  /** Stable and unique within a rule collection. */
  id: string;
  /** Omit to apply this rule to the matching range on every checked sheet. */
  sheetId?: string;
  /** Inclusive, zero-based Excel coordinates; never expanded into individual cells. */
  range: CellRange;
  /** Only the empty string is blank. Defaults to true. */
  allowBlank?: boolean;
  message?: string;
}

export type DataValidationRule = ValidationRuleBase &
  (
    | { kind: 'list'; values: CellValue[] }
    | ({ kind: 'whole' | 'decimal' | 'textLength' } & (
        | { operator: 'between' | 'notBetween'; min: number; max: number }
        | {
            operator: Exclude<ValidationOperator, 'between' | 'notBetween'>;
            value: number;
          }
      ))
  );

export type DataValidationFailureCode =
  'BLANK_NOT_ALLOWED' | 'TYPE_MISMATCH' | 'OUT_OF_RANGE' | 'NOT_IN_LIST';

export interface DataValidationFailure {
  ruleId: string;
  sheetId: string;
  /** Canonical A1 address, without absolute-reference markers. */
  key: string;
  kind: DataValidationRule['kind'];
  code: DataValidationFailureCode;
  message: string;
  value: CellValue;
}

export class DataValidationRuleError extends TypeError {
  readonly code = 'INVALID_VALIDATION_RULE';
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'DataValidationRuleError';
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const commonKeys = ['id', 'sheetId', 'range', 'allowBlank', 'message', 'kind'];
const singleOperators = [
  'equal',
  'notEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
];

function fail(path: string, message: string): never {
  throw new DataValidationRuleError(path, message);
}
function keys(input: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(input))
    if (!allowed.includes(key)) fail(`${path}.${key}`, '不支持的属性');
}
function identifier(value: unknown, max: number, path: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    fail(path, `必须是非空且不含控制字符的文本，最多 ${max} 个 UTF-16 代码单元`);
  return value;
}
function cellValue(value: unknown, path: string): CellValue {
  if (
    !['string', 'number', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && !Number.isFinite(value)) ||
    (typeof value === 'string' && value.length > DATA_VALIDATION_LIMITS.cellTextLength)
  )
    fail(path, '必须是有限数字、布尔值或不超过 32,767 个 UTF-16 代码单元的文本');
  return value as CellValue;
}
function copyRange(input: unknown, path: string): CellRange {
  if (!object(input)) fail(path, '必须是范围对象');
  keys(input, ['start', 'end'], path);
  if (!object(input.start) || !object(input.end)) fail(path, '必须包含 start 和 end 坐标');
  keys(input.start, ['row', 'col'], `${path}.start`);
  keys(input.end, ['row', 'col'], `${path}.end`);
  const { start, end } = input;
  if (
    !integer(start.row, 0, MAX_ROWS - 1) ||
    !integer(end.row, start.row, MAX_ROWS - 1) ||
    !integer(start.col, 0, MAX_COLUMNS - 1) ||
    !integer(end.col, start.col, MAX_COLUMNS - 1)
  )
    fail(path, '范围必须按左上到右下排列，且位于 Excel 行列上限内');
  return {
    start: { row: start.row, col: start.col },
    end: { row: end.row, col: end.col },
  };
}
function threshold(value: unknown, kind: string, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '必须是有限数字');
  if (kind === 'whole' && !Number.isSafeInteger(value)) fail(path, '整数边界必须是安全整数');
  if (kind === 'textLength' && !integer(value, 0, DATA_VALIDATION_LIMITS.cellTextLength))
    fail(path, '文本长度边界必须为 0–32,767 的整数');
  return value;
}

/** Validates untrusted configuration and copies every nested range/list; no per-cell expansion. */
export function copyDataValidationRules(input: unknown): DataValidationRule[] {
  if (!Array.isArray(input) || input.length > DATA_VALIDATION_LIMITS.rules)
    fail('rules', `必须是数组，最多 ${DATA_VALIDATION_LIMITS.rules} 条规则`);
  const ids = new Set<string>();
  let listValues = 0;
  return Array.from(input, (raw, index): DataValidationRule => {
    const path = `rules[${index}]`;
    if (!object(raw)) fail(path, '必须是规则对象');
    const id = identifier(raw.id, DATA_VALIDATION_LIMITS.idLength, `${path}.id`);
    if (ids.has(id)) fail(`${path}.id`, '规则 ID 不能重复');
    ids.add(id);
    if (raw.allowBlank !== undefined && typeof raw.allowBlank !== 'boolean')
      fail(`${path}.allowBlank`, '必须为布尔值');
    if (
      raw.message !== undefined &&
      (typeof raw.message !== 'string' || raw.message.length > DATA_VALIDATION_LIMITS.messageLength)
    )
      fail(`${path}.message`, `最多 ${DATA_VALIDATION_LIMITS.messageLength} 个 UTF-16 代码单元`);
    const base: ValidationRuleBase = {
      id,
      range: copyRange(raw.range, `${path}.range`),
      allowBlank: raw.allowBlank ?? true,
      ...(raw.sheetId !== undefined
        ? {
            sheetId: identifier(
              raw.sheetId,
              DATA_VALIDATION_LIMITS.sheetIdLength,
              `${path}.sheetId`,
            ),
          }
        : {}),
      ...(raw.message !== undefined ? { message: raw.message as string } : {}),
    };
    if (raw.kind === 'list') {
      keys(raw, [...commonKeys, 'values'], path);
      if (
        !Array.isArray(raw.values) ||
        !raw.values.length ||
        raw.values.length > DATA_VALIDATION_LIMITS.listValues
      )
        fail(`${path}.values`, `必须包含 1–${DATA_VALIDATION_LIMITS.listValues} 个选项`);
      listValues += raw.values.length;
      if (listValues > DATA_VALIDATION_LIMITS.totalListValues)
        fail(
          `${path}.values`,
          `全部规则最多包含 ${DATA_VALIDATION_LIMITS.totalListValues} 个列表选项`,
        );
      const values = Array.from(raw.values, (value, i) => cellValue(value, `${path}.values[${i}]`));
      return { ...base, kind: 'list', values };
    }
    if (!['whole', 'decimal', 'textLength'].includes(String(raw.kind)))
      fail(`${path}.kind`, '仅支持 list、whole、decimal 或 textLength');
    const kind = raw.kind as 'whole' | 'decimal' | 'textLength';
    if (raw.operator === 'between' || raw.operator === 'notBetween') {
      keys(raw, [...commonKeys, 'operator', 'min', 'max'], path);
      const min = threshold(raw.min, kind, `${path}.min`);
      const max = threshold(raw.max, kind, `${path}.max`);
      if (min > max) fail(path, 'min 不能大于 max');
      return { ...base, kind, operator: raw.operator, min, max };
    }
    if (!singleOperators.includes(String(raw.operator))) fail(`${path}.operator`, '无效比较运算符');
    keys(raw, [...commonKeys, 'operator', 'value'], path);
    return {
      ...base,
      kind,
      operator: raw.operator as Exclude<ValidationOperator, 'between' | 'notBetween'>,
      value: threshold(raw.value, kind, `${path}.value`),
    };
  });
}

function numericMatch(rule: Exclude<DataValidationRule, { kind: 'list' }>, value: number): boolean {
  switch (rule.operator) {
    case 'between':
      return value >= rule.min && value <= rule.max;
    case 'notBetween':
      return value < rule.min || value > rule.max;
    case 'equal':
      return value === rule.value;
    case 'notEqual':
      return value !== rule.value;
    case 'greaterThan':
      return value > rule.value;
    case 'greaterThanOrEqual':
      return value >= rule.value;
    case 'lessThan':
      return value < rule.value;
    case 'lessThanOrEqual':
      return value <= rule.value;
  }
}

const defaultMessage: Record<DataValidationFailureCode, string> = {
  BLANK_NOT_ALLOWED: '此单元格不能为空。',
  TYPE_MISMATCH: '单元格值的类型不符合验证规则。',
  OUT_OF_RANGE: '单元格值不符合规定的数值或长度条件。',
  NOT_IN_LIST: '单元格值不在允许的选项中。',
};

/**
 * Checks a computed scalar against an already validated rule collection.
 * All overlapping rules must pass. Formula evaluation belongs to the caller;
 * this module never executes formulas or coerces numeric strings/booleans.
 */
export function checkValue(
  sheetId: string,
  key: string,
  computedValue: CellValue,
  rules: readonly DataValidationRule[],
): DataValidationFailure[] {
  if (typeof sheetId !== 'string' || !sheetId) throw new TypeError('必须提供工作表 ID');
  const point = typeof key === 'string' ? parseCellKey(key) : null;
  if (!point) throw new RangeError('无效单元格地址');
  cellValue(computedValue, 'computedValue');
  const failures: DataValidationFailure[] = [];
  let textLength: number | undefined;
  for (const rule of rules) {
    if (rule.sheetId !== undefined && rule.sheetId !== sheetId) continue;
    const { start, end } = rule.range;
    if (
      point.row < start.row ||
      point.row > end.row ||
      point.col < start.col ||
      point.col > end.col
    )
      continue;
    let code: DataValidationFailureCode | undefined;
    if (computedValue === '') {
      if (rule.allowBlank !== false) continue;
      code = 'BLANK_NOT_ALLOWED';
    } else if (rule.kind === 'list') {
      if (!rule.values.includes(computedValue)) code = 'NOT_IN_LIST';
    } else if (rule.kind === 'textLength') {
      if (typeof computedValue !== 'string') code = 'TYPE_MISMATCH';
      else {
        if (textLength === undefined) {
          textLength = 0;
          for (const _point of computedValue) textLength++;
        }
        if (!numericMatch(rule, textLength)) code = 'OUT_OF_RANGE';
      }
    } else if (
      typeof computedValue !== 'number' ||
      (rule.kind === 'whole' && !Number.isSafeInteger(computedValue))
    )
      code = 'TYPE_MISMATCH';
    else if (!numericMatch(rule, computedValue)) code = 'OUT_OF_RANGE';
    if (code)
      failures.push({
        ruleId: rule.id,
        sheetId,
        key: cellKey(point.row, point.col),
        kind: rule.kind,
        code,
        message: rule.message || defaultMessage[code],
        value: computedValue,
      });
  }
  return failures;
}
