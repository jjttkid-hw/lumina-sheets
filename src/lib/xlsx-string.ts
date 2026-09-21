/** OOXML ST_Xstring escapes UTF-16 units; decoding is deliberately single-pass. */
export function decodeXlsxString(text: string): string {
  return text.replace(/_x([0-9a-f]{4})_/gi, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/** Protect literal escape-shaped text before escaping XML-illegal units and CR. */
export function encodeXlsxString(text: string): string {
  const literal = text.replace(/_x(?=[0-9a-f]{4}_)/gi, (prefix) => `_x005F_${prefix.slice(1)}`);
  let result = '';
  for (let index = 0; index < literal.length; index++) {
    const unit = literal.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < literal.length) {
      const next = literal.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += literal.slice(index, index + 2);
        index++;
        continue;
      }
    }
    if (
      (unit < 0x20 && unit !== 9 && unit !== 10) ||
      unit === 0x7f ||
      (unit >= 0xd800 && unit <= 0xdfff) ||
      unit >= 0xfffe
    )
      result += `_x${unit.toString(16).toUpperCase().padStart(4, '0')}_`;
    else result += literal[index];
  }
  return result;
}
