import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { awaitFileOperation } from './file-operation';

export interface XmlElement {
  name: string;
  qualifiedName: string;
  uri: string;
  attributes: Record<string, string>;
  attributeNamespaces?: Record<string, string>;
  children: (XmlElement | string)[];
}
export interface XlsxSheetXml {
  name: string;
  path: string;
  xml: XmlElement;
}
export interface XlsxArchive {
  zip: JSZip;
  workbook: XmlElement;
  workbookPath: string;
  sheets: XlsxSheetXml[];
}
export const XLSX_ARCHIVE_LIMITS = {
  compressedBytes: 20 * 1024 * 1024,
  uncompressedBytes: 64 * 1024 * 1024,
  xmlBytes: 16 * 1024 * 1024,
  entries: 2000,
  sheets: 50,
  xmlNodes: 1_000_000,
  xmlDepth: 64,
};
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOCREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function fail(message: string): never {
  throw new Error(`XLSX：${message}`);
}
export function xmlChildren(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement => typeof child !== 'string' && (!name || child.name === name),
  );
}
export function xmlChild(element: XmlElement, name: string): XmlElement | undefined {
  return xmlChildren(element, name)[0];
}
export function xmlText(element: XmlElement): string {
  return element.children
    .map((child) => (typeof child === 'string' ? child : xmlText(child)))
    .join('');
}
export function xmlElement(
  name: string,
  attributes: Record<string, string> = {},
  children: (XmlElement | string)[] = [],
): XmlElement {
  return { name, qualifiedName: name, uri: MAIN, attributes, children };
}
function xlsxXmlParser() {
  const parser = new SaxesParser({ xmlns: true });
  let root: XmlElement | undefined;
  const stack: XmlElement[] = [];
  let count = 0;
  parser.on('doctype', () => fail('不支持 XML DTD。'));
  parser.on('processinginstruction', () => fail('不支持 XML 处理指令。'));
  parser.on('error', (error) => fail(`XML 格式不正确：${error.message}`));
  parser.on('opentag', (tag) => {
    if (++count > XLSX_ARCHIVE_LIMITS.xmlNodes || stack.length >= XLSX_ARCHIVE_LIMITS.xmlDepth)
      fail('XML 结构超过安全限制。');
    const element: XmlElement = {
      name: tag.local,
      qualifiedName: tag.name,
      uri: tag.uri,
      attributes: {},
      attributeNamespaces: {},
      children: [],
    };
    for (const [key, attr] of Object.entries(tag.attributes)) {
      element.attributes[key] = attr.value;
      element.attributeNamespaces![key] = attr.uri;
    }
    if (stack.length) stack[stack.length - 1].children.push(element);
    else {
      if (root) fail('XML 存在多个根元素。');
      root = element;
    }
    stack.push(element);
  });
  const text = (value: string) => {
    if (!stack.length) {
      if (value.trim()) fail('XML 根元素外存在内容。');
      return;
    }
    stack[stack.length - 1].children.push(value);
  };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => {
    stack.pop();
  });
  return {
    parser,
    finish() {
      parser.close();
      if (!root) return fail('XML 缺少根元素。');
      return root;
    },
  };
}
export function parseXlsxXml(source: string): XmlElement {
  const task = xlsxXmlParser();
  task.parser.write(source);
  return task.finish();
}
/** Feed the same strict parser incrementally, allowing browser tasks to cancel large parts. */
export async function parseXlsxXmlAsync(source: string, signal?: AbortSignal): Promise<XmlElement> {
  signal?.throwIfAborted();
  const task = xlsxXmlParser();
  const chunkSize = 128 * 1024;
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    signal?.throwIfAborted();
    task.parser.write(source.slice(offset, offset + chunkSize));
    if (offset + chunkSize < source.length) {
      const turn = new Promise<void>((resolve) => setTimeout(resolve, 0));
      await (signal ? awaitFileOperation(turn, signal) : turn);
    }
  }
  signal?.throwIfAborted();
  return task.finish();
}
function escape(value: string, attribute = false): string {
  const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return attribute
    ? escaped
        .replaceAll('"', '&quot;')
        .replaceAll('\r', '&#13;')
        .replaceAll('\n', '&#10;')
        .replaceAll('\t', '&#9;')
    : // XML normalizes literal CR and CRLF; a character reference preserves CR.
      escaped.replaceAll('\r', '&#13;');
}
export function serializeXml(element: XmlElement): string {
  const attrs = Object.entries(element.attributes)
    .map(([key, value]) => ` ${key}="${escape(value, true)}"`)
    .join('');
  if (!element.children.length) return `<${element.qualifiedName}${attrs}/>`;
  return `<${element.qualifiedName}${attrs}>${element.children.map((child) => (typeof child === 'string' ? escape(child) : serializeXml(child))).join('')}</${element.qualifiedName}>`;
}
function safeZipPath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\u0000-\u001f]/.test(path) ||
    path.split('/').some((part) => part === '..' || part === '.') ||
    path.includes(':')
  )
    fail('ZIP 路径无效或越界。');
}
function resolveTarget(sourcePath: string, target: string): string {
  if (
    !target ||
    target.includes('\\') ||
    target.includes('?') ||
    target.includes('#') ||
    /^[a-z][a-z\d+.-]*:/i.test(target)
  )
    fail('关系目标不是本地工作簿路径。');
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return fail('关系目标编码无效。');
  }
  if (decoded.startsWith('/') || decoded.includes('\\') || decoded.includes(':'))
    fail('关系目标越界。');
  const parts = sourcePath ? sourcePath.split('/').slice(0, -1) : [];
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length) fail('关系目标越出 ZIP 根目录。');
      parts.pop();
    } else if (part !== '.') parts.push(part);
  }
  const result = parts.join('/');
  safeZipPath(result);
  return result;
}
function relationshipPath(path: string): string {
  const pieces = path.split('/');
  const file = pieces.pop()!;
  return [...pieces, '_rels', `${file}.rels`].join('/');
}
async function boundedBytes(
  file: JSZip.JSZipObject,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let length = 0,
      settled = false;
    const stream = (
      file as unknown as {
        internalStream(type: string): {
          on(event: string, callback: (...args: any[]) => void): void;
          pause(): void;
          resume(): void;
        };
      }
    ).internalStream('uint8array');
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const stop = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      chunks.length = 0;
      try {
        stream.pause();
      } catch {
        /* Preserve the initiating failure. */
      }
      reject(error);
    };
    const abort = () => stop(new DOMException('文件操作已取消。', 'AbortError'));
    stream.on('data', (chunk: Uint8Array) => {
      if (settled) return;
      length += chunk.length;
      if (length > limit) {
        stop(new Error('XLSX：实际解压体积超过安全限制。'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', stop);
    stream.on('end', () => {
      if (settled) return;
      try {
        const result = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        settled = true;
        cleanup();
        chunks.length = 0;
        resolve(result);
      } catch (error) {
        stop(error);
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else {
      try {
        stream.resume();
      } catch (error) {
        stop(error);
      }
    }
  });
}
async function decodeXml(bytes: Uint8Array, signal?: AbortSignal): Promise<XmlElement> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('XML 必须为 UTF-8。');
  }
  return parseXlsxXmlAsync(text, signal);
}
function relations(xml: XmlElement) {
  if (xml.name !== 'Relationships' || xml.uri !== REL) fail('关系 XML 命名空间无效。');
  const map = new Map<string, XmlElement>();
  for (const item of xmlChildren(xml)) {
    if (
      item.name !== 'Relationship' ||
      item.uri !== REL ||
      !item.attributes.Id ||
      map.has(item.attributes.Id)
    )
      fail('关系定义无效或重复。');
    map.set(item.attributes.Id, item);
  }
  return map;
}
function internalTarget(item: XmlElement, source: string, expected: string): string {
  if (
    item.attributes.Type !== `${DOCREL}/${expected}` ||
    (item.attributes.TargetMode && item.attributes.TargetMode !== 'Internal')
  )
    fail('不支持外部工作簿或工作表关系。');
  return resolveTarget(source, item.attributes.Target);
}
/** Bounded ZIP/XML preflight, before ExcelJS can expand worksheet features. */
export async function readXlsxArchive(
  buffer: ArrayBuffer | Uint8Array,
  signal?: AbortSignal,
): Promise<XlsxArchive> {
  signal?.throwIfAborted();
  if (buffer.byteLength > XLSX_ARCHIVE_LIMITS.compressedBytes) fail('压缩文件超过 20 MB。');
  const work = JSZip.loadAsync(buffer);
  const incoming = await (signal ? awaitFileOperation(work, signal) : work);
  signal?.throwIfAborted();
  const files = Object.values(incoming.files);
  if (files.length > XLSX_ARCHIVE_LIMITS.entries) fail('ZIP 部件数量超过限制。');
  let total = 0;
  for (const file of files) {
    signal?.throwIfAborted();
    safeZipPath(file.name);
    const original = (file as unknown as { unsafeOriginalName?: string }).unsafeOriginalName;
    if (original) safeZipPath(original);
    if (file.dir) continue;
    const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize;
    if (size === undefined || !Number.isSafeInteger(size) || size < 0) fail('ZIP 部件大小无效。');
    total += size;
    if (
      total > XLSX_ARCHIVE_LIMITS.uncompressedBytes ||
      (file.name.endsWith('.xml') && size > XLSX_ARCHIVE_LIMITS.xmlBytes)
    )
      fail('ZIP 解压体积超过安全限制。');
  }
  // Verify every member's real output size, including sharedStrings/styles and unused parts,
  // then rebuild from verified bytes so downstream parsers never reinflate untrusted streams.
  const zip = new JSZip();
  const xmlParts = new Map<string, XmlElement>();
  let actualTotal = 0;
  for (const file of files) {
    signal?.throwIfAborted();
    if (file.dir) continue;
    const isXml = /\.(?:xml|rels)$/i.test(file.name);
    const remaining = XLSX_ARCHIVE_LIMITS.uncompressedBytes - actualTotal;
    const bytes = await boundedBytes(
      file,
      Math.min(remaining, isXml ? XLSX_ARCHIVE_LIMITS.xmlBytes : remaining),
      signal,
    );
    signal?.throwIfAborted();
    actualTotal += bytes.length;
    zip.file(file.name, bytes);
    if (isXml) xmlParts.set(file.name, await decodeXml(bytes, signal));
  }
  const readXml = (path: string): XmlElement =>
    xmlParts.get(path) ?? fail(`缺少 XML 部件 ${path}。`);
  const rootRels = relations(readXml('_rels/.rels'));
  const office = [...rootRels.values()].filter(
    (item) => item.attributes.Type === `${DOCREL}/officeDocument`,
  );
  if (office.length !== 1) fail('必须存在唯一工作簿关系。');
  const workbookPath = internalTarget(office[0], '', 'officeDocument');
  const workbook = readXml(workbookPath);
  if (workbook.name !== 'workbook' || workbook.uri !== MAIN) fail('不支持的工作簿 XML。');
  const workbookRels = relations(readXml(relationshipPath(workbookPath)));
  const sheetsElement = xmlChild(workbook, 'sheets');
  const nodes = sheetsElement ? xmlChildren(sheetsElement, 'sheet') : [];
  if (!nodes.length || nodes.length > XLSX_ARCHIVE_LIMITS.sheets) fail('工作表数量必须为 1–50。');
  const sheets: XlsxSheetXml[] = [];
  const paths = new Set<string>();
  const names = new Set<string>();
  for (const node of nodes) {
    if (node.uri !== MAIN) fail('工作表定义命名空间无效。');
    const id = Object.entries(node.attributes).find(
      ([key]) => key.endsWith(':id') && node.attributeNamespaces?.[key] === DOCREL,
    )?.[1];
    const relation = id ? workbookRels.get(id) : undefined;
    if (!relation) fail('工作表关系不存在。');
    const path = internalTarget(relation, workbookPath, 'worksheet');
    const name = node.attributes.name;
    if (!name || paths.has(path) || names.has(name)) fail('工作表路径或名称重复。');
    paths.add(path);
    names.add(name);
    const xml = readXml(path);
    if (xml.name !== 'worksheet' || xml.uri !== MAIN) fail('不支持的工作表 XML。');
    sheets.push({ name, path, xml });
  }
  return { zip, workbook, workbookPath, sheets };
}
export async function writeXlsxArchive(archive: XlsxArchive): Promise<ArrayBuffer> {
  archive.zip.file(
    archive.workbookPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${serializeXml(archive.workbook)}`,
  );
  for (const sheet of archive.sheets)
    archive.zip.file(
      sheet.path,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${serializeXml(sheet.xml)}`,
    );
  return archive.zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

/** ExcelJS recognizes only its conventional workbook and worksheet part names. */
export function assertExcelJsCompatiblePaths(archive: XlsxArchive): void {
  if (
    archive.workbookPath !== 'xl/workbook.xml' ||
    archive.sheets.some((sheet) => !/^xl\/worksheets\/sheet[1-9]\d*\.xml$/.test(sheet.path))
  )
    fail(
      '当前 ExcelJS 导入仅支持 xl/workbook.xml 和 xl/worksheets/sheetN.xml 标准部件路径；请用 Excel 重新保存文件。',
    );
}
