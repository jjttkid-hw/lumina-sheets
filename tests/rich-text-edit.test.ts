import { describe, expect, it } from 'vitest';
import { formatTextRange, textareaTextRange } from '../src/lib/rich-text-edit';
import type { Cell } from '../src/lib/types';

describe('inline format editing', () => {
  it('maps textarea-normalized line breaks back to original CRLF and CR offsets', () => {
    const cell = { value: 'a\r\n😀\rb' };
    const range = textareaTextRange(cell.value, 2, 4);
    expect(range).toEqual({ start: 3, end: 5 });
    expect(formatTextRange(cell, range.start, range.end, { bold: true }).richText).toEqual([
      { text: 'a\r\n' },
      { text: '😀', style: { bold: true } },
      { text: '\rb' },
    ]);
    expect(textareaTextRange(cell.value, 0, 6)).toEqual({ start: 0, end: 7 });
    expect(() => textareaTextRange(cell.value, 0, 7)).toThrow('选区');
  });
  it('splits across existing runs, preserves unselected style and metadata, isolates the result', () => {
    const cell: Cell = {
      value: 'abcdef',
      style: { bold: true },
      hyperlink: { target: '#A1' },
      richText: [
        { text: 'abc', style: { italic: true } },
        { text: 'def', style: { color: '#ff0000' } },
      ],
    };
    const before = structuredClone(cell);
    const result = formatTextRange(cell, 1, 5, { bold: false });
    expect(result.richText).toEqual([
      { text: 'a', style: { italic: true } },
      { text: 'bc', style: { italic: true, bold: false } },
      { text: 'de', style: { color: '#ff0000', bold: false } },
      { text: 'f', style: { color: '#ff0000' } },
    ]);
    expect(result.value).toBe(cell.value);
    expect(result.hyperlink).toEqual(cell.hyperlink);
    result.hyperlink!.target = '#B1';
    result.richText![0].style!.italic = false;
    expect(cell).toEqual(before);
  });
  it('coalesces equal runs regardless of property order and restores inherited styles', () => {
    const cell: Cell = {
      value: 'abc',
      style: { bold: true },
      richText: [
        { text: 'a', style: { bold: false, italic: true } },
        { text: 'bc', style: { italic: true, bold: false } },
      ],
    };
    const joined = formatTextRange(cell, 0, 3, { color: '#ff0000' });
    expect(joined.richText).toHaveLength(1);
    const partlyReset = formatTextRange(joined, 1, 2, null);
    expect(partlyReset.richText?.[1]).toEqual({ text: 'b' });
    const reset = formatTextRange(joined, 0, 3, null);
    expect(reset).toEqual({ value: 'abc', style: { bold: true } });
  });
  it('keeps whole surrogate pairs and refuses invalid selections before mutation', () => {
    const cell = { value: 'a😀b' };
    expect(formatTextRange(cell, 1, 3, { bold: true }).richText).toEqual([
      { text: 'a' },
      { text: '😀', style: { bold: true } },
      { text: 'b' },
    ]);
    for (const range of [
      [1, 2],
      [2, 3],
      [0, 0],
      [-1, 1],
      [0, 5],
      [0, 1.5],
    ])
      expect(() => formatTextRange(cell, range[0], range[1], {})).toThrow();
    expect(() => formatTextRange({ value: '=1' }, 0, 2, {})).toThrow('普通文本');
    expect(() => formatTextRange({ value: 1 }, 0, 1, {})).toThrow('普通文本');
    expect(() => formatTextRange(cell, 0, 1, { fontSize: NaN })).toThrow('字号');
    expect(cell).toEqual({ value: 'a😀b' });
  });
  it('preserves empty-run metadata and remains bounded after repeated formatting', () => {
    let cell: Cell = {
      value: 'abc',
      richText: [{ text: '', style: { italic: true } }, { text: 'abc' }],
    };
    for (let i = 0; i < 100; i++) cell = formatTextRange(cell, 1, 2, { bold: i % 2 === 0 });
    expect(cell.richText).toHaveLength(4);
    expect(cell.richText?.[0]).toEqual({ text: '', style: { italic: true } });
    expect(cell.richText?.map((run) => run.text).join('')).toBe('abc');
  });
});
