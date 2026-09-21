import { cellKey, parseCellKey } from './engine';
import type { CellRange } from './types';
import { xmlChildren, type XlsxArchive } from './xlsx-archive';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** Bound merge expansion before ExcelJS allocates a cell for every covered coordinate. */
export function readXlsxMerges(
  archive: XlsxArchive,
  limits: { rows: number; columns: number; mergedCells: number },
): Map<string, CellRange[]> {
  const result = new Map<string, CellRange[]>();
  let total = 0;
  for (const sheet of archive.sheets) {
    const ranges: CellRange[] = [];
    const covered = new Set<number>();
    const containers = xmlChildren(sheet.xml, 'mergeCells');
    if (containers.length > 1) throw new Error('XLSX 合并区域容器不能重复。');
    for (const container of containers) {
      if (container.uri !== MAIN) throw new Error('XLSX 合并区域命名空间无效。');
      for (const node of xmlChildren(container)) {
        const parts = (node.attributes.ref ?? '').split(':');
        const start = parseCellKey(parts[0]);
        const end = parseCellKey(parts[1] ?? parts[0]);
        if (
          node.name !== 'mergeCell' ||
          node.uri !== MAIN ||
          parts.length > 2 ||
          !start ||
          !end ||
          cellKey(start.row, start.col) !== parts[0] ||
          cellKey(end.row, end.col) !== (parts[1] ?? parts[0]) ||
          start.row > end.row ||
          start.col > end.col ||
          end.row >= limits.rows ||
          end.col >= limits.columns
        )
          throw new Error('XLSX 合并单元格范围无效或越界。');
        total += (end.row - start.row + 1) * (end.col - start.col + 1);
        if (total > limits.mergedCells)
          throw new Error('XLSX 合并区域累计最多覆盖 10,000 个单元格。');
        for (let row = start.row; row <= end.row; row++) {
          for (let col = start.col; col <= end.col; col++) {
            const index = row * limits.columns + col;
            if (covered.has(index)) throw new Error('XLSX 合并单元格范围不能重叠或重复。');
            covered.add(index);
          }
        }
        // A single-cell merge has no layout effect and ExcelJS omits it on export.
        if (start.row !== end.row || start.col !== end.col) ranges.push({ start, end });
      }
    }
    result.set(sheet.name, ranges);
  }
  return result;
}
