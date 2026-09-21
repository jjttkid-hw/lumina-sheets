import { cellKey, parseCellKey, translateFormula } from './engine';
import { xmlChild, xmlChildren, xmlText, type XmlElement, type XlsxArchive } from './xlsx-archive';

/** Expand only stored shared-formula cells, before ExcelJS's string-blind translator runs. */
export function expandXlsxSharedFormulas(archive: XlsxArchive) {
  let formulaUnits = 0;
  const countFormula = (formula: string) => {
    if (formula.length > 32767) throw new Error('XLSX 单格公式超过 32,767 字符限制，已停止导入。');
    formulaUnits += formula.length;
    if (formulaUnits > 8_000_000)
      throw new Error('XLSX 展开后公式文本超过 8,000,000 字符容量，已停止导入。');
  };
  for (const sheet of archive.sheets) {
    const fail = (detail: string): never => {
      throw new Error(`XLSX 共享公式无效：${sheet.name}，${detail}。`);
    };
    const groups = new Map<
      number,
      { formula: string; start: { row: number; col: number }; end: { row: number; col: number } }
    >();
    const entries: { node: XmlElement; key: string; id: number; text: string }[] = [];
    const data = xmlChild(sheet.xml, 'sheetData');
    for (const row of data ? xmlChildren(data, 'row') : []) {
      for (const cell of xmlChildren(row, 'c')) {
        const node = xmlChild(cell, 'f');
        if (!node) continue;
        if (node.attributes.t !== 'shared') {
          countFormula(`=${xmlText(node)}`);
          continue;
        }
        const rawId = node.attributes.si ?? '';
        if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) fail('共享编号无效');
        const id = Number(rawId),
          text = xmlText(node),
          key = cell.attributes.r;
        entries.push({ node, key, id, text });
        if (!text) {
          if (node.attributes.ref !== undefined) fail('从属公式不能声明范围');
          continue;
        }
        // Reject oversized master text before repeatedly translating it.
        if (text.length + 1 > 32767)
          throw new Error('XLSX 单格公式超过 32,767 字符限制，已停止导入。');
        if (groups.has(id)) fail('共享编号存在重复主公式');
        const parts = (node.attributes.ref ?? '').split(':');
        const start = parseCellKey(parts[0]),
          end = parseCellKey(parts[1] ?? parts[0]);
        if (
          !start ||
          !end ||
          parts.length > 2 ||
          cellKey(start.row, start.col) !== parts[0] ||
          cellKey(end.row, end.col) !== (parts[1] ?? parts[0]) ||
          key !== parts[0] ||
          start.row > end.row ||
          start.col > end.col
        )
          fail('主公式范围无效');
        groups.set(id, { formula: `=${text}`, start: start!, end: end! });
      }
    }
    for (const entry of entries) {
      const group = groups.get(entry.id);
      const position = parseCellKey(entry.key);
      if (!group || !position) fail('缺少主公式或坐标无效');
      const { start, end, formula } = group!;
      const { row, col } = position!;
      if (row < start.row || row > end.row || col < start.col || col > end.col)
        fail('从属公式超出共享范围');
      const expanded = entry.text
        ? `=${entry.text}`
        : translateFormula(formula, row - start.row, col - start.col);
      countFormula(expanded);
      entry.node.children = [expanded.slice(1)];
      delete entry.node.attributes.t;
      delete entry.node.attributes.si;
      delete entry.node.attributes.ref;
    }
  }
}
