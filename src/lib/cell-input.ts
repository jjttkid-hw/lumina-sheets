import type { CellValue } from './types';

// Compare decimal spellings without expanding exponent-sized strings. This
// detects visible rounding/underflow, not exact binary floating-point equality.
function decimalIdentity(text: string): string {
  const [mantissa, exponent = '0'] = text.toLowerCase().split('e');
  const negative = mantissa.startsWith('-');
  const [whole, fraction = ''] = (negative ? mantissa.slice(1) : mantissa).split('.');
  const digits = (whole + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const coefficient = digits.replace(/0+$/, '');
  const power = Number(exponent) - fraction.length + digits.length - coefficient.length;
  return `${negative ? '-' : ''}${coefficient}e${power}`;
}

/** Convert editor text to a cell value without silently rounding numeric input.
 * Leading apostrophe removes one text-entry prefix; formulas remain formula strings.
 * TRUE/FALSE are booleans. Identifiers, unsafe integers, negative zero and decimal
 * spellings changed by Number conversion remain text. Does not validate cell size. */
export function parseCellInput(value: string): CellValue {
  if (typeof value !== 'string') throw new TypeError('单元格输入必须为文本。');
  if (value.startsWith("'")) return value.slice(1);
  if (value === 'TRUE') return true;
  if (value === 'FALSE') return false;
  const text = value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return value;
  const number = Number(text);
  return Number.isFinite(number) &&
    !Object.is(number, -0) &&
    (!Number.isInteger(number) || Number.isSafeInteger(number)) &&
    decimalIdentity(text) === decimalIdentity(String(number))
    ? number
    : value;
}
