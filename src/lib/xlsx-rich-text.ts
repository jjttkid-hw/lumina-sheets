import { copyRichText, richTextValue } from './rich-text';
import { decodeXlsxString, encodeXlsxString } from './xlsx-string';
import type { RichTextRun, Sheet } from './types';
import { awaitFileOperation } from './file-operation';
import {
  parseXlsxXmlAsync,
  xmlChild,
  xmlChildren,
  xmlElement,
  xmlText,
  type XmlElement,
  type XlsxArchive,
} from './xlsx-archive';

function fail(detail: string): never {
  throw new Error(`XLSX 富文本：${detail}，无法无损导入。`);
}
function plainText(container: XmlElement): string {
  const text = decodeXlsxString(xmlText(xmlChild(container, 't') ?? container));
  if (text.length > 32767) fail('单元格文字超过 32,767 个字符');
  return text;
}
function readRuns(container: XmlElement): RichTextRun[] | undefined {
  if (!xmlChildren(container, 'r').length) {
    const children = xmlChildren(container);
    if (children.some((node) => node.name !== 't')) fail('不支持的文字结构或拼音标注');
    if (children.length > 1) fail('重复的文字节点');
    if (children[0] && xmlChildren(children[0]).length) fail('文字节点不能包含嵌套元素');
    return undefined;
  }
  const runs = xmlChildren(container).map((node): RichTextRun => {
    if (node.name !== 'r') fail('不支持混合文字或拼音标注');
    if (xmlChildren(node).some((n) => !['rPr', 't'].includes(n.name))) fail('不支持的文字片段');
    const texts = xmlChildren(node, 't'),
      properties = xmlChildren(node, 'rPr');
    if (texts.length !== 1 || properties.length > 1) fail('片段结构无效');
    if (xmlChildren(texts[0]).length) fail('文字节点不能包含嵌套元素');
    const style: NonNullable<RichTextRun['style']> = {};
    const seen = new Set<string>();
    for (const prop of properties[0] ? xmlChildren(properties[0]) : []) {
      if (seen.has(prop.name)) fail('重复的字体属性');
      seen.add(prop.name);
      const val = prop.attributes.val;
      if (['b', 'i', 'strike'].includes(prop.name)) {
        if (val !== undefined && !['0', '1', 'true', 'false'].includes(val)) fail('字体开关无效');
        const key = prop.name === 'b' ? 'bold' : prop.name === 'i' ? 'italic' : 'strike';
        style[key] = val === undefined || val === '1' || val === 'true';
      } else if (prop.name === 'u') {
        if (val !== undefined && !['single', 'none'].includes(val)) fail('暂不支持此下划线类型');
        style.underline = val !== 'none';
      } else if (prop.name === 'sz') style.fontSize = Number(val);
      else if (prop.name === 'rFont') {
        if (val === undefined) fail('字体名称缺失');
        style.fontFamily = decodeXlsxString(val);
      } else if (prop.name === 'vertAlign') {
        if (!['baseline', 'superscript', 'subscript'].includes(val)) fail('上下标类型无效');
        style.verticalAlign = val as NonNullable<RichTextRun['style']>['verticalAlign'];
      } else if (prop.name === 'family' || prop.name === 'charset') {
        if (val === undefined || !/^\d+$/.test(val)) fail('字体分类或字符集无效');
        style[prop.name === 'family' ? 'fontFamilyClass' : 'charset'] = Number(val);
      } else if (prop.name === 'color') {
        const argb = prop.attributes.rgb;
        if (!argb || !/^FF[\da-f]{6}$/i.test(argb) || Object.keys(prop.attributes).length !== 1)
          fail('暂不支持主题、索引或透明字体颜色');
        style.color = `#${argb.slice(2)}`;
      } else fail(`暂不支持字体属性 ${prop.name}`);
    }
    return {
      text: decodeXlsxString(xmlText(texts[0])),
      ...(Object.keys(style).length ? { style } : {}),
    };
  });
  // Preserve empty runs too: they can carry explicit font overrides.
  return copyRichText(runs, richTextValue(runs));
}

/** Read original XML because ExcelJS replaces rich hyperlink labels with plain text. */
export async function readXlsxRichText(
  archive: XlsxArchive,
  signal?: AbortSignal,
  plainTexts?: Map<string, Map<string, string>>,
) {
  signal?.throwIfAborted();
  const sharedFile = archive.zip.file('xl/sharedStrings.xml');
  let shared: XmlElement[] = [];
  if (sharedFile) {
    const reading = sharedFile.async('string');
    const text = await (signal ? awaitFileOperation(reading, signal) : reading);
    signal?.throwIfAborted();
    shared = xmlChildren(await parseXlsxXmlAsync(text, signal), 'si');
  }
  const cache = new Map<number, RichTextRun[] | undefined>();
  const plainCache = new Map<number, string>();
  const result = new Map<string, Map<string, RichTextRun[]>>();
  let scanned = 0;
  let textUnits = 0;
  let runCount = 0;
  let expandedText = 0;
  let expandedRuns = 0;
  for (const sheet of archive.sheets) {
    signal?.throwIfAborted();
    const cells = new Map<string, RichTextRun[]>();
    result.set(sheet.name, cells);
    const plainCells = new Map<string, string>();
    plainTexts?.set(sheet.name, plainCells);
    const data = xmlChild(sheet.xml, 'sheetData');
    for (const row of data ? xmlChildren(data, 'row') : [])
      for (const cell of xmlChildren(row, 'c')) {
        signal?.throwIfAborted();
        let runs: RichTextRun[] | undefined;
        let plain: string | undefined;
        if (cell.attributes.t === 'inlineStr') {
          const inline = xmlChild(cell, 'is');
          if (inline) {
            runs = readRuns(inline);
            if (!runs && plainTexts) plain = plainText(inline);
          }
        } else if (cell.attributes.t === 's') {
          const v = xmlChild(cell, 'v');
          const text = v ? xmlText(v).trim() : '';
          // ExcelJS uses parseInt: accept only full decimal integer spellings so
          // its plain-text lookup and our rich-text lookup cannot disagree.
          if (!/^\+?\d+$/.test(text)) fail('共享字符串索引无效');
          const index = Number(text);
          if (!Number.isSafeInteger(index) || index < 0 || !shared[index])
            fail('共享字符串索引无效');
          if (!cache.has(index)) {
            const value = readRuns(shared[index]);
            cache.set(index, value);
            if (!value && plainTexts) plainCache.set(index, plainText(shared[index]));
          }
          runs = cache.get(index);
          plain = plainCache.get(index);
        }
        // Read original XML for ordinary text too. ExcelJS decodes only uppercase
        // shared escapes and does not decode ordinary inline strings at all.
        // Never decode its already-transformed value a second time.
        if (plain !== undefined && !xmlChild(cell, 'f')) {
          plainCells.set(cell.attributes.r, plain);
          textUnits += plain.length;
        }
        if (runs) {
          if (xmlChild(cell, 'f')) fail('公式不能同时包含富文本片段');
          const units = runs.reduce((sum, run) => sum + run.text.length, 0);
          // Shared strings are compact on disk but become independent per-cell
          // arrays. Bound retained text and objects before cloning the next cell.
          if (expandedText + units > 8_000_000 || expandedRuns + runs.length > 100_000)
            fail('富文本展开超过 8,000,000 个字符或 100,000 个片段的工作簿限制');
          expandedText += units;
          expandedRuns += runs.length;
          cells.set(cell.attributes.r, structuredClone(runs));
          runCount += runs.length;
          textUnits += units;
        }
        // Bound each uninterrupted batch by both cell count and rich payload.
        // Individual cell validation/cloning remains synchronous and bounded by
        // the existing per-cell text/run limits.
        if (++scanned >= 256 || textUnits >= 128 * 1024 || runCount >= 4096) {
          const turn = new Promise<void>((resolve) => setTimeout(resolve, 0));
          await (signal ? awaitFileOperation(turn, signal) : turn);
          signal?.throwIfAborted();
          scanned = textUnits = runCount = 0;
        }
      }
  }
  signal?.throwIfAborted();
  return result;
}

/** Emit inline rich strings after ExcelJS has created cell styles and hyperlink relations. */
export function applyXlsxRichText(archive: XlsxArchive, sheets: Sheet[]) {
  for (const sheet of archive.sheets) {
    const source = sheets.find((s) => s.name === sheet.name)!;
    const data = xmlChild(sheet.xml, 'sheetData');
    for (const row of data ? xmlChildren(data, 'row') : [])
      for (const cell of xmlChildren(row, 'c')) {
        const original = source.cells[cell.attributes.r];
        if (!original?.richText) continue;
        const runs = copyRichText(original.richText, original.value)!;
        cell.attributes.t = 'inlineStr';
        cell.children = [
          xmlElement(
            'is',
            {},
            runs.map((run) => {
              const style = run.style ?? {},
                props: XmlElement[] = [];
              for (const [key, tag] of [
                ['bold', 'b'],
                ['italic', 'i'],
                ['strike', 'strike'],
              ] as const)
                if (style[key] !== undefined)
                  props.push(xmlElement(tag, { val: style[key] ? '1' : '0' }));
              if (style.underline !== undefined)
                props.push(xmlElement('u', { val: style.underline ? 'single' : 'none' }));
              if (style.fontSize !== undefined)
                props.push(xmlElement('sz', { val: String(style.fontSize) }));
              if (style.fontFamily !== undefined)
                props.push(xmlElement('rFont', { val: encodeXlsxString(style.fontFamily) }));
              if (style.verticalAlign !== undefined)
                props.push(xmlElement('vertAlign', { val: style.verticalAlign }));
              if (style.fontFamilyClass !== undefined)
                props.push(xmlElement('family', { val: String(style.fontFamilyClass) }));
              if (style.charset !== undefined)
                props.push(xmlElement('charset', { val: String(style.charset) }));
              if (style.color)
                props.push(xmlElement('color', { rgb: `FF${style.color.slice(1)}` }));
              return xmlElement('r', {}, [
                ...(props.length ? [xmlElement('rPr', {}, props)] : []),
                xmlElement('t', { 'xml:space': 'preserve' }, [encodeXlsxString(run.text)]),
              ]);
            }),
          ),
        ];
      }
  }
}
