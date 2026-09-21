import { cellKey, parseCellKey } from './engine';
import { copyHyperlink } from './cell-hyperlink';
import { parseXlsxXml, xmlChildren, type XlsxArchive } from './xlsx-archive';
import type { Cell } from './types';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DOCREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
function fail(): never {
  throw new Error('XLSX 超链接定义不受支持或无效；无法无损导入。');
}

/** ExcelJS loses tooltip on read; retain link metadata from the original XML. */
export async function readXlsxHyperlinks(archive: XlsxArchive) {
  const result = new Map<string, Map<string, NonNullable<Cell['hyperlink']>>>();
  for (const sheet of archive.sheets) {
    const links = new Map<string, NonNullable<Cell['hyperlink']>>();
    result.set(sheet.name, links);
    const containers = xmlChildren(sheet.xml, 'hyperlinks');
    if (containers.length > 1) fail();
    if (!containers.length) continue;
    if (containers[0].uri !== MAIN) fail();
    const parts = sheet.path.split('/');
    const filename = parts.pop();
    const relFile = archive.zip.file([...parts, '_rels', `${filename}.rels`].join('/'));
    const relationships = new Map<string, { target: string; type: string; mode?: string }>();
    if (relFile) {
      const root = parseXlsxXml(await relFile.async('string'));
      if (root.name !== 'Relationships' || root.uri !== REL) fail();
      for (const node of xmlChildren(root)) {
        const attrs = node.attributes;
        if (
          node.name !== 'Relationship' ||
          node.uri !== REL ||
          !attrs.Id ||
          relationships.has(attrs.Id)
        )
          fail();
        relationships.set(attrs.Id, {
          target: attrs.Target,
          type: attrs.Type,
          mode: attrs.TargetMode,
        });
      }
    }
    for (const node of xmlChildren(containers[0])) {
      const attrs = node.attributes;
      const point = parseCellKey(attrs.ref ?? '');
      if (
        node.name !== 'hyperlink' ||
        node.uri !== MAIN ||
        !point ||
        cellKey(point.row, point.col) !== attrs.ref ||
        links.has(attrs.ref)
      )
        fail();
      const id = Object.keys(attrs).find(
        (key) => key.endsWith(':id') && node.attributeNamespaces?.[key] === DOCREL,
      );
      let target: string;
      if (id) {
        const rel = relationships.get(attrs[id]);
        if (
          !rel ||
          rel.type !== `${DOCREL}/hyperlink` ||
          rel.mode !== 'External' ||
          (attrs.location !== undefined && attrs.location !== rel.target)
        )
          fail();
        target = rel.target;
      } else if (attrs.location) target = `#${attrs.location}`;
      else return fail();
      links.set(
        attrs.ref,
        copyHyperlink(
          { target, ...(attrs.tooltip !== undefined ? { tooltip: attrs.tooltip } : {}) },
          '',
        )!,
      );
    }
  }
  return result;
}
