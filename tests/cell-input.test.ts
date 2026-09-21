import { describe, expect, it } from 'vitest';
import { parseCellInput } from '../src/lib/cell-input';

describe('loss-aware editor input', () => {
  it.each([
    '1e-999',
    '3e-324',
    '-0',
    '-0.00',
    '0.1234567890123456789',
    '9007199254740993',
    '00123',
    ' 1e-999 ',
    '1e999',
    '',
    ' ',
    'true',
    '=A1*2',
    '+12',
    '.5',
    '1.',
  ])('retains %j as text', (text) => {
    expect(parseCellInput(text)).toBe(text);
  });
  it.each([
    ['0.1', 0.1],
    ['1.20E+3', 1200],
    [' 12 ', 12],
    ['-2.5', -2.5],
    ['5e-324', 5e-324],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
    ['0e999', 0],
  ])('parses %s as %s', (text, number) => {
    expect(parseCellInput(text as string)).toBe(number);
  });
  it('preserves explicit text and boolean entry conventions', () => {
    expect(parseCellInput("'123")).toBe('123');
    expect(parseCellInput("'TRUE")).toBe('TRUE');
    expect(parseCellInput('TRUE')).toBe(true);
    expect(parseCellInput('FALSE')).toBe(false);
    expect(() => parseCellInput(4 as never)).toThrow(TypeError);
  });
});
