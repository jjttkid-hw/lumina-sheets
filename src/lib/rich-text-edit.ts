import { copyRichText } from './rich-text';
import type { Cell, RichTextRun, RichTextStyle } from './types';

/** Textareas normalize CRLF/lone CR to LF; map selection back to stored text. */
export function textareaTextRange(text: string, start: number, end: number) {
  const positions = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\r' && text[index + 1] === '\n') index++;
    positions.push(index + 1);
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= positions.length
  )
    throw new Error('文字选区已变化，请重新选择。');
  return { start: positions[start], end: positions[end] };
}

/** UTF-16 offsets match textarea selectionStart/End; never split a surrogate pair. */
export function formatTextRange(
  cell: Cell,
  start: number,
  end: number,
  patch: RichTextStyle | null,
): Cell {
  const text = cell.value;
  if (typeof text !== 'string' || text.startsWith('='))
    throw new Error('局部格式仅支持普通文本单元格。');
  const boundary = (offset: number) =>
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    offset <= text.length &&
    !(
      offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[offset])
    );
  if (!boundary(start) || !boundary(end) || start >= end)
    throw new Error('请先选中完整的文字，再设置格式。');
  // Validate even for an empty/irrelevant patch before changing any candidate.
  if (patch !== null) copyRichText([{ text: 'x', style: patch }], 'x');
  const source = copyRichText(cell.richText, text) ?? [{ text }];
  const result: RichTextRun[] = [];
  let offset = 0;
  for (const run of source) {
    const next = offset + run.text.length;
    const left = Math.max(start, offset),
      right = Math.min(end, next);
    if (left >= right) result.push(run);
    else {
      if (left > offset) result.push({ ...run, text: run.text.slice(0, left - offset) });
      const style = patch === null ? undefined : { ...run.style, ...patch };
      result.push({
        text: run.text.slice(left - offset, right - offset),
        ...(style ? { style } : {}),
      });
      if (right < next) result.push({ ...run, text: run.text.slice(right - offset) });
    }
    offset = next;
  }
  // Merge only equal adjacent nonempty runs; retain imported empty-run metadata.
  const normalized: RichTextRun[] = [];
  const equalStyle = (a: RichTextStyle = {}, b: RichTextStyle = {}) => {
    const keys = Object.keys(a) as (keyof RichTextStyle)[];
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
  };
  for (const run of result) {
    const previous = normalized.at(-1);
    if (previous?.text && run.text && equalStyle(previous.style, run.style))
      previous.text += run.text;
    else normalized.push({ ...run });
  }
  const next = { ...cell, richText: copyRichText(normalized, text) };
  if (next.richText?.every((run) => !run.style || !Object.keys(run.style).length))
    delete next.richText;
  return structuredClone(next);
}
