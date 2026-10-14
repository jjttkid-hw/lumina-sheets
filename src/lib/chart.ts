import type { PivotTable } from './pivot';
import type { ReportRecord } from './report';

/** Bounded, deterministic chart preparation for browser-side rendering. */
export const CHART_LIMITS = Object.freeze({
  records: 100_000,
  categories: 512,
  series: 12,
  textUnits: 1_000_000,
});

export type ChartType = 'bar' | 'line' | 'pie';
export type ChartAggregate = 'sum' | 'count' | 'average';

export interface ChartSeriesDefinition {
  field: string;
  title?: string;
  aggregate?: ChartAggregate;
}

export interface ChartDefinition {
  type: ChartType;
  /** Field used for the category axis; values are kept as labels, never formulas. */
  category: string;
  series: ChartSeriesDefinition[];
  title?: string;
  sort?: 'input' | 'label';
  maxCategories?: number;
}

export interface ChartSeriesModel {
  field: string;
  title: string;
  aggregate: ChartAggregate;
  values: Array<number | null>;
}

export interface ChartModel {
  schema: 1;
  source: 'records' | 'pivot';
  type: ChartType;
  title?: string;
  categories: string[];
  series: ChartSeriesModel[];
  records: number;
  domain: { min: number; max: number };
}

export interface PivotChartDefinition {
  type: ChartType;
  /** Zero-based column indexes in the pivot output. Defaults to total columns. */
  series?: number[];
  title?: string;
}

function text(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new TypeError(`${label}必须为 1–${max} 个字符的非空文字。`);
  return value;
}

function limit(value: unknown, maximum: number, label: string): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum)
    throw new RangeError(`${label}必须为 1–${maximum.toLocaleString('en-US')} 的整数。`);
  return value as number;
}

function validateType(value: unknown): asserts value is ChartType {
  if (value !== 'bar' && value !== 'line' && value !== 'pie')
    throw new TypeError('图表类型必须为 bar、line 或 pie。');
}

function category(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未分类';
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
    throw new TypeError('图表分类必须为文字、有限数字、布尔值或空值。');
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new TypeError('图表分类数字必须有限。');
  const result = String(value);
  if (result.length > 32767) throw new RangeError('图表分类文字超过 32,767 个字符。');
  return result;
}

type Accumulator = { sum: number; count: number };
function readNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError(`图表数值字段“${field}”仅接受有限数字或空值；不会转换文字。`);
  return value;
}
function output(acc: Accumulator | undefined, aggregate: ChartAggregate): number | null {
  if (!acc || !acc.count) return null;
  return aggregate === 'count'
    ? acc.count
    : aggregate === 'average'
      ? acc.sum / acc.count
      : acc.sum;
}

function prepareDefinition(definition: ChartDefinition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition))
    throw new TypeError('图表配置必须为对象。');
  validateType(definition.type);
  const categoryField = text(definition.category, '图表分类字段');
  if (!Array.isArray(definition.series) || definition.series.length < 1)
    throw new RangeError('图表至少需要一个数据系列。');
  if (definition.series.length > CHART_LIMITS.series)
    throw new RangeError(`图表系列数不能超过 ${CHART_LIMITS.series}。`);
  const series = definition.series.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new TypeError('图表数据系列配置无效。');
    const aggregate = item.aggregate ?? 'sum';
    if (aggregate !== 'sum' && aggregate !== 'count' && aggregate !== 'average')
      throw new TypeError('图表聚合方式必须为 sum、count 或 average。');
    return {
      field: text(item.field, '图表数据字段'),
      title: item.title === undefined ? item.field : text(item.title, '图表系列名称'),
      aggregate: aggregate as ChartAggregate,
    };
  });
  if (new Set(series.map((item) => item.field)).size !== series.length)
    throw new TypeError('图表数据字段不能重复。');
  if (definition.sort !== undefined && definition.sort !== 'input' && definition.sort !== 'label')
    throw new TypeError('图表排序必须为 input 或 label。');
  const maxCategories = limit(definition.maxCategories, CHART_LIMITS.categories, '图表分类上限');
  if (definition.title !== undefined) text(definition.title, '图表标题', 256);
  return { categoryField, series, maxCategories };
}

/**
 * Creates a bounded chart model from records. The function never evaluates formulas,
 * mutates records, or returns a partial result after a limit/type failure.
 */
export function createChartModel(
  definition: ChartDefinition,
  records: readonly ReportRecord[],
): ChartModel {
  const prepared = prepareDefinition(definition);
  if (!Array.isArray(records) || records.length > CHART_LIMITS.records)
    throw new RangeError(`图表记录数不能超过 ${CHART_LIMITS.records.toLocaleString('en-US')}。`);
  const groups = new Map<string, { label: string; values: Accumulator[] }>();
  let textUnits = 0;
  records.forEach((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new TypeError('图表记录必须为对象。');
    const label = category(
      Object.hasOwn(record, prepared.categoryField) ? record[prepared.categoryField] : undefined,
    );
    textUnits += label.length;
    if (textUnits > CHART_LIMITS.textUnits) throw new RangeError('图表文字超过扫描上限。');
    const key = JSON.stringify([typeof label, label]);
    let group = groups.get(key);
    if (!group) {
      if (groups.size >= prepared.maxCategories) throw new RangeError('图表分类数量超过上限。');
      group = { label, values: prepared.series.map(() => ({ sum: 0, count: 0 })) };
      groups.set(key, group);
    }
    prepared.series.forEach((series, index) => {
      if (series.aggregate === 'count') {
        const value = Object.hasOwn(record, series.field) ? record[series.field] : undefined;
        if (value !== null && value !== undefined && value !== '') group!.values[index].count++;
        return;
      }
      const value = readNumber(
        Object.hasOwn(record, series.field) ? record[series.field] : undefined,
        series.field,
      );
      if (value === null) return;
      const target = group!.values[index];
      target.sum += value;
      target.count++;
      if (!Number.isFinite(target.sum)) throw new RangeError('图表汇总数值溢出，未返回部分结果。');
    });
  });
  const ordered = [...groups.values()];
  if (definition.sort === 'label')
    ordered.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  if (definition.type === 'pie' && prepared.series.length !== 1)
    throw new TypeError('饼图只能包含一个数据系列。');
  const categories = ordered.map((group) => group.label);
  const series = prepared.series.map((item, index) => ({
    ...item,
    values: ordered.map((group) => output(group.values[index], item.aggregate)),
  }));
  const numbers = series.flatMap((item) =>
    item.values.filter((value): value is number => value !== null),
  );
  if (definition.type === 'pie' && numbers.some((value) => value < 0))
    throw new RangeError('饼图数据不能包含负数。');
  return {
    schema: 1,
    source: 'records',
    type: definition.type,
    ...(definition.title === undefined ? {} : { title: definition.title }),
    categories,
    series,
    records: records.length,
    domain: {
      min: numbers.length ? Math.min(0, ...numbers) : 0,
      max: numbers.length ? Math.max(0, ...numbers) : 0,
    },
  };
}

/** Converts a pivot snapshot into the same stable model used by chart renderers. */
export function createPivotChartModel(
  pivot: PivotTable,
  definition: PivotChartDefinition,
): ChartModel {
  if (!pivot || typeof pivot !== 'object') throw new TypeError('透视快照无效。');
  validateType(definition?.type);
  if (definition.type === 'pie' && (definition.series?.length ?? 1) !== 1)
    throw new TypeError('饼图只能包含一个数据系列。');
  const totalIndexes = pivot.columns
    .map((column, index) => (column.total ? index : -1))
    .filter((index) => index >= 0);
  const defaultIndexes = totalIndexes.length
    ? totalIndexes
    : pivot.columns.map((_, index) => index);
  const indexes = definition.series === undefined ? defaultIndexes : [...definition.series];
  if (!indexes.length || indexes.length > CHART_LIMITS.series)
    throw new RangeError('透视图表系列数超出范围。');
  if (
    new Set(indexes).size !== indexes.length ||
    indexes.some(
      (index) => !Number.isSafeInteger(index) || index < 0 || index >= pivot.columns.length,
    )
  )
    throw new RangeError('透视图表系列索引无效。');
  const categories = pivot.rows.map((row) => row.keys.join(' / '));
  if (categories.length > CHART_LIMITS.categories)
    throw new RangeError('透视图表分类数量超过上限。');
  const series: ChartSeriesModel[] = indexes.map((index) => {
    const column = pivot.columns[index];
    const aggregate: ChartAggregate =
      column.aggregate === 'count' || column.aggregate === 'average' ? column.aggregate : 'sum';
    return {
      field: column.field,
      title: column.label,
      aggregate,
      values: pivot.rows.map((row) => row.cells[index] ?? null),
    };
  });
  const numbers = series.flatMap((item) =>
    item.values.filter((value): value is number => value !== null),
  );
  if (definition.type === 'pie' && numbers.some((value) => value < 0))
    throw new RangeError('饼图数据不能包含负数。');
  return {
    schema: 1,
    source: 'pivot',
    type: definition.type,
    ...(definition.title === undefined ? {} : { title: definition.title }),
    categories,
    series,
    records: pivot.records,
    domain: {
      min: numbers.length ? Math.min(0, ...numbers) : 0,
      max: numbers.length ? Math.max(0, ...numbers) : 0,
    },
  };
}
