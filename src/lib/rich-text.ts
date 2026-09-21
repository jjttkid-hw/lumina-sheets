import type { Cell, CellValue, RichTextRun } from './types';

const color = /^#[\da-f]{6}$/i;
const styleKeys = new Set([
  'bold',
  'italic',
  'underline',
  'color',
  'fontSize',
  'fontFamily',
  'strike',
  'verticalAlign',
  'fontFamilyClass',
  'charset',
]);

/** Validate and isolate inline font runs without allowing formulas or metadata. */
export function copyRichText(input: unknown, value: CellValue): RichTextRun[] | undefined {
  if (input === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.startsWith('=') ||
    !Array.isArray(input) ||
    !input.length ||
    input.length > 32767
  )
    throw new Error('富文本仅支持普通文本单元格，且至少需要一个文字片段');
  const runs: RichTextRun[] = [];
  let joined = '';
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('富文本片段无效');
    const run = item as Record<string, unknown>;
    if (Object.keys(run).some((key) => key !== 'text' && key !== 'style'))
      throw new Error('富文本片段无效');
    if (typeof run.text !== 'string') throw new Error('富文本片段文字无效');
    if (run.text.length > 32767 || joined.length + run.text.length > 32767)
      throw new Error('富文本内容不能超过 32,767 个字符');
    let style: RichTextRun['style'] | undefined;
    if (run.style !== undefined) {
      if (!run.style || typeof run.style !== 'object' || Array.isArray(run.style))
        throw new Error('富文本样式无效');
      const raw = run.style as Record<string, unknown>;
      if (Object.keys(raw).some((key) => !styleKeys.has(key))) throw new Error('富文本样式无效');
      style = {};
      for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
        if (raw[key] !== undefined && typeof raw[key] !== 'boolean')
          throw new Error('富文本样式无效');
        if (typeof raw[key] === 'boolean') style[key] = raw[key];
      }
      for (const key of ['color'] as const) {
        if (raw[key] !== undefined && (typeof raw[key] !== 'string' || !color.test(raw[key])))
          throw new Error('富文本颜色必须为六位十六进制值');
        if (typeof raw[key] === 'string') style[key] = raw[key];
      }
      if (raw.fontFamily !== undefined) {
        if (
          typeof raw.fontFamily !== 'string' ||
          !raw.fontFamily.trim() ||
          raw.fontFamily.length > 128 ||
          /[\u0000-\u001f\u007f]/.test(raw.fontFamily)
        )
          throw new Error('富文本字体名称无效');
        style.fontFamily = raw.fontFamily;
      }
      if (raw.verticalAlign !== undefined) {
        if (
          !['baseline', 'superscript', 'subscript'].includes(String(raw.verticalAlign)) ||
          typeof raw.verticalAlign !== 'string'
        )
          throw new Error('富文本上下标类型无效');
        style.verticalAlign = raw.verticalAlign as NonNullable<
          RichTextRun['style']
        >['verticalAlign'];
      }
      for (const [key, max] of [
        ['fontFamilyClass', 5],
        ['charset', 255],
      ] as const) {
        if (raw[key] === undefined) continue;
        if (
          typeof raw[key] !== 'number' ||
          !Number.isInteger(raw[key]) ||
          raw[key] < 0 ||
          raw[key] > max
        )
          throw new Error('富文本字体分类或字符集无效');
        style[key] = raw[key];
      }
      if (raw.fontSize !== undefined) {
        if (
          typeof raw.fontSize !== 'number' ||
          !Number.isFinite(raw.fontSize) ||
          raw.fontSize < 6 ||
          raw.fontSize > 96
        )
          throw new Error('富文本字号必须为 6–96');
        style.fontSize = raw.fontSize;
      }
      if (!Object.keys(style).length) style = undefined;
    }
    runs.push({ text: run.text, ...(style ? { style } : {}) });
    joined += run.text;
  }
  if (joined !== value) throw new Error('富文本片段文字必须与单元格值一致');
  return structuredClone(runs);
}

export function richTextValue(runs: readonly RichTextRun[]): string {
  return runs.map((run) => run.text).join('');
}

/** A plain-text edit explicitly replaces inline formatting only when text changes. */
export function replaceCellText(cell: Cell | undefined, value: CellValue): Cell {
  const result: Cell = { ...cell, value };
  if (cell?.value !== value) delete result.richText;
  return result;
}
