import { MAX_COLUMNS, MAX_ROWS, columnLabel, parseCellKey } from './engine';

export interface StructureEdit {
  axis: 'row' | 'column';
  kind: 'insert' | 'delete';
  /** Zero-based coordinate; insert before this coordinate. */
  index: number;
  count: number;
}
export interface FormulaStructureContext {
  formulaSheetName: string;
  targetSheetName: string;
  edit: StructureEdit;
}
interface Token {
  kind: 'word' | 'quoted' | 'string' | 'number' | 'symbol' | 'space' | 'error';
  value: string;
  start: number;
  end: number;
}
interface Reference {
  start: number;
  end: number;
  key: Token;
  sheet?: string;
  next: number;
}

function validateEdit(edit: StructureEdit): void {
  if (!edit || !['row', 'column'].includes(edit.axis) || !['insert', 'delete'].includes(edit.kind))
    throw new RangeError('Invalid structure edit');
  const limit = edit.axis === 'row' ? MAX_ROWS : MAX_COLUMNS;
  if (
    !Number.isSafeInteger(edit.index) ||
    !Number.isSafeInteger(edit.count) ||
    edit.index < 0 ||
    edit.count < 1 ||
    edit.index >= limit ||
    edit.count > limit ||
    edit.index + edit.count > limit
  )
    throw new RangeError('Structure edit exceeds spreadsheet limits');
}

function scan(formula: string): Token[] {
  const result: Token[] = [];
  let at = 1;
  while (at < formula.length) {
    const start = at;
    const char = formula[at];
    let kind: Token['kind'];
    if (char === '"' || char === "'") {
      kind = char === '"' ? 'string' : 'quoted';
      const quote = char;
      at++;
      let closed = false;
      while (at < formula.length) {
        if (formula[at] === quote) {
          if (formula[at + 1] === quote) at += 2;
          else {
            at++;
            closed = true;
            break;
          }
        } else at++;
      }
      if (!closed) throw new SyntaxError('Unclosed formula string or sheet name');
    } else if (/\s/u.test(char)) {
      kind = 'space';
      while (at < formula.length && /\s/u.test(formula[at])) at++;
    } else if (char === '[' || char === ']') {
      throw new SyntaxError(
        'External workbook and structured references are not supported by structure edits',
      );
    } else {
      const rest = formula.slice(at);
      const error = /^#(?:DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|NULL!|CYCLE!|ERROR!)/i.exec(rest);
      const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
      const word = /^[\p{L}_$][\p{L}\p{N}_.$]*/u.exec(rest);
      if (error) {
        kind = 'error';
        at += error[0].length;
      } else if (number) {
        kind = 'number';
        at += number[0].length;
      } else if (word) {
        kind = 'word';
        at += word[0].length;
      } else {
        if (!/[+\-*/^&%=<>(),;:!]/.test(char))
          throw new SyntaxError(`Unsupported formula syntax in structure edit: ${char}`);
        kind = 'symbol';
        at++;
      }
    }
    result.push({ kind, value: formula.slice(start, at), start, end: at });
  }
  return result.filter((token) => token.kind !== 'space');
}
const sheetName = (token: Token): string =>
  token.kind === 'quoted' ? token.value.slice(1, -1).replaceAll("''", "'") : token.value;
const equalName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Rename only explicit worksheet qualifiers; string literals remain opaque. */
export function renameFormulaSheet(
  formula: string,
  ownerName: string,
  previousName: string,
  nextName: string,
): string {
  if (!formula.startsWith('=')) return formula;
  validateFormulaReferences(formula, ownerName);
  const tokens = scan(formula);
  const replacements = tokens.filter(
    (token, index) =>
      (token.kind === 'word' || token.kind === 'quoted') &&
      tokens[index + 1]?.kind === 'symbol' &&
      tokens[index + 1]?.value === '!' &&
      equalName(sheetName(token), previousName),
  );
  let result = formula;
  const quoted = `'${nextName.replaceAll("'", "''")}'`;
  for (const token of replacements.reverse())
    result = result.slice(0, token.start) + quoted + result.slice(token.end);
  return result;
}
function readReference(tokens: Token[], index: number): Reference | null {
  const first = tokens[index];
  if (!first || !['word', 'quoted'].includes(first.kind)) return null;
  const previous = tokens[index - 1];
  if (previous?.value === '!') return null;
  if (
    previous &&
    previous.end === first.start &&
    ['number', 'word', 'quoted'].includes(previous.kind)
  )
    return null;
  let key = first;
  let next = index + 1;
  let sheet: string | undefined;
  if (tokens[next]?.value === '!') {
    sheet = sheetName(first);
    if (/[\[\]]/.test(sheet))
      throw new SyntaxError('External workbook references are not supported by structure edits');
    if (sheet.includes(':'))
      throw new SyntaxError('3D sheet references are not supported by structure edits');
    key = tokens[next + 1];
    next += 2;
  } else if (first.kind === 'quoted') {
    // The evaluator historically accepts some single-quoted A1 tokens. They
    // are not Excel string/reference syntax, so never silently skip them here.
    throw new SyntaxError('Single-quoted values are only supported as qualified sheet names');
  }
  if (!key || key.kind !== 'word' || !parseCellKey(key.value)) {
    if (sheet !== undefined && key?.kind !== 'error')
      throw new SyntaxError('Only qualified A1 references are supported by structure edits');
    return null;
  }
  // A function/identifier that happens to look like A1 is not a cell reference.
  if (tokens[next]?.value === '(') return null;
  return { start: first.start, end: key.end, key, sheet, next };
}
function axisPosition(key: Token, edit: StructureEdit): number {
  const position = parseCellKey(key.value)!;
  return edit.axis === 'row' ? position.row : position.col;
}
function rewrittenKey(key: Token, position: number, edit: StructureEdit): string {
  const old = parseCellKey(key.value)!;
  const limit = edit.axis === 'row' ? MAX_ROWS : MAX_COLUMNS;
  if (position < 0 || position >= limit)
    throw new RangeError('Rewritten reference exceeds spreadsheet limits');
  if (position === (edit.axis === 'row' ? old.row : old.col)) return key.value;
  const match = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(key.value)!;
  const row = edit.axis === 'row' ? position : old.row;
  let label = edit.axis === 'column' ? columnLabel(position) : match[2];
  if (edit.axis === 'column' && match[2] === match[2].toLowerCase()) label = label.toLowerCase();
  return `${match[1]}${label}${match[3]}${row + 1}`;
}
function singlePosition(position: number, edit: StructureEdit): number | null {
  if (edit.kind === 'insert') return position >= edit.index ? position + edit.count : position;
  if (position < edit.index) return position;
  if (position < edit.index + edit.count) return null;
  return position - edit.count;
}
function rangePositions(a: number, b: number, edit: StructureEdit): [number, number] | null {
  const low = Math.min(a, b),
    high = Math.max(a, b);
  let start: number, end: number;
  if (edit.kind === 'insert') {
    start = low >= edit.index ? low + edit.count : low;
    end = high >= edit.index ? high + edit.count : high;
  } else {
    const deletionEnd = edit.index + edit.count;
    if (low >= edit.index && high < deletionEnd) return null;
    start = low < edit.index ? low : low >= deletionEnd ? low - edit.count : edit.index;
    end = high < edit.index ? high : high >= deletionEnd ? high - edit.count : edit.index - 1;
  }
  return a <= b ? [start, end] : [end, start];
}

/** Validate reference syntax before moving a formula without a structural edit. */
export function validateFormulaReferences(formula: string, formulaSheetName: string): void {
  if (typeof formula !== 'string' || !formula.startsWith('=')) return;
  const tokens = scan(formula);
  for (let index = 0; index < tokens.length - 3; index++) {
    if (
      tokens[index - 1]?.value !== '!' &&
      ['word', 'quoted'].includes(tokens[index].kind) &&
      tokens[index + 1]?.value === ':' &&
      ['word', 'quoted'].includes(tokens[index + 2]?.kind) &&
      tokens[index + 3]?.value === '!'
    )
      throw new SyntaxError('3D sheet references are not supported');
  }
  for (let index = 0; index < tokens.length;) {
    const reference = readReference(tokens, index);
    if (!reference) {
      if (tokens[index].value === ':')
        throw new SyntaxError('Unsupported row, column or range reference');
      index++;
      continue;
    }
    if (tokens[reference.next]?.value === ':') {
      const end = readReference(tokens, reference.next + 1);
      if (!end) throw new SyntaxError('Unsupported range reference');
      if (end.sheet && !equalName(end.sheet, reference.sheet ?? formulaSheetName))
        throw new SyntaxError('Range endpoints on different sheets are not supported');
      index = end.next;
    } else index = reference.next;
  }
}

/** Rewrites supported A1 references without reformatting the rest of a formula. */
export function rewriteFormulaReferences(
  formula: string,
  context: FormulaStructureContext,
): string {
  validateEdit(context.edit);
  if (typeof formula !== 'string' || !formula.startsWith('=')) return formula;
  const tokens = scan(formula);
  // Reject sheet spans before interpreting A1-shaped sheet names as ranges.
  for (let i = 0; i < tokens.length - 3; i++) {
    if (
      tokens[i - 1]?.value !== '!' &&
      ['word', 'quoted'].includes(tokens[i].kind) &&
      tokens[i + 1]?.value === ':' &&
      ['word', 'quoted'].includes(tokens[i + 2]?.kind) &&
      tokens[i + 3]?.value === '!'
    )
      throw new SyntaxError('3D sheet references are not supported by structure edits');
  }
  const patches: Array<{ start: number; end: number; text: string }> = [];
  const applies = (reference: Reference, inherited?: string) =>
    equalName(reference.sheet ?? inherited ?? context.formulaSheetName, context.targetSheetName);
  for (let i = 0; i < tokens.length;) {
    const reference = readReference(tokens, i);
    if (!reference) {
      if (tokens[i].value === ':')
        throw new SyntaxError(
          'Unsupported whole-row, whole-column or range reference in structure edit',
        );
      i++;
      continue;
    }
    const colon = tokens[reference.next];
    if (colon?.value === ':') {
      const end = readReference(tokens, reference.next + 1);
      if (!end) throw new SyntaxError('Unsupported range reference in structure edit');
      if (end.sheet && !equalName(end.sheet, reference.sheet ?? context.formulaSheetName))
        throw new SyntaxError('Range endpoints on different sheets are not supported');
      if (applies(reference)) {
        const positions = rangePositions(
          axisPosition(reference.key, context.edit),
          axisPosition(end.key, context.edit),
          context.edit,
        );
        if (!positions) patches.push({ start: reference.start, end: end.end, text: '#REF!' });
        else {
          patches.push({
            start: reference.key.start,
            end: reference.key.end,
            text: rewrittenKey(reference.key, positions[0], context.edit),
          });
          patches.push({
            start: end.key.start,
            end: end.key.end,
            text: rewrittenKey(end.key, positions[1], context.edit),
          });
        }
      }
      i = end.next;
    } else {
      if (applies(reference)) {
        const position = singlePosition(axisPosition(reference.key, context.edit), context.edit);
        patches.push(
          position === null
            ? { start: reference.start, end: reference.end, text: '#REF!' }
            : {
                start: reference.key.start,
                end: reference.key.end,
                text: rewrittenKey(reference.key, position, context.edit),
              },
        );
      }
      i = reference.next;
    }
  }
  let result = formula;
  for (const patch of patches.sort((a, b) => b.start - a.start))
    result = result.slice(0, patch.start) + patch.text + result.slice(patch.end);
  return result;
}
