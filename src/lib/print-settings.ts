import type { PrintSettings } from './types';

export interface PrintSettingsBounds {
  rowCount: number;
  colCount: number;
}
export const MAX_PRINT_BREAKS = 1000;
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const fields = new Set([
  'paperSize',
  'orientation',
  'margins',
  'repeatRows',
  'repeatColumns',
  'rowBreaks',
  'columnBreaks',
]);
function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function integer(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new Error(`${label}必须为 ${min}–${max} 之间的整数。`);
}

/** Strict, non-mutating validation. Bounds use worksheet dimensions, not a printable area. */
export function validatePrintSettings(
  value: unknown,
  bounds?: PrintSettingsBounds,
): asserts value is PrintSettings {
  if (!object(value)) throw new Error('打印设置必须为对象。');
  if (Object.keys(value).some((key) => !fields.has(key)))
    throw new Error('打印设置包含不支持的字段。');
  if (bounds) {
    integer(bounds.rowCount, 1, MAX_ROWS, '打印设置的工作表行数');
    integer(bounds.colCount, 1, MAX_COLUMNS, '打印设置的工作表列数');
  }
  if (value.paperSize !== undefined && !['A4', 'A3', 'Letter'].includes(value.paperSize as string))
    throw new Error('纸张必须为 A4、A3 或 Letter。');
  if (
    value.orientation !== undefined &&
    !['portrait', 'landscape'].includes(value.orientation as string)
  )
    throw new Error('纸张方向必须为 portrait 或 landscape。');
  if (value.margins !== undefined) {
    if (
      !object(value.margins) ||
      Object.keys(value.margins).some((key) => !['top', 'right', 'bottom', 'left'].includes(key))
    )
      throw new Error('页边距必须包含 top、right、bottom、left 四个数值。');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const margin = value.margins[side];
      if (typeof margin !== 'number' || !Number.isFinite(margin) || margin < 0)
        throw new Error('页边距必须为非负有限数值，单位为 PDF point。');
    }
  }
  const axes = [
    { repeat: 'repeatRows', breaks: 'rowBreaks', count: bounds?.rowCount ?? MAX_ROWS, label: '行' },
    {
      repeat: 'repeatColumns',
      breaks: 'columnBreaks',
      count: bounds?.colCount ?? MAX_COLUMNS,
      label: '列',
    },
  ] as const;
  for (const axis of axes) {
    const repeat = value[axis.repeat];
    if (repeat !== undefined) integer(repeat, 0, axis.count, `重复标题${axis.label}数`);
    const breaks = value[axis.breaks];
    if (breaks === undefined) continue;
    if (!Array.isArray(breaks) || breaks.length > MAX_PRINT_BREAKS)
      throw new Error(`手动${axis.label}分页必须为数组，最多 ${MAX_PRINT_BREAKS} 个。`);
    let previous = 0;
    for (const position of breaks) {
      integer(position, 1, axis.count - 1, `手动${axis.label}分页位置`);
      if (position <= previous) throw new Error(`手动${axis.label}分页位置必须严格递增且不重复。`);
      if (typeof repeat === 'number' && position <= repeat)
        throw new Error(`手动${axis.label}分页必须位于重复标题之后。`);
      previous = position;
    }
  }
}

/** Returns a validated deep copy suitable for JSON/workbook persistence. */
export function copyPrintSettings(
  value: unknown,
  bounds?: PrintSettingsBounds,
): PrintSettings | undefined {
  if (value === undefined) return undefined;
  validatePrintSettings(value, bounds);
  const copy: PrintSettings = {};
  if (value.paperSize !== undefined) copy.paperSize = value.paperSize;
  if (value.orientation !== undefined) copy.orientation = value.orientation;
  if (value.margins !== undefined) copy.margins = { ...value.margins };
  if (value.repeatRows !== undefined) copy.repeatRows = value.repeatRows;
  if (value.repeatColumns !== undefined) copy.repeatColumns = value.repeatColumns;
  if (value.rowBreaks !== undefined) copy.rowBreaks = value.rowBreaks.slice();
  if (value.columnBreaks !== undefined) copy.columnBreaks = value.columnBreaks.slice();
  return copy;
}
