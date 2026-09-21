/** Conservative text evidence, not SPDX identification or a legal opinion.
 * A filename, attribution or link alone never establishes a permission grant. */
export function hasLicenseText(text) {
  const normalized = text.replace(/\s+/g, ' ');
  const warranty = /(?:AS[ -]IS|WITHOUT WARRANTY|DISCLAIMS ALL WARRANTIES)/i.test(normalized);
  const liability = /(?:LIABILITY|LIABLE)/i.test(normalized);
  if (!warranty || !liability) return false;
  if (
    /copyright/i.test(normalized) &&
    /permission (?:is hereby granted|to use, copy)/i.test(normalized) &&
    /(?:permission notice|copyright notice)/i.test(normalized)
  )
    return true;
  if (
    /copyright/i.test(normalized) &&
    /redistribution and use in source and binary forms/i.test(normalized) &&
    /retain the above copyright notice/i.test(normalized)
  )
    return true;
  if (
    /Apache License Version 2\.0/i.test(normalized) &&
    /Grant of Copyright License/i.test(normalized) &&
    /Grant of Patent License/i.test(normalized) &&
    /END OF TERMS AND CONDITIONS/i.test(normalized)
  )
    return true;
  if (
    /free and unencumbered software released into the public domain/i.test(normalized) &&
    /Anyone is free to copy, modify, publish, use, compile, sell/i.test(normalized) &&
    /dedicate any and all copyright interest/i.test(normalized)
  )
    return true;
  return (
    /Permission is granted to anyone to use this software for any purpose/i.test(normalized) &&
    /origin of this software must not be misrepresented/i.test(normalized) &&
    /Altered source versions must be plainly marked/i.test(normalized) &&
    /This notice may not be removed or altered/i.test(normalized)
  );
}

/** Conservative family recognition for declared-license coverage, not legal approval. */
export function recognizedLicenseTexts(text) {
  if (!hasLicenseText(text)) return [];
  const value = text.replace(/\s+/g, ' ');
  const found = [];
  if (
    /Permission is hereby granted, free of charge/i.test(value) &&
    /to deal in the Software without restriction/i.test(value) &&
    /all copies or substantial portions/i.test(value)
  )
    found.push('MIT');
  if (
    /Permission to use, copy, modify, and(?:\/or)? distribute/i.test(value) &&
    /with or without fee/i.test(value) &&
    /copyright notice and this permission notice/i.test(value)
  )
    found.push('ISC');
  if (
    /redistribution and use in source and binary forms/i.test(value) &&
    /redistributions in binary form must reproduce/i.test(value) &&
    /Neither the name/i.test(value)
  )
    found.push('BSD-3-Clause');
  if (
    /Apache License Version 2\.0/i.test(value) &&
    /Grant of Copyright License/i.test(value) &&
    /Grant of Patent License/i.test(value) &&
    /END OF TERMS AND CONDITIONS/i.test(value)
  )
    found.push('Apache-2.0');
  if (
    /free and unencumbered software released into the public domain/i.test(value) &&
    /dedicate any and all copyright interest/i.test(value)
  )
    found.push('Unlicense');
  if (
    /Permission is granted to anyone to use this software for any purpose/i.test(value) &&
    /origin of this software must not be misrepresented/i.test(value) &&
    /Altered source versions must be plainly marked/i.test(value) &&
    /This notice may not be removed or altered/i.test(value)
  )
    found.push('Zlib');
  return found.sort();
}

/** Limited SPDX-like AND/OR evaluation. Unknown syntax/identifiers stay unresolved.
 * OR needs one evidenced route; AND requires every operand. No exception inference. */
export function declaredLicenseCoverage(declared, texts) {
  const recognized = [...new Set(texts.flatMap(recognizedLicenseTexts))].sort();
  const unresolved = { status: 'review', recognized, expressionSupported: false };
  if (typeof declared !== 'string' || declared.length > 1000) return unresolved;
  // Historical MIT/X11 metadata in the installed closure is the MIT family alias.
  const expression = declared === 'MIT/X11' ? 'MIT' : declared;
  const tokens = expression.match(/[A-Za-z0-9.+-]+|[()]|\S/g) ?? [];
  if (!tokens.length || tokens.length > 100) return unresolved;
  let cursor = 0;
  const known = new Set([
    'MIT',
    'ISC',
    'BSD-3-Clause',
    'Apache-2.0',
    'Unlicense',
    'Zlib',
    'GPL-3.0-or-later',
  ]);
  const atom = () => {
    const token = tokens[cursor++];
    if (token === '(') {
      const result = or();
      if (tokens[cursor++] !== ')') throw Error('Unclosed expression');
      return result;
    }
    if (!known.has(token)) throw Error('Unsupported license');
    return recognized.includes(token);
  };
  const and = () => {
    let result = atom();
    while (tokens[cursor] === 'AND') {
      cursor++;
      const next = atom();
      result = result && next;
    }
    return result;
  };
  const or = () => {
    let result = and();
    while (tokens[cursor] === 'OR') {
      cursor++;
      const next = and();
      result = result || next;
    }
    return result;
  };
  try {
    const complete = or();
    if (cursor !== tokens.length) return unresolved;
    return {
      status: complete ? 'text-evidenced' : 'review',
      recognized,
      expressionSupported: true,
    };
  } catch {
    return unresolved;
  }
}
