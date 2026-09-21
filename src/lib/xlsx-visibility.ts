import type { Sheet } from './types';
import {
  xmlChild,
  xmlChildren,
  xmlElement,
  type XmlElement,
  type XlsxArchive,
} from './xlsx-archive';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

export interface XlsxVisibility {
  rowHeights: Record<number, number>;
  hiddenRows: number[];
  hiddenColumns: number[];
  rowCount: number;
  colCount: number;
}

/** Read original XML because ExcelJS drops blank row hidden metadata from its model. */
export function readXlsxVisibility(
  archive: XlsxArchive,
  limits = { rows: 1_048_576, columns: 16_384 },
): Map<string, XlsxVisibility> {
  const result = new Map<string, XlsxVisibility>();
  const integer = (raw: string | undefined, max: number, label: string): number => {
    if (!raw || !/^[1-9]\d*$/.test(raw)) throw new Error(`XLSX ${label}坐标无效。`);
    if (Number(raw) > max)
      throw new Error(`XLSX ${label}坐标超出 ${max.toLocaleString('en-US')} ${label}限制。`);
    return Number(raw);
  };
  const hidden = (raw: string | undefined): boolean => {
    if (raw === undefined || raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
    throw new Error('XLSX hidden 属性无效。');
  };
  for (const sheet of archive.sheets) {
    for (const name of ['sheetData', 'cols']) {
      const containers = xmlChildren(sheet.xml, name);
      if (containers.length > 1 || containers.some((node) => node.uri !== MAIN))
        throw new Error(`XLSX ${name} 容器重复或命名空间无效。`);
    }
    const value: XlsxVisibility = {
      rowHeights: {},
      hiddenRows: [],
      hiddenColumns: [],
      rowCount: 1,
      colCount: 1,
    };
    for (const row of xmlChildren(
      xmlChild(sheet.xml, 'sheetData') ?? xmlElement('sheetData'),
      'row',
    )) {
      if (row.uri !== MAIN) throw new Error('XLSX 行布局命名空间无效。');
      const number = integer(row.attributes.r, limits.rows, '行');
      const isHidden = hidden(row.attributes.hidden);
      if (isHidden) value.hiddenRows.push(number - 1);
      if (row.attributes.ht !== undefined) {
        const points = Number(row.attributes.ht);
        const pixels = (points * 96) / 72;
        if (!Number.isFinite(pixels) || pixels < 1 || pixels > 600)
          throw new Error('XLSX 行高超出 1–600 像素范围。');
        value.rowHeights[number - 1] = pixels;
      }
      if (isHidden || row.attributes.ht !== undefined)
        value.rowCount = Math.max(value.rowCount, number);
    }
    for (const col of xmlChildren(xmlChild(sheet.xml, 'cols') ?? xmlElement('cols'), 'col')) {
      if (col.uri !== MAIN) throw new Error('XLSX 列布局命名空间无效。');
      // Visible columns also expand into Column objects in ExcelJS.
      const min = integer(col.attributes.min, limits.columns, '列');
      const max = integer(col.attributes.max, limits.columns, '列');
      if (max < min) throw new Error('XLSX 列范围无效。');
      value.colCount = Math.max(value.colCount, max);
      if (!hidden(col.attributes.hidden)) continue;
      for (let index = min; index <= max; index++) value.hiddenColumns.push(index - 1);
    }
    value.hiddenRows = [...new Set(value.hiddenRows)].sort((a, b) => a - b);
    value.hiddenColumns = [...new Set(value.hiddenColumns)].sort((a, b) => a - b);
    result.set(sheet.name, value);
  }
  return result;
}

/**
 * ExcelJS omits a blank row when only `hidden` is set. Patch the worksheet XML
 * after ExcelJS writes it so sparse hidden rows survive an XLSX round trip.
 */
export function applyXlsxVisibility(archive: XlsxArchive, sheets: Sheet[]): void {
  for (const [index, source] of sheets.entries()) {
    const target = archive.sheets[index];
    if (!target) throw new Error('XLSX 可见性工作表数量不一致。');
    const sheetData = xmlChild(target.xml, 'sheetData');
    if (!sheetData) throw new Error(`XLSX 工作表 ${source.name} 缺少 sheetData。`);
    const rows = xmlChildren(sheetData, 'row');
    const byNumber = new Map<number, XmlElement>();
    for (const row of rows) {
      const number = Number(row.attributes.r);
      if (Number.isInteger(number) && number > 0) byNumber.set(number, row);
    }
    for (const row of source.hiddenRows ?? []) {
      const number = row + 1;
      let element = byNumber.get(number);
      if (!element) {
        element = xmlElement('row', { r: String(number), hidden: '1' }, []);
        element.uri = MAIN;
        element.qualifiedName = 'row';
        sheetData.children.push(element);
        byNumber.set(number, element);
      } else {
        element.attributes.hidden = '1';
      }
    }
    if ((source.hiddenRows ?? []).length) {
      // Rebuild only row ordering while retaining whitespace/text children.
      const allRows = xmlChildren(sheetData, 'row').sort(
        (a, b) => Number(a.attributes.r) - Number(b.attributes.r),
      );
      let cursor = 0;
      sheetData.children = sheetData.children.map((child) =>
        typeof child !== 'string' && child.name === 'row' ? allRows[cursor++] : child,
      );
      while (cursor < allRows.length) sheetData.children.push(allRows[cursor++]);
    }
  }
}
