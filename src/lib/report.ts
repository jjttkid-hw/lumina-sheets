import { cellKey, columnLabel, MAX_COLUMNS, MAX_ROWS } from './engine';
import type { CellRange, CellStyle, CellValue, Workbook } from './types';
import { createBlankWorkbook } from './seed';

export type ReportRecord = Record<string, CellValue | null | undefined>;
export interface ReportColumn {
  field: string;
  title: string;
  width?: number;
  format?: CellStyle['format'];
  /** Use {row} for the generated 1-based row number, e.g. =C{row}-D{row}. */
  formula?: string;
  aggregate?: 'sum' | 'count' | 'average';
}
export interface ConditionalRule {
  /** Omit to apply the rule to every sheet. */
  sheetId?: string;
  range: CellRange;
  operator: 'greaterThan' | 'lessThan' | 'equal' | 'between' | 'contains';
  value: CellValue;
  upper?: number;
  style: CellStyle;
}
export interface ReportDefinition {
  name: string;
  layout: 'list' | 'group' | 'cross';
  columns: ReportColumn[];
  /** One to eight unique, nonblank grouping fields. Duplicate fields are ignored. */
  groupBy?: string | string[];
  /**
   * Insert a repeated header after this many detail rows (list/group only).
   * This is a worksheet layout aid, not a PDF/Excel print-page break.
   * Group headings and subtotals do not count toward rowsPerPage.
   */
  pagination?: { rowsPerPage: number; repeatHeader?: boolean };
  cross?: { rows: string; columns: string; value: string; aggregate?: 'sum' | 'count' };
  conditionalRules?: ConditionalRule[];
}
const header: CellStyle = { bold: true, color: '#23644d', background: '#e8f2ec' };
const subtotal: CellStyle = { bold: true, background: '#f0f5f1', format: 'number' };
const MAX_GROUP_LEVELS = 8;
const MAX_FORMULA_LENGTH = 8192;
// Match the evaluator's range size limit while allowing larger totals through multiple ranges.
const MAX_AGGREGATE_RANGE_ROWS = 100_000;
type DetailRange = { start: number; end: number };

function appendDetailRange(ranges: DetailRange[], start: number, end = start) {
  const last = ranges[ranges.length - 1];
  if (last && last.end + 1 === start) last.end = end;
  else ranges.push({ start, end });
}

function aggregateFormula(column: ReportColumn, col: number, ranges: DetailRange[]): string {
  const fn =
    column.aggregate === 'average' ? 'AVERAGE' : column.aggregate === 'count' ? 'COUNTA' : 'SUM';
  const label = columnLabel(col);
  const refs: string[] = [];
  for (const range of ranges) {
    for (let start = range.start; start <= range.end; start += MAX_AGGREGATE_RANGE_ROWS) {
      const end = Math.min(range.end, start + MAX_AGGREGATE_RANGE_ROWS - 1);
      refs.push(start === end ? `${label}${start + 1}` : `${label}${start + 1}:${label}${end + 1}`);
    }
  }
  const formula = `=${fn}(${refs.join(',')})`;
  if (formula.length > MAX_FORMULA_LENGTH)
    throw new Error('报表汇总公式超过 8192 字符上限，请减少分组或重复表头数量');
  return formula;
}

/** Browser-only report layout/data binding. Does not execute JavaScript from the template. */
export function generateReport(definition: ReportDefinition, records: ReportRecord[]): Workbook {
  if (!['list', 'group', 'cross'].includes(definition.layout)) throw new Error('不支持的报表布局');
  if (
    !Array.isArray(definition.columns) ||
    !definition.columns.length ||
    definition.columns.length > MAX_COLUMNS
  )
    throw new Error('请配置有效的报表列');
  if (records.length > MAX_ROWS) throw new Error('报表超过 Excel 行数上限');
  const pagination = definition.pagination;
  if (pagination !== undefined) {
    if (definition.layout === 'cross') throw new Error('交叉报表不支持重复表头分页配置');
    if (
      !pagination ||
      !Number.isInteger(pagination.rowsPerPage) ||
      pagination.rowsPerPage < 1 ||
      pagination.rowsPerPage > MAX_ROWS
    )
      throw new Error('分页行数必须为有效的正整数');
    if (pagination.repeatHeader !== undefined && typeof pagination.repeatHeader !== 'boolean')
      throw new Error('重复表头配置必须为布尔值');
  }
  let groupFields: string[] = [];
  if (definition.layout === 'group') {
    const fields = Array.isArray(definition.groupBy) ? definition.groupBy : [definition.groupBy];
    if (!fields.length || fields.some((field) => typeof field !== 'string' || !field.trim()))
      throw new Error('分组报表需要有效的分组字段');
    groupFields = [...new Set(fields as string[])];
    if (groupFields.length > MAX_GROUP_LEVELS) throw new Error('分组层级最多为 8 级');
  }
  const book = createBlankWorkbook(definition.name);
  book.category = '前端报表';
  book.description = '基于配置和结构化数据，在浏览器生成报表。';
  const sheet = book.sheets[0];
  sheet.name = '报表';
  sheet.cells = {};
  sheet.merges = [];
  sheet.frozenRows = 1;
  sheet.columnWidths = {};
  let row = 0;
  const write = (values: CellValue[], style?: CellStyle) => {
    if (row >= MAX_ROWS) throw new Error('分组展开后的报表超过行数上限');
    values.forEach((value, col) => {
      if (typeof value === 'string' && value.startsWith('=') && value.length > MAX_FORMULA_LENGTH)
        throw new Error('报表公式超过 8192 字符上限');
      sheet.cells[cellKey(row, col)] = { value, ...(style ? { style } : {}) };
    });
    row++;
  };
  if (definition.layout === 'cross') {
    const cross = definition.cross;
    if (!cross) throw new Error('交叉报表需要行字段、列字段和数值字段');
    const categories = [
      ...new Set(records.map((record) => String(record[cross.columns] ?? '未分类'))),
    ];
    if (categories.length + 2 > MAX_COLUMNS) throw new Error('交叉报表列数超过上限');
    const groups = new Map<string, Map<string, number>>();
    for (const record of records) {
      const key = String(record[cross.rows] ?? '未分类'),
        category = String(record[cross.columns] ?? '未分类');
      const group = groups.get(key) ?? new Map();
      const value = cross.aggregate === 'count' ? 1 : Number(record[cross.value] ?? 0);
      if (!Number.isFinite(value)) throw new Error('交叉汇总字段必须为有效数值');
      group.set(category, (group.get(category) ?? 0) + value);
      groups.set(key, group);
    }
    write([cross.rows, ...categories, '合计'], header);
    for (const [key, group] of groups) {
      const values = categories.map((category) => group.get(category) ?? 0);
      write([key, ...values, values.reduce((a, b) => a + b, 0)]);
    }
    write(
      [
        '合计',
        ...categories.map((category) =>
          [...groups.values()].reduce((n, group) => n + (group.get(category) ?? 0), 0),
        ),
        [...groups.values()].reduce(
          (n, group) => n + [...group.values()].reduce((a, b) => a + b, 0),
          0,
        ),
      ],
      subtotal,
    );
    sheet.colCount = categories.length + 2;
  } else {
    const columns = definition.columns;
    let pageDetailCount = 0;
    const writeHeader = () =>
      write(
        columns.map((column) => column.title),
        header,
      );
    writeHeader();
    columns.forEach((column, index) => {
      sheet.columnWidths![index] = Math.max(64, Math.min(600, column.width ?? 140));
    });
    const writeRecord = (record: ReportRecord): number => {
      if (pagination && pageDetailCount >= pagination.rowsPerPage) {
        if (pagination.repeatHeader !== false) writeHeader();
        pageDetailCount = 0;
      }
      const r = row;
      write(
        columns.map(
          (column) =>
            column.formula?.replaceAll('{row}', String(r + 1)) ?? record[column.field] ?? '',
        ),
      );
      columns.forEach((column, col) => {
        if (column.format) sheet.cells[cellKey(r, col)].style = { format: column.format };
      });
      pageDetailCount++;
      return r;
    };
    const total = (ranges: DetailRange[], label: string) => {
      if (!ranges.length) return;
      write(
        columns.map((column, col) =>
          column.aggregate ? aggregateFormula(column, col, ranges) : col === 0 ? label : '',
        ),
        subtotal,
      );
    };
    const writeDetails = (subset: ReportRecord[]): DetailRange[] => {
      const ranges: DetailRange[] = [];
      for (const record of subset) appendDetailRange(ranges, writeRecord(record));
      return ranges;
    };
    if (definition.layout === 'group') {
      const render = (level: number, subset: ReportRecord[]): DetailRange[] => {
        const groups = new Map<string, ReportRecord[]>();
        const field = groupFields[level];
        for (const record of subset) {
          const key = String(record[field] ?? '未分类');
          const group = groups.get(key) ?? [];
          group.push(record);
          groups.set(key, group);
        }
        const allDetails: DetailRange[] = [];
        for (const [key, group] of groups) {
          const groupRow = row;
          write([`${key} · ${group.length} 条记录`], header);
          if (columns.length > 1)
            (sheet.merges ??= []).push({
              start: { row: groupRow, col: 0 },
              end: { row: groupRow, col: columns.length - 1 },
            });
          const details =
            level === groupFields.length - 1 ? writeDetails(group) : render(level + 1, group);
          for (const range of details) appendDetailRange(allDetails, range.start, range.end);
          total(details, `${key}小计`);
        }
        return allDetails;
      };
      render(0, records);
    } else {
      total(writeDetails(records), '合计');
    }
    sheet.colCount = columns.length;
  }
  sheet.rowCount = Math.max(1, row);
  return book;
}

export function conditionalStyle(
  rules: ConditionalRule[],
  row: number,
  col: number,
  value: CellValue,
): CellStyle {
  const style: CellStyle = {};
  for (const rule of rules) {
    const { start, end } = rule.range;
    if (row < start.row || row > end.row || col < start.col || col > end.col) continue;
    const n = Number(value),
      target = Number(rule.value);
    const match =
      rule.operator === 'contains'
        ? String(value).includes(String(rule.value))
        : rule.operator === 'equal'
          ? value === rule.value
          : value !== '' &&
            Number.isFinite(n) &&
            Number.isFinite(target) &&
            (rule.operator === 'greaterThan'
              ? n > target
              : rule.operator === 'lessThan'
                ? n < target
                : n >= target && n <= (rule.upper ?? target));
    if (match) Object.assign(style, rule.style);
  }
  return style;
}
