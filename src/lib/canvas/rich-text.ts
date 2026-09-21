import type { Cell, RichTextStyle } from '../types';

const FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
/** A consistent script scale/offset for screen and raster print; not font-specific metrics. */
export function richTextMetrics(style: RichTextStyle, factor = 1) {
  const base = (style.fontSize ?? 12) * factor;
  const scripted = style.verticalAlign === 'superscript' || style.verticalAlign === 'subscript';
  const size = base * (scripted ? 0.65 : 1);
  const offset =
    style.verticalAlign === 'superscript'
      ? -base * 0.3
      : style.verticalAlign === 'subscript'
        ? base * 0.3
        : 0;
  return { size, offset, height: 2 * (Math.abs(offset) + size * 0.7) };
}
export function richTextFont(style: RichTextStyle, factor = 1): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${richTextMetrics(style, factor).size}px ${style.fontFamily ? `${JSON.stringify(style.fontFamily)}, ` : ''}${FAMILY}`;
}
export interface TextSegment {
  text: string;
  width: number;
  style: RichTextStyle;
}
export interface TextLine {
  segments: TextSegment[];
  width: number;
  height: number;
}
/** Measure runs, optionally wrapping by Unicode code point at print width. */
export function layoutRichText(
  context: CanvasRenderingContext2D,
  cell: Cell,
  factor = 1,
  available = Infinity,
): TextLine[] {
  const base = cell.style ?? {};
  const lines: TextLine[] = [];
  let line: TextLine = { segments: [], width: 0, height: (base.fontSize ?? 12) * factor * 1.4 };
  const flush = () => {
    lines.push(line);
    line = { segments: [], width: 0, height: (base.fontSize ?? 12) * factor * 1.4 };
  };
  for (const run of cell.richText ?? [{ text: String(cell.value) }]) {
    const style = { ...base, ...run.style };
    context.font = richTextFont(style, factor);
    if (!Number.isFinite(available)) {
      const width = context.measureText(run.text).width;
      line.segments.push({ text: run.text, width, style });
      line.width += width;
      line.height = Math.max(line.height, richTextMetrics(style, factor).height);
      continue;
    }
    let segment: TextSegment | undefined;
    for (const char of run.text.replace(/\r\n?/g, '\n')) {
      if (char === '\n') {
        flush();
        segment = undefined;
        continue;
      }
      const width = context.measureText(char).width;
      if (width > available) throw new Error('富文本字体超过列宽，无法完整导出 PDF。');
      const candidate = segment ? context.measureText(segment.text + char).width : width;
      if (line.width + candidate - (segment?.width ?? 0) > available && line.segments.length) {
        flush();
        segment = undefined;
      }
      if (!segment) {
        segment = { text: '', width: 0, style };
        line.segments.push(segment);
      }
      const nextWidth = context.measureText(segment.text + char).width;
      line.width += nextWidth - segment.width;
      segment.text += char;
      segment.width = nextWidth;
      line.height = Math.max(line.height, richTextMetrics(style, factor).height);
    }
  }
  flush();
  return lines;
}

/** The caller owns clipping; run fonts/colors do not escape the saved context. */
export function drawRichTextLine(
  context: CanvasRenderingContext2D,
  line: TextLine,
  anchor: number,
  middle: number,
  align: 'left' | 'center' | 'right',
  factor = 1,
  defaultColor = '#39443d',
  stroke = 1,
): void {
  context.save();
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  let x =
    align === 'right' ? anchor - line.width : align === 'center' ? anchor - line.width / 2 : anchor;
  for (const segment of line.segments) {
    context.font = richTextFont(segment.style, factor);
    context.fillStyle = segment.style.color ?? defaultColor;
    const metrics = richTextMetrics(segment.style, factor);
    const center = middle + metrics.offset;
    context.fillText(segment.text, x, center);
    if (segment.style.underline)
      context.fillRect(x, center + metrics.size / 2, segment.width, stroke);
    if (segment.style.strike) context.fillRect(x, center, segment.width, stroke);
    x += segment.width;
  }
  context.restore();
}
