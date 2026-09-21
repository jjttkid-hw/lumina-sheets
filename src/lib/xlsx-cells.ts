import { cellKey, parseCellKey } from './engine';
import { xlsxIsoDateSerial } from './xlsx-date';
import { xmlChild, xmlChildren, xmlText, type XlsxArchive } from './xlsx-archive';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
interface StoredCells {
  addresses: string[];
  rowCount: number;
  colCount: number;
  /** Original numeric values, before ExcelJS's lossy conversion to Date. */
  numbers: Map<string, number>;
  /** Constant errors represented by supported literal formulas in the scalar model. */
  errors: Map<string, string>;
  booleans: Map<string, boolean>;
  /** Cells whose serialized payload would be discarded by merge expansion. */
  payloads: Set<string>;
}

/** Index stored cells, including styled blanks, without expanding the sheet rectangle. */
export function readXlsxStoredCells(
  archive: XlsxArchive,
  limits: { rows: number; columns: number; cells: number },
): Map<string, StoredCells> {
  const result = new Map<string, StoredCells>();
  let total = 0;
  for (const sheet of archive.sheets) {
    const value: StoredCells = {
      addresses: [],
      rowCount: 1,
      colCount: 1,
      numbers: new Map(),
      errors: new Map(),
      booleans: new Map(),
      payloads: new Set(),
    };
    const seen = new Set<string>();
    const data = xmlChild(sheet.xml, 'sheetData');
    for (const row of data ? xmlChildren(data, 'row') : []) {
      for (const cell of xmlChildren(row, 'c')) {
        const address = cell.attributes.r;
        const position = address ? parseCellKey(address) : null;
        if (
          cell.uri !== MAIN ||
          !position ||
          cellKey(position.row, position.col) !== address ||
          position.row + 1 !== Number(row.attributes.r) ||
          seen.has(address)
        )
          throw new Error('XLSX 单元格坐标无效、重复或与所属行不一致。');
        if (position.row >= limits.rows || position.col >= limits.columns)
          throw new Error('XLSX 单元格超出支持的 100,000 行和 256 列范围。');
        if (++total > limits.cells)
          throw new Error('XLSX 文件超过 100,000 个存储单元格限制（包含空白样式格）。');
        seen.add(address);
        if (
          cell.attributes.t !== undefined &&
          !['b', 'd', 'e', 'inlineStr', 'n', 's', 'str'].includes(cell.attributes.t)
        )
          throw new Error(`XLSX 单元格类型无效或不支持：${sheet.name}!${address}。`);
        const values = xmlChildren(cell, 'v');
        const formulas = xmlChildren(cell, 'f');
        const inline = xmlChildren(cell, 'is');
        if (values.length > 1 || formulas.length > 1 || inline.length > 1)
          throw new Error(`XLSX 单元格值或公式重复：${sheet.name}!${address}。`);
        // Inline strings cannot also hold a scalar/cache or a formula. ExcelJS
        // otherwise concatenates duplicate strings or silently chooses a payload.
        if (
          (inline.length > 0 && cell.attributes.t !== 'inlineStr') ||
          (cell.attributes.t === 'inlineStr' && (values.length > 0 || formulas.length > 0))
        )
          throw new Error(`XLSX 单元格文本、值或公式冲突：${sheet.name}!${address}。`);
        const formulaType = formulas[0]?.attributes.t;
        if (formulaType !== undefined && !['normal', 'shared'].includes(formulaType))
          throw new Error(
            `XLSX ${sheet.name}!${address} 的${formulaType === 'array' ? '数组公式' : '公式类型'}尚不能保留，已停止导入以避免计算含义丢失。`,
          );
        if (cell.attributes.t === 'b' && !formulas.length) {
          const text = values.length ? xmlText(values[0]).trim() : '';
          if (!['0', '1', 'true', 'false'].includes(text))
            throw new Error(`XLSX 单元格布尔值无效：${sheet.name}!${address}。`);
          value.booleans.set(address, text === '1' || text === 'true');
        }
        if (cell.attributes.t === 'e' && !xmlChildren(cell, 'f').length) {
          const values = xmlChildren(cell, 'v');
          const code = values.length === 1 ? xmlText(values[0]) : '';
          if (!['#N/A', '#REF!', '#NAME?', '#DIV/0!', '#NULL!', '#VALUE!', '#NUM!'].includes(code))
            throw new Error(`XLSX 单元格错误类型不支持或无效：${sheet.name}!${address}。`);
          value.errors.set(address, code);
        }
        if (
          xmlChildren(cell, 'f').length ||
          xmlChildren(cell, 'v').some((node) => xmlText(node).length > 0) ||
          xmlChildren(cell, 'is').some((node) => xmlText(node).length > 0)
        )
          value.payloads.add(address);
        if (cell.attributes.t === 'd') {
          const serial = xlsxIsoDateSerial(values.length ? xmlText(values[0]) : '');
          // ExcelJS otherwise uses parseFloat on t=d and reads only the year.
          // Normalize the verified archive while retaining formula/cache structure.
          cell.attributes.t = 'n';
          values[0].children = [String(serial)];
        }
        if (cell.attributes.t === undefined || cell.attributes.t === 'n') {
          const node = xmlChild(cell, 'v');
          const text = node ? xmlText(node).trim() : '';
          if (text) {
            if (
              !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ||
              !Number.isFinite(Number(text))
            )
              throw new Error(`XLSX 单元格数值无效或超出有限范围：${sheet.name}!${address}。`);
            value.numbers.set(address, Number(text));
          }
        }
        value.addresses.push(address);
        value.rowCount = Math.max(value.rowCount, position.row + 1);
        value.colCount = Math.max(value.colCount, position.col + 1);
      }
    }
    result.set(sheet.name, value);
  }
  return result;
}
