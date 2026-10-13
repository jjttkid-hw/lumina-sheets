import { cellKey } from './engine';
import { createBlankWorkbook } from './seed';
import type { CellValue, Workbook } from './types';
import type { ReportRecord } from './report';

export const PIVOT_LIMITS = Object.freeze({
  records: 100_000,
  groups: 10_000,
  categories: 256,
  measures: 8,
  rowFields: 8,
  outputCells: 100_000,
  textUnits: 8_000_000,
});
export type PivotAggregate = 'sum' | 'count' | 'average' | 'min' | 'max';
export interface PivotValueField {
  field: string;
  title?: string;
  aggregate?: PivotAggregate;
}
export interface PivotDefinition {
  name?: string;
  /** One to eight unique row fields. */
  rows: string[];
  /** Optional column grouping field; blank and typed values remain distinct. */
  columns?: string;
  values: PivotValueField[];
  /** Default first-seen order; label order uses UTF-16 comparison, then first-seen ties. */
  sort?: 'input' | 'label';
  maxGroups?: number;
  maxColumns?: number;
}
export interface PivotColumn {
  key: string;
  label: string;
  field: string;
  aggregate: PivotAggregate;
  category?: string;
  total?: boolean;
}
export interface PivotRow {
  keys: string[];
  cells: number[];
}
export interface PivotTable {
  rowFields: string[];
  columnField?: string;
  values: Array<{ field: string; title: string; aggregate: PivotAggregate }>;
  columns: PivotColumn[];
  rows: PivotRow[];
  /** Same measure/category order as columns; averages use underlying records. */
  grandTotals: number[];
  records: number;
}

function field(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128)
    throw new TypeError(`${label}必须为 1–128 个字符的非空文字。`);
  return value;
}
function limit(value: unknown, maximum: number, label: string) {
  if (value === undefined) return maximum;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RangeError(`${label}必须为 1–${maximum.toLocaleString('en-US')} 的整数。`);
  return value;
}
type Dimension = { id: string; label: string };
function dimension(value: CellValue | null | undefined): Dimension {
  if (value === null || value === undefined || value === '')
    return { id: 'blank', label: '未分类' };
  if (
    !['string', 'number', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && !Number.isFinite(value))
  )
    throw new TypeError('透视维度必须为文字、有限数字、布尔值或空值。');
  if (typeof value === 'string' && value.length > 32767)
    throw new RangeError('透视维度文字超过 32,767 个字符。');
  return { id: JSON.stringify([typeof value, value]), label: String(value) };
}
type State = { sum: number; count: number; min: number; max: number };
const state = (): State => ({ sum: 0, count: 0, min: Infinity, max: -Infinity });
function add(target: State, value: CellValue | null | undefined, aggregate: PivotAggregate) {
  if (aggregate === 'count') {
    target.count++;
    return;
  }
  if (value === null || value === undefined || value === '') return;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError('透视数值字段仅接受有限数字或空值；不会转换文字和布尔值。');
  if (aggregate === 'sum' || aggregate === 'average') {
    target.sum += value;
    if (!Number.isFinite(target.sum)) throw new RangeError('透视汇总数值溢出，未返回部分结果。');
  }
  target.count++;
  target.min = Math.min(target.min, value);
  target.max = Math.max(target.max, value);
}
function read(value: State | undefined, aggregate: PivotAggregate) {
  if (!value || !value.count) return 0;
  return aggregate === 'count'
    ? value.count
    : aggregate === 'average'
      ? value.sum / value.count
      : aggregate === 'min'
        ? value.min
        : aggregate === 'max'
          ? value.max
          : value.sum;
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function compareKeys(a: string[], b: string[]) {
  for (let i = 0; i < a.length; i++) {
    const diff = compare(a[i], b[i]);
    if (diff) return diff;
  }
  return 0;
}

/** Synchronous bounded snapshot analysis. Does not mutate input or evaluate formula strings. */
export function createPivot(
  definition: PivotDefinition,
  records: readonly ReportRecord[],
): PivotTable {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition))
    throw new TypeError('透视配置必须为对象。');
  if (!Array.isArray(records) || records.length > PIVOT_LIMITS.records)
    throw new RangeError('透视记录数不能超过 100,000。');
  if (
    !Array.isArray(definition.rows) ||
    definition.rows.length < 1 ||
    definition.rows.length > PIVOT_LIMITS.rowFields
  )
    throw new RangeError('透视行字段必须为 1–8 个。');
  const rowFields = Array.from(definition.rows, (item) => field(item, '透视行字段'));
  if (new Set(rowFields).size !== rowFields.length) throw new TypeError('透视行字段不能重复。');
  const columnField =
    definition.columns === undefined ? undefined : field(definition.columns, '透视列字段');
  if (definition.name !== undefined) field(definition.name, '透视名称');
  if (
    !Array.isArray(definition.values) ||
    definition.values.length < 1 ||
    definition.values.length > PIVOT_LIMITS.measures
  )
    throw new RangeError('透视值字段必须为 1–8 个。');
  const values = Array.from(definition.values, (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new TypeError('透视值字段无效。');
    const aggregate = item.aggregate ?? 'sum';
    if (!['sum', 'count', 'average', 'min', 'max'].includes(aggregate))
      throw new TypeError('不支持的透视聚合方式。');
    const valueField = field(item.field, '透视值字段');
    return {
      field: valueField,
      title: item.title === undefined ? valueField : field(item.title, '透视指标名称'),
      aggregate: aggregate as PivotAggregate,
    };
  });
  if (definition.sort !== undefined && definition.sort !== 'input' && definition.sort !== 'label')
    throw new TypeError('透视排序必须为 input 或 label。');
  const maxGroups = limit(definition.maxGroups, PIVOT_LIMITS.groups, '透视分组上限');
  const maxColumns = limit(definition.maxColumns, PIVOT_LIMITS.categories, '透视列分类上限');
  const groups = new Map<
    string,
    { keys: string[]; buckets: Map<string, State[]>; totals: State[] }
  >();
  const categories = new Map<string, { label: string; totals: State[] }>();
  const grand = values.map(state);
  let textUnits = 0;
  const checkOutput = () => {
    const width = rowFields.length + (columnField ? categories.size + 1 : 1) * values.length;
    if ((groups.size + 2) * width > PIVOT_LIMITS.outputCells)
      throw new RangeError('透视输出超过 100,000 格，未生成部分结果。');
  };
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new TypeError('透视记录必须为对象。');
    const dimensions = rowFields.map((item) =>
      dimension(Object.hasOwn(record, item) ? record[item] : undefined),
    );
    const category = columnField
      ? dimension(Object.hasOwn(record, columnField) ? record[columnField] : undefined)
      : { id: '', label: '' };
    textUnits += dimensions.reduce((n, item) => n + item.label.length, 0) + category.label.length;
    if (textUnits > PIVOT_LIMITS.textUnits) throw new RangeError('透视维度文字超过扫描上限。');
    const id = JSON.stringify(dimensions.map((item) => item.id));
    let group = groups.get(id);
    if (!group) {
      if (groups.size >= maxGroups) throw new RangeError('透视分组数量超过上限。');
      group = {
        keys: dimensions.map((item) => item.label),
        buckets: new Map(),
        totals: values.map(state),
      };
      groups.set(id, group);
    }
    let column = categories.get(category.id);
    if (!column) {
      if (columnField && categories.size >= maxColumns)
        throw new RangeError('透视列分类数量超过上限。');
      column = { label: category.label, totals: values.map(state) };
      categories.set(category.id, column);
    }
    checkOutput();
    const bucket = group.buckets.get(category.id) ?? values.map(state);
    group.buckets.set(category.id, bucket);
    values.forEach((value, index) => {
      const raw = Object.hasOwn(record, value.field) ? record[value.field] : undefined;
      for (const target of [
        bucket[index],
        group!.totals[index],
        column!.totals[index],
        grand[index],
      ])
        add(target, raw, value.aggregate);
    });
  }
  checkOutput();
  const orderedGroups = [...groups.values()];
  const orderedCategories = [...categories];
  if (definition.sort === 'label') {
    orderedGroups.sort((a, b) => compareKeys(a.keys, b.keys));
    orderedCategories.sort((a, b) => compare(a[1].label, b[1].label));
  }
  const columns: PivotColumn[] = [];
  if (columnField)
    for (const [id, category] of orderedCategories)
      values.forEach((value, index) =>
        columns.push({
          key: JSON.stringify(['category', id, index]),
          label: `${category.label} · ${value.title}`,
          field: value.field,
          aggregate: value.aggregate,
          category: category.label,
        }),
      );
  values.forEach((value, index) =>
    columns.push({
      key: JSON.stringify(['total', index]),
      label: columnField ? `合计 · ${value.title}` : value.title,
      field: value.field,
      aggregate: value.aggregate,
      ...(columnField ? { total: true } : {}),
    }),
  );
  // Labels are repeated in headers and every output row. Bound that expansion
  // before allocating the Cartesian result or constructing a workbook.
  const outputTextUnits =
    rowFields.reduce((n, text) => n + text.length, 0) +
    columns.reduce((n, column) => n + column.label.length, 0) +
    orderedGroups.reduce((n, group) => n + group.keys.reduce((m, key) => m + key.length, 0), 0) +
    2;
  if (outputTextUnits > PIVOT_LIMITS.textUnits)
    throw new RangeError('透视输出文字超过 8,000,000 字符，未生成部分结果。');
  const rows = orderedGroups.map((group) => ({
    keys: [...group.keys],
    cells: [
      ...(columnField
        ? orderedCategories.flatMap(([id]) =>
            values.map((value, index) => read(group.buckets.get(id)?.[index], value.aggregate)),
          )
        : []),
      ...values.map((value, index) => read(group.totals[index], value.aggregate)),
    ],
  }));
  return {
    rowFields,
    ...(columnField ? { columnField } : {}),
    values,
    columns,
    rows,
    grandTotals: [
      ...(columnField
        ? orderedCategories.flatMap(([, category]) =>
            values.map((value, index) => read(category.totals[index], value.aggregate)),
          )
        : []),
      ...values.map((value, index) => read(grand[index], value.aggregate)),
    ],
    records: records.length,
  };
}

/** Produces an ordinary editable workbook snapshot, not an Excel pivot-table object. */
export function generatePivotReport(
  definition: PivotDefinition,
  records: readonly ReportRecord[],
): Workbook {
  const pivot = createPivot(definition, records);
  const book = createBlankWorkbook(definition.name ?? '透视分析');
  const sheet = book.sheets[0];
  sheet.name = '透视分析';
  sheet.cells = {};
  sheet.frozenRows = 1;
  sheet.rowCount = pivot.rows.length + 2;
  sheet.colCount = pivot.rowFields.length + pivot.columns.length;
  sheet.columnWidths = Object.fromEntries(
    Array.from({ length: sheet.colCount }, (_, i) => [i, i < pivot.rowFields.length ? 140 : 160]),
  );
  const write = (row: number, cells: CellValue[], heading = false) => {
    cells.forEach((value, col) => {
      if (typeof value === 'string' && value.startsWith('='))
        throw new TypeError('透视标签不能以 = 开头，避免被工作表解释为公式。');
      if (typeof value === 'string' && value.length > 32767)
        throw new RangeError('透视标签超过单元格文字上限。');
      sheet.cells[cellKey(row, col)] = {
        value,
        ...(heading
          ? { style: { bold: true, background: '#e8f2ec', color: '#23644d' } }
          : col >= pivot.rowFields.length
            ? { style: { format: 'number' } }
            : {}),
      };
    });
  };
  write(0, [...pivot.rowFields, ...pivot.columns.map((item) => item.label)], true);
  pivot.rows.forEach((row, index) => write(index + 1, [...row.keys, ...row.cells]));
  write(
    sheet.rowCount - 1,
    ['合计', ...Array(pivot.rowFields.length - 1).fill(''), ...pivot.grandTotals],
    true,
  );
  book.description = '透视分析静态快照；源数据修改后请重新生成。';
  book.category = '前端分析';
  return book;
}
