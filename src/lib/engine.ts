import { compileWildcard } from './wildcard';
import { RangeDependencyIndex } from './range-dependency-index';
import type { Cell, CellValue, Sheet, Workbook } from './types';

export const MAX_ROWS = 1_048_576;
export const MAX_COLUMNS = 16_384;
const MAX_RANGE_CELLS = 100_000;
const MAX_PARSED_EXPRESSIONS = 4_096;
type Scalar = CellValue | null;
class FormulaError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
function fail(code = '#VALUE!'): never {
  throw new FormulaError(code);
}
type Token = {
  type: 'number' | 'string' | 'word' | 'quoted' | 'error' | 'op' | 'eof';
  value: string;
};
type Reference = { kind: 'ref'; key: string; sheet?: string };
type Node =
  | { kind: 'literal'; value: Scalar }
  | { kind: 'error'; code: string }
  | Reference
  | { kind: 'range'; start: Reference; end: Reference }
  | { kind: 'unary'; op: string; child: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };
type Matrix = { rows: Scalar[][] };
type Result = Scalar | Matrix;

export function columnLabel(col: number): string {
  if (!Number.isInteger(col) || col < 0) return '';
  let out = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}
export function cellKey(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`;
}
export function parseCellKey(key: string): { row: number; col: number } | null {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(key);
  if (!match) return null;
  let col = 0;
  for (const letter of match[1].toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]);
  return row <= MAX_ROWS && col <= MAX_COLUMNS ? { row: row - 1, col: col - 1 } : null;
}

/** Adjusts relative A1 references for spreadsheet copy/paste without changing string literals. */
export function translateFormula(formula: string, rowDelta: number, colDelta: number): string {
  if (!formula.startsWith('=')) return formula;
  const coordinate = '\\$?[A-Za-z]{1,3}\\$?[1-9]\\d*';
  const qualifier = "(?:(?:'(?:[^']|'')*'|[\\p{L}_$][\\p{L}\\p{N}_.$]*)\\s*!\\s*)";
  // Match a whole reference/range so an invalid endpoint becomes one #REF!
  // rather than a malformed range such as #REF!:A1. Quoted strings are opaque.
  const references = new RegExp(
    `"(?:[^"]|"")*"|(${qualifier})?(${coordinate})(?:(\\s*:\\s*)(${qualifier})?(${coordinate}))?|'(?:[^']|'')*'`,
    'gu',
  );
  return formula.replace(
    references,
    (
      match,
      prefix: string | undefined,
      key: string | undefined,
      separator: string | undefined,
      endPrefix: string | undefined,
      endKey: string | undefined,
      offset: number,
    ) => {
      if (!key) return match;
      const before = formula[offset - 1] ?? '';
      const after = formula[offset + match.length] ?? '';
      const next = formula.slice(offset + match.length).trimStart()[0] ?? '';
      if (
        /[\p{L}\p{N}_.$]/u.test(before) ||
        /[\p{L}\p{N}_.$]/u.test(after) ||
        next === '(' ||
        next === '!'
      )
        return match;
      if (!parseCellKey(key) || (endKey && !parseCellKey(endKey))) return match;
      const move = (reference: string): string | null => {
        const position = parseCellKey(reference)!;
        const parts = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(reference)!;
        const row = position.row + (parts[3] ? 0 : rowDelta);
        const col = position.col + (parts[1] ? 0 : colDelta);
        if (row < 0 || row >= MAX_ROWS || col < 0 || col >= MAX_COLUMNS) return null;
        return `${parts[1]}${columnLabel(col)}${parts[3]}${row + 1}`;
      };
      const start = move(key);
      const end = endKey ? move(endKey) : undefined;
      if (start === null || end === null) return '#REF!';
      return `${prefix ?? ''}${start}${separator ? `${separator}${endPrefix ?? ''}${end}` : ''}`;
    },
  );
}

function tokenize(input: string): Token[] {
  if (input.length > 8192) fail('#VALUE!');
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (/\s/u.test(char)) {
      i++;
      continue;
    }
    const error = /^#(?:DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|NULL!|CYCLE!|ERROR!)/i.exec(
      input.slice(i),
    );
    if (error) {
      tokens.push({ type: 'error', value: error[0].toUpperCase() });
      i += error[0].length;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      let closed = false;
      i++;
      while (i < input.length) {
        if (input[i] === quote) {
          if (input[i + 1] === quote) {
            value += quote;
            i += 2;
          } else {
            i++;
            closed = true;
            break;
          }
        } else value += input[i++];
      }
      if (!closed) fail('#ERROR!');
      tokens.push({ type: quote === '"' ? 'string' : 'quoted', value });
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(i));
    if (number) {
      tokens.push({ type: 'number', value: number[0] });
      i += number[0].length;
      continue;
    }
    const word = /^[\p{L}_$][\p{L}\p{N}_.$]*/u.exec(input.slice(i));
    if (word) {
      tokens.push({ type: 'word', value: word[0] });
      i += word[0].length;
      continue;
    }
    const op = /^(?:<>|<=|>=|!=|[+\-*/^&%=<>(),;:!])/.exec(input.slice(i));
    if (op) {
      tokens.push({ type: 'op', value: op[0] === ';' ? ',' : op[0] });
      i += op[0].length;
      continue;
    }
    fail('#ERROR!');
  }
  return [...tokens, { type: 'eof', value: '' }];
}

class Parser {
  private at = 0;
  private depth = 0;
  constructor(private tokens: Token[]) {}
  private peek() {
    return this.tokens[this.at];
  }
  private take() {
    return this.tokens[this.at++];
  }
  private consume(value: string) {
    if (this.peek().type !== 'op' || this.peek().value !== value) return false;
    this.at++;
    return true;
  }
  private expect(value: string) {
    if (!this.consume(value)) fail('#ERROR!');
  }
  parse(): Node {
    const node = this.expression(0);
    if (this.peek().type !== 'eof') fail('#ERROR!');
    return node;
  }
  private expression(min: number): Node {
    if (++this.depth > 128) fail('#ERROR!');
    let left = this.prefix();
    const precedence: Record<string, number> = {
      '=': 1,
      '<>': 1,
      '!=': 1,
      '<': 1,
      '>': 1,
      '<=': 1,
      '>=': 1,
      '&': 2,
      '+': 3,
      '-': 3,
      '*': 4,
      '/': 4,
      '^': 5,
    };
    while (true) {
      if (this.peek().type !== 'op') break;
      const op = this.peek().value;
      if (op === '%') {
        this.take();
        left = { kind: 'unary', op, child: left };
        continue;
      }
      const level = precedence[op];
      if (level === undefined || level < min) break;
      this.take();
      left = { kind: 'binary', op, left, right: this.expression(level + (op === '^' ? 0 : 1)) };
    }
    this.depth--;
    return left;
  }
  private prefix(): Node {
    const token = this.take();
    if (token.type === 'op' && (token.value === '+' || token.value === '-'))
      return { kind: 'unary', op: token.value, child: this.expression(6) };
    if (token.type === 'op' && token.value === '(') {
      const node = this.expression(0);
      this.expect(')');
      return node;
    }
    if (token.type === 'number') return { kind: 'literal', value: Number(token.value) };
    if (token.type === 'string') return { kind: 'literal', value: token.value };
    if (token.type === 'error') return { kind: 'error', code: token.value };
    if (token.type !== 'word' && token.type !== 'quoted') fail('#ERROR!');
    if (token.type === 'word' && this.consume('(')) {
      const args: Node[] = [];
      if (!this.consume(')')) {
        do {
          args.push(
            this.peek().type === 'op' && (this.peek().value === ',' || this.peek().value === ')')
              ? { kind: 'literal', value: null }
              : this.expression(0),
          );
        } while (this.consume(','));
        this.expect(')');
      }
      return { kind: 'call', name: token.value.toUpperCase(), args };
    }
    let sheet: string | undefined;
    let key = token.value;
    if (this.consume('!')) {
      sheet = token.value;
      const address = this.take();
      if (address.type !== 'word') fail('#REF!');
      key = address.value;
    } else if (token.type === 'quoted') fail('#ERROR!');
    else if (/^(TRUE|FALSE)$/i.test(key))
      return { kind: 'literal', value: key.toUpperCase() === 'TRUE' };
    if (!parseCellKey(key)) fail(sheet ? '#REF!' : '#NAME?');
    const start: Reference = { kind: 'ref', key: key.replaceAll('$', '').toUpperCase(), sheet };
    if (!this.consume(':')) return start;
    const endpoint = this.take();
    if (endpoint.type !== 'word' && endpoint.type !== 'quoted') fail('#REF!');
    let endKey = endpoint.value;
    let endSheet = sheet;
    if (this.consume('!')) {
      endSheet = endKey;
      const address = this.take();
      if (address.type !== 'word') fail('#REF!');
      endKey = address.value;
    } else if (endpoint.type === 'quoted') fail('#REF!');
    if (!parseCellKey(endKey) || endSheet?.toLowerCase() !== sheet?.toLowerCase()) fail('#REF!');
    return {
      kind: 'range',
      start,
      end: { kind: 'ref', key: endKey.replaceAll('$', '').toUpperCase(), sheet: endSheet },
    };
  }
}

const isMatrix = (value: Result): value is Matrix => typeof value === 'object' && value !== null;
const scalar = (value: Result): Scalar => (isMatrix(value) ? (value.rows[0]?.[0] ?? null) : value);
function number(value: Result): number {
  const v = scalar(value);
  if (v === null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fail();
}
const stringify = (value: Result): string => {
  const v = scalar(value);
  return v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
};
const MAX_TEXT_LENGTH = 32767;
function boundedText(text: string): string {
  if (text.length > MAX_TEXT_LENGTH) fail('#VALUE!');
  return text;
}
function appendText(left: string, right: string): string {
  // Check before allocation: chained references must not grow exponentially.
  if (left.length + right.length > MAX_TEXT_LENGTH) fail('#VALUE!');
  return left + right;
}
const truthy = (value: Result): boolean => {
  const v = scalar(value);
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (/^TRUE$/i.test(v)) return true;
  if (/^FALSE$/i.test(v)) return false;
  return fail('#VALUE!');
};
const flatten = (values: Result[]): Scalar[] =>
  values.flatMap((value) => (isMatrix(value) ? value.rows.flat() : [value]));
const finite = (value: number): number => (Number.isFinite(value) ? value : fail('#NUM!'));

/** Solve a bounded financial rate without letting a bad Newton step escape the
 * spreadsheet domain. Newton is attempted first (matching common spreadsheet
 * implementations), then a logarithmically spaced bracket is bisected. */
function solveFinancialRate(
  equation: (rate: number) => number,
  guess: number,
  scale: number,
): number {
  const normalized = (rate: number) => {
    const value = equation(rate);
    return Number.isFinite(value) ? value / scale : value;
  };
  let rate = Math.min(Math.max(guess, -0.999999999), 1_000_000);
  for (let iteration = 0; iteration < 100; iteration++) {
    const value = normalized(rate);
    if (Number.isFinite(value) && Math.abs(value) <= 1e-11) return rate;
    const step = Math.max(1e-7, Math.abs(rate) * 1e-5);
    const left = Math.max(-0.999999999, rate - step);
    const right = Math.min(1_000_000, rate + step);
    const derivative = (normalized(right) - normalized(left)) / (right - left);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-14) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -1 || next > 1_000_000) break;
    rate = next;
  }

  const minimum = -0.999999999;
  const maximum = 1_000_000;
  let previousRate = minimum;
  let previous = normalized(previousRate);
  const samples = 320;
  for (let index = 1; index <= samples; index++) {
    const exponent = Math.log(1e-9) + (Math.log(1_000_001) - Math.log(1e-9)) * (index / samples);
    const currentRate = Math.min(maximum, Math.max(minimum, Math.exp(exponent) - 1));
    const current = normalized(currentRate);
    if (Number.isFinite(current) && Math.abs(current) <= 1e-11) return currentRate;
    if (Number.isFinite(previous) && Number.isFinite(current) && previous * current < 0) {
      let low = previousRate,
        high = currentRate,
        lowValue = previous;
      for (let iteration = 0; iteration < 120; iteration++) {
        const middle = (low + high) / 2;
        const middleValue = normalized(middle);
        if (!Number.isFinite(middleValue)) break;
        if (Math.abs(middleValue) <= 1e-11) return middle;
        if (lowValue * middleValue <= 0) {
          high = middle;
        } else {
          low = middle;
          lowValue = middleValue;
        }
      }
      const result = (low + high) / 2;
      if (Math.abs(normalized(result)) <= 1e-8) return result;
    }
    previousRate = currentRate;
    previous = current;
  }
  fail('#NUM!');
}
const shape = (value: Result): [number, number] =>
  isMatrix(value) ? [value.rows.length, value.rows[0]?.length ?? 0] : [1, 1];
const sameShape = (a: Result, b: Result): boolean => {
  const [ar, ac] = shape(a);
  const [br, bc] = shape(b);
  return ar === br && ac === bc;
};
function vector(value: Result): Scalar[] {
  const [rows, cols] = shape(value);
  if (rows !== 1 && cols !== 1) fail('#VALUE!');
  return flatten([value]);
}

// Excel's 1900 system deliberately preserves serial 60, the fictional
// 1900-02-29. UTC arithmetic and strict ISO input keep results timezone stable.
const DAY_MS = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 31);
const MAX_DATE_SERIAL = 2_958_465;
type DateParts = { year: number; month: number; day: number };
function utcSerial(timestamp: number): number {
  const days = (timestamp - EXCEL_EPOCH) / DAY_MS;
  return days >= 60 ? days + 1 : days;
}
function validSerial(serial: number): number {
  if (!Number.isFinite(serial) || serial < 0 || serial >= MAX_DATE_SERIAL + 1) fail('#NUM!');
  return serial;
}
function dateSerial(value: Result): number {
  const v = scalar(value);
  if (typeof v === 'number') return validSerial(v);
  if (typeof v !== 'string') fail('#VALUE!');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!match) fail('#VALUE!');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 1900 && month === 2 && day === 29) return 60;
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) fail('#VALUE!');
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    fail('#VALUE!');
  return validSerial(utcSerial(date.getTime()));
}
function dateParts(serial: number): DateParts {
  const day = Math.floor(validSerial(serial));
  if (day === 60) return { year: 1900, month: 2, day: 29 };
  if (day === 0) return { year: 1900, month: 1, day: 0 };
  const date = new Date(EXCEL_EPOCH + (day > 60 ? day - 1 : day) * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
function roundTo(value: number, places: number, mode: 'round' | 'up' | 'down'): number {
  if (Math.abs(places) > 308) fail('#NUM!');
  if (!Number.isFinite(value)) return fail('#NUM!');
  const factor = 10 ** places;
  const scaled = Math.abs(value) * factor;
  const rounded =
    mode === 'up'
      ? Math.ceil(scaled)
      : mode === 'down'
        ? Math.floor(scaled)
        : Math.round(scaled + Number.EPSILON * scaled);
  return finite((Math.sign(value) * rounded) / factor);
}
function compare(a: Scalar, b: Scalar): number {
  if (a === null) a = typeof b === 'string' ? '' : 0;
  if (b === null) b = typeof a === 'string' ? '' : 0;
  if (typeof a === 'string' && typeof b === 'string')
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  if (typeof a === typeof b) return a < b ? -1 : a > b ? 1 : 0;
  const order = (v: Scalar) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  return order(a) - order(b);
}
function boundedWildcard(pattern: string, unicode: boolean) {
  const match = compileWildcard(pattern, { unicode });
  return (text: string) => {
    try {
      return match(text);
    } catch (error) {
      if (error instanceof RangeError) fail('#NUM!');
      throw error;
    }
  };
}
function wildcardMatch(pattern: string): (value: Scalar) => boolean {
  const match = boundedWildcard(pattern, true);
  return (value) => typeof value === 'string' && match(value);
}
function criterion(test: Scalar): (value: Scalar) => boolean {
  if (typeof test !== 'string') return (value) => compare(value, test) === 0;
  const match = /^(<=|>=|<>|=|<|>)([\s\S]*)$/.exec(test);
  const op = match?.[1] ?? '=';
  const raw = match?.[2] ?? test;
  const target: Scalar = raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  const wildcard =
    typeof target === 'string' && /[?*~]/.test(target) && (op === '=' || op === '<>')
      ? boundedWildcard(target, false)
      : undefined;
  return (value) => {
    if (typeof target === 'number' && typeof value === 'string') {
      if (value.trim() !== '' && Number.isFinite(Number(value))) value = Number(value);
      else return op === '<>';
    }
    const c = wildcard
      ? wildcard(value === null ? '' : String(value))
        ? 0
        : 1
      : compare(value, target);
    return op === '='
      ? c === 0
      : op === '<>'
        ? c !== 0
        : op === '<'
          ? c < 0
          : op === '>'
            ? c > 0
            : op === '<='
              ? c <= 0
              : c >= 0;
  };
}

/**
 * A mutable-workbook evaluator. The default validates previously read inputs.
 * Hosts that report every cell edit can opt into managed mutations for O(1)
 * cache hits and dependency-directed invalidation.
 */
export interface EvaluatorOptions {
  /** Monotonic workbook revision supplied by an editor/worker. */
  revision?: number;
  /** Every value edit must be followed by invalidateCells before any read. */
  managedMutations?: boolean;
  /** Cached paged value only: null is blank, undefined is unavailable (#N/A).
   * This synchronous hook must not fetch data. Managed hosts invalidate after changes.
   */
  readPagedCell?: (sheet: Sheet, key: string) => CellValue | null | undefined;
}

export interface EvaluatorStats {
  formulaEvaluations: number;
  cacheHits: number;
  dependencyChecks: number;
  invalidatedEntries: number;
  cacheEntries: number;
  directDependencyEdges: number;
  rangeDependencyEdges: number;
  /** Actual rectangle containment tests during explicit invalidation. */
  rangeCandidateChecks: number;
  /** Visited tree nodes, including bounding-box-pruned nodes. */
  rangeNodeVisits: number;
  /** Current rectangle index nodes; one per registered range. */
  rangeIndexNodes: number;
  /** Retained formula ASTs; bounded independently from calculated results. */
  parsedExpressions: number;
}

export type EvaluationResult =
  { kind: 'value'; value: CellValue } | { kind: 'error'; error: string };

export interface Evaluator {
  (sheet: Sheet, key: string): CellValue;
  /** Distinguish literal error-looking text from a calculation error. */
  result(sheet: Sheet, key: string): EvaluationResult;
  /** Clear all cached results after unknown or structural workbook mutations. */
  invalidate(revision?: number): void;
  /** Call after applying a batch of cell value changes, including deletions. */
  invalidateCells(sheetId: string, keys: readonly string[], revision?: number): void;
  /** Reset counters without discarding cache entries or dependency edges. */
  resetStats(): void;
  /** Counters plus current graph sizes; returns a detached snapshot. */
  readonly stats: Readonly<EvaluatorStats>;
  readonly revision?: number;
}

type Dependency = {
  sheet: Sheet;
  key: string;
  value: Scalar;
  error?: string;
};
type RangeDependency = {
  sheetId: string;
  firstRow: number;
  lastRow: number;
  firstCol: number;
  lastCol: number;
};
type CacheEntry = {
  raw: CellValue | undefined;
  value: Scalar;
  error?: string;
  dependencies: Dependency[];
  directDependencies: string[];
  ranges: RangeDependency[];
};
type EvaluationFrame = {
  dependencies: Map<string, Dependency>;
  directDependencies: Set<string>;
  ranges: Map<string, RangeDependency>;
};
type ReadTracking = 'direct' | 'range' | false;

export function createEvaluator(workbook?: Workbook, options: EvaluatorOptions = {}): Evaluator {
  const cache = new Map<string, CacheEntry>();
  const stack = new Set<string>();
  const parsed = new Map<string, Node>();
  const dependents = new Map<string, Set<string>>();
  // A rectangle has one entry per consuming formula, never one per member cell.
  const rangeDependents = new Map<string, RangeDependencyIndex>();
  let directEdges = 0;
  let rangeEdges = 0;
  let depthLimitGeneration = 0;
  const counters = {
    formulaEvaluations: 0,
    cacheHits: 0,
    dependencyChecks: 0,
    invalidatedEntries: 0,
    rangeCandidateChecks: 0,
    rangeNodeVisits: 0,
  };
  let seenRevision = options.revision;
  const managed = options.managedMutations === true;
  const frames: EvaluationFrame[] = [];
  const canonicalKey = (key: string) => key.replaceAll('$', '').toUpperCase();
  // JSON tuples avoid collisions between user-supplied sheet ids and cell keys.
  const cellId = (sheetId: string, key: string) => JSON.stringify([sheetId, key]);
  const resolveSheet = (name: string | undefined, current: Sheet): Sheet =>
    name === undefined
      ? current
      : (workbook?.sheets.find((s) => s.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ??
        fail('#REF!'));

  const removeEntry = (id: string) => {
    const entry = cache.get(id);
    if (!entry) return;
    cache.delete(id);
    for (const dependencyId of entry.directDependencies) {
      const readers = dependents.get(dependencyId);
      if (readers?.delete(id)) directEdges--;
      if (readers?.size === 0) dependents.delete(dependencyId);
    }
    for (const sheetId of new Set(entry.ranges.map((range) => range.sheetId))) {
      const readers = rangeDependents.get(sheetId);
      rangeEdges -= readers?.removeOwner(id) ?? 0;
      if (readers?.size === 0) rangeDependents.delete(sheetId);
    }
  };

  const storeEntry = (id: string, entry: CacheEntry) => {
    removeEntry(id);
    cache.set(id, entry);
    for (const dependencyId of entry.directDependencies) {
      let readers = dependents.get(dependencyId);
      if (!readers) dependents.set(dependencyId, (readers = new Set()));
      if (!readers.has(id)) {
        readers.add(id);
        directEdges++;
      }
    }
    for (const range of entry.ranges) {
      let readers = rangeDependents.get(range.sheetId);
      if (!readers) rangeDependents.set(range.sheetId, (readers = new RangeDependencyIndex()));
      readers.add(id, range);
      rangeEdges++;
    }
  };

  const recordDependency = (
    sheet: Sheet,
    key: string,
    value: Scalar,
    error: string | undefined,
    tracking: ReadTracking,
  ) => {
    const frame = frames[frames.length - 1];
    if (!frame || tracking === false || (managed && tracking === 'range')) return;
    const id = cellId(sheet.id, key);
    frame.dependencies.set(id, { sheet, key, value, error });
    if (tracking === 'direct') frame.directDependencies.add(id);
  };

  const read = (sheet: Sheet, key: string, tracking: ReadTracking = 'direct'): Scalar => {
    const canonical = canonicalKey(key);
    const id = cellId(sheet.id, canonical);
    const currentRaw = sheet.cells[canonical]?.value;
    const deliver = (value: Scalar, error?: string): Scalar => {
      recordDependency(sheet, canonical, value, error, tracking);
      if (error) fail(error);
      return value;
    };
    if (sheet.dataSource?.kind === 'paged') {
      const value = options.readPagedCell?.(sheet, canonical);
      return value === undefined ? deliver(null, '#N/A') : deliver(value);
    }
    if (stack.has(id)) return deliver(null, '#CYCLE!');
    if (stack.size > 256) {
      depthLimitGeneration++;
      return deliver(null, '#NUM!');
    }
    const cached = cache.get(id);
    if (cached && (managed || Object.is(cached.raw, currentRaw))) {
      let valid = true;
      if (!managed) {
        stack.add(id);
        try {
          for (const dependency of cached.dependencies) {
            counters.dependencyChecks++;
            let value: Scalar = null;
            let error: string | undefined;
            try {
              value = read(dependency.sheet, dependency.key, false);
            } catch (caught) {
              if (!(caught instanceof FormulaError)) throw caught;
              error = caught.code;
            }
            if (!Object.is(value, dependency.value) || error !== dependency.error) {
              valid = false;
              break;
            }
          }
        } finally {
          stack.delete(id);
        }
      }
      if (valid) {
        counters.cacheHits++;
        return deliver(cached.value, cached.error);
      }
    }
    if (cached) removeEntry(id);
    const raw = currentRaw ?? null;
    if (typeof raw !== 'string' || !raw.startsWith('=')) return deliver(raw);
    stack.add(id);
    const frame: EvaluationFrame = {
      dependencies: new Map(),
      directDependencies: new Set(),
      ranges: new Map(),
    };
    frames.push(frame);
    counters.formulaEvaluations++;
    const initialDepthLimitGeneration = depthLimitGeneration;
    let value: Scalar = null;
    let error: string | undefined;
    try {
      let ast = parsed.get(raw);
      if (!ast) {
        ast = new Parser(tokenize(raw.slice(1))).parse();
        // Editing a cell repeatedly must not retain every historical formula.
        // FIFO eviction changes only parsing work, never a calculated result.
        if (parsed.size >= MAX_PARSED_EXPRESSIONS) {
          const oldest = parsed.keys().next().value;
          if (oldest !== undefined) parsed.delete(oldest);
        }
        parsed.set(raw, ast);
      }
      value = scalar(evaluate(ast, sheet));
      if (typeof value === 'string') boundedText(value);
    } catch (caught) {
      if (!(caught instanceof FormulaError)) throw caught;
      error = caught.code;
    } finally {
      frames.pop();
      stack.delete(id);
    }
    // A depth-limit failure depends on the current root/stack, unlike a normal
    // formula error. Do not poison a valid tail formula with a root's limit.
    if (initialDepthLimitGeneration === depthLimitGeneration) {
      storeEntry(id, {
        raw: currentRaw,
        value,
        error,
        dependencies: [...frame.dependencies.values()],
        directDependencies: [...frame.directDependencies],
        ranges: [...frame.ranges.values()],
      });
    }
    return deliver(value, error);
  };
  const evaluate = (node: Node, sheet: Sheet, arrayArithmetic = false): Result => {
    // Validate when evaluated, not while parsing: unused IF/IFERROR branches
    // must stay lazy, while evaluated overflow cannot become a value or text.
    if (node.kind === 'literal')
      return typeof node.value === 'number' ? finite(node.value) : node.value;
    if (node.kind === 'error') return fail(node.code);
    if (node.kind === 'ref') return read(resolveSheet(node.sheet, sheet), node.key);
    if (node.kind === 'range') {
      const a = parseCellKey(node.start.key)!;
      const b = parseCellKey(node.end.key)!;
      const [r0, r1] = [Math.min(a.row, b.row), Math.max(a.row, b.row)];
      const [c0, c1] = [Math.min(a.col, b.col), Math.max(a.col, b.col)];
      if ((r1 - r0 + 1) * (c1 - c0 + 1) > MAX_RANGE_CELLS) fail('#NUM!');
      const source = resolveSheet(node.start.sheet, sheet);
      const frame = frames[frames.length - 1];
      if (frame) {
        const range = { sheetId: source.id, firstRow: r0, lastRow: r1, firstCol: c0, lastCol: c1 };
        frame.ranges.set(JSON.stringify(range), range);
      }
      return {
        rows: Array.from({ length: r1 - r0 + 1 }, (_, r) =>
          Array.from({ length: c1 - c0 + 1 }, (_, c) =>
            read(source, cellKey(r + r0, c + c0), 'range'),
          ),
        ),
      };
    }
    if (node.kind === 'unary') {
      const source = evaluate(node.child, sheet, arrayArithmetic);
      const apply = (sourceValue: Result): number => {
        const value = number(sourceValue);
        return finite(node.op === '-' ? -value : node.op === '%' ? value / 100 : value);
      };
      return arrayArithmetic && isMatrix(source)
        ? { rows: source.rows.map((row) => row.map(apply)) }
        : apply(source);
    }
    if (node.kind === 'binary') {
      const a = evaluate(node.left, sheet, arrayArithmetic);
      const b = evaluate(node.right, sheet, arrayArithmetic);
      const apply = (left: Scalar, right: Scalar): Scalar => {
        if (node.op === '&') return appendText(stringify(left), stringify(right));
        if (['=', '<>', '!=', '<', '>', '<=', '>='].includes(node.op)) {
          const c = compare(left, right);
          return node.op === '='
            ? c === 0
            : node.op === '<>' || node.op === '!='
              ? c !== 0
              : node.op === '<'
                ? c < 0
                : node.op === '>'
                  ? c > 0
                  : node.op === '<='
                    ? c <= 0
                    : c >= 0;
        }
        const x = number(left);
        const y = number(right);
        if (node.op === '/' && y === 0) fail('#DIV/0!');
        return finite(
          node.op === '+'
            ? x + y
            : node.op === '-'
              ? x - y
              : node.op === '*'
                ? x * y
                : node.op === '/'
                  ? x / y
                  : x ** y,
        );
      };
      if (!arrayArithmetic || (!isMatrix(a) && !isMatrix(b))) return apply(scalar(a), scalar(b));
      const [rows, cols] = isMatrix(a) ? shape(a) : shape(b);
      if (isMatrix(a) && isMatrix(b) && !sameShape(a, b)) fail('#VALUE!');
      const at = (value: Result, row: number, col: number): Scalar =>
        isMatrix(value) ? value.rows[row][col] : value;
      return {
        rows: Array.from({ length: rows }, (_, row) =>
          Array.from({ length: cols }, (_, col) => apply(at(a, row, col), at(b, row, col))),
        ),
      };
    }
    const args = node.args;
    const get = (index: number) => (args[index] ? evaluate(args[index], sheet) : null);
    // Selection functions inspect range geometry before reading its values.
    // Register the full range for invalidation, but evaluate only selected cells.
    const grid = (arg: Node) => {
      if (arg.kind === 'range') {
        const a = parseCellKey(arg.start.key)!,
          b = parseCellKey(arg.end.key)!;
        const firstRow = Math.min(a.row, b.row),
          firstCol = Math.min(a.col, b.col);
        const rows = Math.abs(a.row - b.row) + 1,
          cols = Math.abs(a.col - b.col) + 1;
        if (rows * cols > MAX_RANGE_CELLS) fail('#NUM!');
        const source = resolveSheet(arg.start.sheet, sheet);
        const frame = frames[frames.length - 1];
        const range = {
          sheetId: source.id,
          firstRow,
          lastRow: firstRow + rows - 1,
          firstCol,
          lastCol: firstCol + cols - 1,
        };
        frame?.ranges.set(JSON.stringify(range), range);
        return {
          rows,
          cols,
          at: (r: number, c: number) => read(source, cellKey(firstRow + r, firstCol + c), 'range'),
        };
      }
      const value = evaluate(arg, sheet);
      const [rows, cols] = shape(value);
      return {
        rows,
        cols,
        at: (r: number, c: number) => (isMatrix(value) ? value.rows[r][c] : value),
      };
    };
    const count = (min: number, max = min) => {
      if (args.length < min || args.length > max) fail();
    };
    switch (node.name) {
      case 'NPV': {
        count(2, 255);
        const rate = number(get(0));
        if (rate === -1) fail('#DIV/0!');
        if (rate < -1) fail('#NUM!');
        const logarithm = Math.log1p(rate);
        let period = 0,
          visited = 0,
          sum = 0,
          correction = 0;
        const add = (cash: number) => {
          period++;
          const discount = Math.exp(-period * logarithm);
          // Avoid 0 * Infinity and recover representable products when the
          // discount factor alone overflows or underflows.
          const term =
            cash === 0
              ? 0
              : finite(
                  Number.isFinite(discount) && discount !== 0
                    ? cash * discount
                    : Math.sign(cash) * Math.exp(Math.log(Math.abs(cash)) - period * logarithm),
                );
          const next = finite(sum + term);
          correction = finite(
            correction + (Math.abs(sum) >= Math.abs(term) ? sum - next + term : term - next + sum),
          );
          sum = next;
        };
        for (let index = 1; index < args.length; index++) {
          const value = get(index);
          const referenced = args[index].kind === 'ref' || isMatrix(value);
          for (const item of flatten([value])) {
            if (++visited > 100_000) fail('#NUM!');
            // Nonnumeric reference members neither contribute nor consume a period.
            // A stored zero does consume a period.
            if (referenced) {
              if (typeof item === 'number') add(item);
            } else add(number(item));
          }
        }
        return finite(sum + correction) || 0;
      }
      case 'IRR': {
        count(1, 255);
        const rangeWithGuess = args.length === 2 && args[0].kind === 'range';
        const referencedValues =
          rangeWithGuess ||
          (args.length === 1 && (args[0].kind === 'range' || args[0].kind === 'ref'));
        const values = rangeWithGuess
          ? flatten([evaluate(args[0], sheet)])
          : flatten(args.map((arg) => evaluate(arg, sheet)));
        if (values.length < 2 || values.length > 100_000) fail('#NUM!');
        const cashFlows: number[] = [];
        for (const value of values) {
          if (typeof value === 'number') cashFlows.push(finite(value));
          else if (value !== null && !referencedValues) {
            // Text and booleans inside a referenced range are ignored, while
            // direct arguments follow normal numeric conversion rules.
            if (typeof value === 'boolean') cashFlows.push(value ? 1 : 0);
            else if (typeof value === 'string' && value.trim() !== '')
              cashFlows.push(number(value));
          }
        }
        if (
          cashFlows.length < 2 ||
          !cashFlows.some((value) => value > 0) ||
          !cashFlows.some((value) => value < 0)
        )
          fail('#NUM!');
        const guess = rangeWithGuess ? number(get(1)) : 0.1;
        if (guess <= -1) fail('#NUM!');
        const scale = Math.max(1, ...cashFlows.map((value) => Math.abs(value)));
        return solveFinancialRate(
          (rate) => {
            if (rate <= -1) return NaN;
            let total = 0;
            for (let index = 0; index < cashFlows.length; index++) {
              const discount = Math.exp(index * Math.log1p(rate));
              if (!Number.isFinite(discount) || discount === 0)
                return Math.sign(cashFlows[index]) * Infinity;
              total += cashFlows[index] / discount;
            }
            return total;
          },
          guess,
          scale,
        );
      }
      case 'RATE': {
        count(3, 6);
        const periods = number(get(0));
        const payment = number(get(1));
        const present = number(get(2));
        const future = args.length >= 4 ? number(get(3)) : 0;
        const when = args.length >= 5 ? number(get(4)) : 0;
        const guess = args.length >= 6 ? number(get(5)) : 0.1;
        if (periods <= 0 || (when !== 0 && when !== 1) || guess <= -1) fail('#NUM!');
        const scale = Math.max(1, Math.abs(payment), Math.abs(present), Math.abs(future));
        return solveFinancialRate(
          (rate) => {
            if (rate <= -1) return NaN;
            const exponent = periods * Math.log1p(rate);
            const growth = Math.exp(exponent);
            const annuity = rate === 0 ? periods : Math.expm1(exponent) / rate;
            return present * growth + payment * (1 + rate * when) * annuity + future;
          },
          guess,
          scale,
        );
      }
      case 'NPER': {
        count(3, 5);
        const rate = number(get(0));
        const payment = number(get(1));
        const present = number(get(2));
        const future = args.length >= 4 ? number(get(3)) : 0;
        const when = args.length >= 5 ? number(get(4)) : 0;
        if (rate <= -1 || (when !== 0 && when !== 1)) fail('#NUM!');
        // Normalize amounts before adding/multiplying to keep finite cash
        // flows near Number.MAX_VALUE from overflowing intermediate terms.
        const scale = Math.max(Math.abs(payment), Math.abs(present), Math.abs(future));
        if (scale === 0) fail('#DIV/0!');
        const pmt = payment / scale,
          pv = present / scale,
          fv = future / scale;
        if (rate === 0) {
          if (pmt === 0) fail('#DIV/0!');
          const result = finite(-(pv + fv) / pmt);
          if (result < 0) fail('#NUM!');
          return result || 0;
        }
        const rateScale = Math.max(1, Math.abs(rate));
        const r = rate / rateScale;
        const annuity = pmt * (1 / rateScale + r * when);
        const numerator = annuity - fv * r;
        const denominator = annuity + pv * r;
        if (numerator === 0 && denominator === 0) fail('#DIV/0!');
        if (numerator === 0 || denominator === 0 || Math.sign(numerator) !== Math.sign(denominator))
          fail('#NUM!');
        const delta = (-(pv + fv) * r) / denominator;
        // log1p preserves periods at tiny interest rates; logarithms of the
        // separate magnitudes avoid overflowing a very large quotient.
        const logarithm =
          Math.abs(delta) <= 0.5
            ? Math.log1p(delta)
            : Math.log(Math.abs(numerator)) - Math.log(Math.abs(denominator));
        const result = finite(logarithm / Math.log1p(rate));
        if (result < 0) fail('#NUM!');
        return result || 0;
      }
      case 'PMT':
      case 'PV':
      case 'FV': {
        count(3, 5);
        const rate = number(get(0));
        const periods = number(get(1));
        const amount = number(get(2));
        const terminal = args.length >= 4 ? number(get(3)) : 0;
        const when = args.length >= 5 ? number(get(4)) : 0;
        // Explicit supported domain: periodic rates above -100%, nonnegative
        // periods, and end/beginning payments. No implicit compounding schedule.
        if (rate <= -1 || periods < 0 || (when !== 0 && when !== 1)) fail('#NUM!');
        const exponent = periods * Math.log1p(rate);
        const growth = finite(Math.exp(exponent));
        const annuity = finite(rate === 0 ? periods : Math.expm1(exponent) / rate);
        const paymentFactor = finite((1 + rate * when) * annuity);
        if (node.name === 'FV') return finite(-(terminal * growth + amount * paymentFactor)) || 0;
        if (node.name === 'PV') {
          if (growth === 0) fail('#NUM!');
          return finite(-(terminal + amount * paymentFactor) / growth) || 0;
        }
        if (paymentFactor === 0) fail('#DIV/0!');
        return finite(-(amount * growth + terminal) / paymentFactor) || 0;
      }
      case 'IF':
        count(2, 3);
        return truthy(get(0)) ? get(1) : args.length === 3 ? get(2) : false;
      case 'AND':
      case 'OR': {
        count(1, 255);
        // Evaluate all arguments first: AND/OR propagate errors even when an
        // earlier argument already determines the logical outcome.
        const values = args.map((arg) => ({ arg, value: evaluate(arg, sheet) }));
        const logical: boolean[] = [];
        for (const { arg, value } of values) {
          if (isMatrix(value) || arg.kind === 'ref') {
            for (const item of flatten([value])) {
              if (typeof item === 'number' || typeof item === 'boolean') logical.push(truthy(item));
            }
          } else logical.push(truthy(value));
        }
        if (!logical.length) fail('#VALUE!');
        return node.name === 'AND' ? logical.every(Boolean) : logical.some(Boolean);
      }
      case 'NOT':
        count(1);
        return !truthy(get(0));
      case 'IFERROR':
        count(2);
        try {
          return get(0);
        } catch (error) {
          if (error instanceof FormulaError) return get(1);
          throw error;
        }
      case 'TODAY':
        count(0);
        {
          const now = new Date();
          return (
            Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000) +
            25569
          );
        }
      case 'ROUND':
        count(2);
        return roundTo(number(get(0)), Math.trunc(number(get(1))), 'round');
      case 'ROUNDUP':
        count(2);
        return roundTo(number(get(0)), Math.trunc(number(get(1))), 'up');
      case 'ROUNDDOWN':
        count(2);
        return roundTo(number(get(0)), Math.trunc(number(get(1))), 'down');
      case 'MOD': {
        count(2);
        const dividend = number(get(0));
        const divisor = number(get(1));
        if (divisor === 0) fail('#DIV/0!');
        // JavaScript's `%` keeps the sign of the dividend. Excel's MOD keeps
        // the sign of the divisor, so use the mathematical floor definition.
        return finite(dividend - divisor * Math.floor(dividend / divisor));
      }
      case 'INT':
        count(1);
        return finite(Math.floor(number(get(0))));
      case 'ABS':
        count(1);
        return Math.abs(number(get(0)));
      case 'LEN':
        count(1);
        return stringify(get(0)).length;
      case 'TRIM':
        count(1);
        // Excel TRIM operates on ASCII spaces, not all Unicode whitespace.
        return stringify(get(0))
          .replace(/^ +| +$/g, '')
          .replace(/ {2,}/g, ' ');
      case 'CLEAN':
        count(1);
        return stringify(get(0)).replace(/[\u0000-\u001f]/g, '');
      case 'LEFT':
      case 'RIGHT': {
        count(1, 2);
        const text = stringify(get(0));
        const rawLength = args.length === 2 ? number(get(1)) : 1;
        if (rawLength < 0) fail('#VALUE!');
        const length = Math.min(text.length, Math.trunc(rawLength));
        return node.name === 'LEFT' ? text.slice(0, length) : text.slice(text.length - length);
      }
      case 'MID': {
        count(3);
        const text = stringify(get(0));
        const start = Math.trunc(number(get(1)));
        const rawLength = number(get(2));
        if (start < 1 || rawLength < 0) fail('#VALUE!');
        if (start > text.length) return '';
        return text.slice(start - 1, start - 1 + Math.min(text.length, Math.trunc(rawLength)));
      }
      case 'FIND': {
        count(2, 3);
        const needle = stringify(get(0));
        const text = stringify(get(1));
        const start = args.length === 3 ? Math.trunc(number(get(2))) : 1;
        if (start < 1 || start > text.length) fail('#VALUE!');
        const found = text.indexOf(needle, start - 1);
        if (found < 0) fail('#VALUE!');
        return found + 1;
      }
      case 'REPLACE': {
        count(4);
        const text = stringify(get(0));
        const start = Math.trunc(number(get(1)));
        const rawLength = number(get(2));
        const replacement = stringify(get(3));
        if (start < 1 || rawLength < 0) fail('#VALUE!');
        const offset = Math.min(start - 1, text.length);
        return appendText(
          appendText(text.slice(0, offset), replacement),
          text.slice(offset + Math.min(text.length, Math.trunc(rawLength))),
        );
      }
      case 'SUBSTITUTE': {
        count(3, 4);
        const text = stringify(get(0));
        const needle = stringify(get(1));
        const replacement = stringify(get(2));
        const instance = args.length === 4 ? Math.trunc(number(get(3))) : undefined;
        if (instance !== undefined && instance < 1) fail('#VALUE!');
        if (!needle) return boundedText(text);
        let result = '',
          cursor = 0,
          occurrence = 0;
        while (cursor < text.length) {
          const found = text.indexOf(needle, cursor);
          if (found < 0) break;
          occurrence++;
          result = appendText(result, text.slice(cursor, found));
          result = appendText(
            result,
            instance === undefined || occurrence === instance ? replacement : needle,
          );
          cursor = found + needle.length;
          if (occurrence === instance) break;
        }
        return appendText(result, text.slice(cursor));
      }
      case 'UPPER':
        count(1);
        return boundedText(stringify(get(0)).toUpperCase());
      case 'LOWER':
        count(1);
        return boundedText(stringify(get(0)).toLowerCase());
      case 'CONCAT':
      case 'CONCATENATE': {
        count(1, 255);
        let result = '';
        // Evaluate one argument at a time rather than retaining every range.
        for (const arg of args) {
          const value = evaluate(arg, sheet);
          if (isMatrix(value)) {
            for (const row of value.rows)
              for (const member of row) result = appendText(result, stringify(member));
          } else result = appendText(result, stringify(value));
        }
        return result;
      }
      case 'SUMIF':
      case 'COUNTIF': {
        count(2, node.name === 'SUMIF' ? 3 : 2);
        const source = flatten([get(0)]);
        const matches = criterion(scalar(get(1)));
        const sums = args.length === 3 ? flatten([get(2)]) : source;
        if (sums.length !== source.length) fail();
        return source.reduce<number>(
          (total, value, i) =>
            total +
            (matches(value)
              ? node.name === 'COUNTIF'
                ? 1
                : typeof sums[i] === 'number'
                  ? (sums[i] as number)
                  : 0
              : 0),
          0,
        );
      }
      case 'SUMIFS':
      case 'COUNTIFS': {
        const minimum = node.name === 'SUMIFS' ? 3 : 2;
        if (args.length < minimum || args.length > 255) fail('#VALUE!');
        const offset = node.name === 'SUMIFS' ? 1 : 0;
        if ((args.length - offset) % 2 !== 0) fail('#VALUE!');
        const targetResult = get(0);
        const target = flatten([targetResult]);
        const criteriaBase = node.name === 'SUMIFS' ? 1 : 0;
        const pairs: Array<{ range: Scalar[]; matches: (value: Scalar) => boolean }> = [];
        for (let i = criteriaBase; i < args.length; i += 2) {
          const rangeResult = evaluate(args[i], sheet);
          if (!sameShape(rangeResult, targetResult)) fail('#VALUE!');
          const range = flatten([rangeResult]);
          pairs.push({ range, matches: criterion(scalar(evaluate(args[i + 1], sheet))) });
        }
        let total = 0;
        for (let i = 0; i < target.length; i++) {
          if (!pairs.every(({ range, matches }) => matches(range[i]))) continue;
          if (node.name === 'COUNTIFS') total++;
          else {
            const value = target[i];
            if (typeof value === 'number') total += value;
          }
        }
        return total;
      }
      case 'SUMPRODUCT': {
        count(1, 255);
        // Only SUMPRODUCT opts its argument expressions into array arithmetic.
        // Ordinary formulas keep their established scalar reference semantics.
        const values = args.map((arg) => evaluate(arg, sheet, true));
        const matrices = values.filter(isMatrix);
        // Keep the supported surface intentionally explicit: arrays must have
        // one common two-dimensional shape. Scalar broadcasting is rejected
        // instead of silently producing a different result from Excel.
        if (matrices.length > 0 && matrices.length !== values.length) fail('#VALUE!');
        const numeric = (value: Scalar): number => (typeof value === 'number' ? value : 0);
        if (matrices.length === 0) {
          return finite(
            values.reduce<number>((product, value) => product * numeric(scalar(value)), 1),
          );
        }
        const [rows, cols] = shape(matrices[0]);
        if (rows * cols > MAX_RANGE_CELLS) fail('#NUM!');
        for (const value of matrices) {
          if (!sameShape(value, matrices[0])) fail('#VALUE!');
        }
        let total = 0;
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            let product = 1;
            for (const value of matrices) {
              product *= numeric(value.rows[row][col]);
              if (!Number.isFinite(product)) fail('#NUM!');
            }
            total += product;
            if (!Number.isFinite(total)) fail('#NUM!');
          }
        }
        return total;
      }
      case 'VLOOKUP': {
        count(3, 4);
        const lookup = scalar(get(0));
        const table = grid(args[1]);
        const column = Math.trunc(number(get(2)));
        if (column < 1) fail();
        if (column > table.cols) fail('#REF!');
        const approximate = args.length < 4 || number(get(3)) !== 0;
        const matches =
          !approximate && typeof lookup === 'string' && /[?*~]/.test(lookup)
            ? wildcardMatch(lookup)
            : undefined;
        let found = -1;
        for (let row = 0; row < table.rows; row++) {
          const candidate = table.at(row, 0);
          if (matches) {
            if (matches(candidate)) return table.at(row, column - 1);
            continue;
          }
          const c = compare(candidate, lookup);
          if (c === 0) return table.at(row, column - 1);
          if (approximate && c < 0) found = row;
        }
        return found >= 0 ? table.at(found, column - 1) : fail('#N/A');
      }
      case 'INDEX': {
        count(2, 3);
        const source = grid(args[0]);
        const position = Math.trunc(number(get(1)));
        const horizontal = args.length === 2 && source.rows === 1;
        const row = horizontal ? 1 : position;
        const col = args.length === 3 ? Math.trunc(number(get(2))) : horizontal ? position : 1;
        if (row < 1 || col < 1 || row > source.rows || col > source.cols) fail('#REF!');
        return source.at(row - 1, col - 1) ?? null;
      }
      case 'MATCH': {
        count(2, 3);
        const lookup = scalar(get(0));
        const source = vector(get(1));
        const mode = args.length === 3 ? Math.trunc(number(get(2))) : 1;
        if (![1, 0, -1].includes(mode)) fail('#N/A');
        if (mode === 0) {
          const matches =
            typeof lookup === 'string'
              ? wildcardMatch(lookup)
              : (value: Scalar) => compare(value, lookup) === 0;
          const index = source.findIndex(matches);
          return index < 0 ? fail('#N/A') : index + 1;
        }
        let found = -1;
        for (let i = 0; i < source.length; i++) {
          const c = compare(source[i], lookup);
          if ((mode === 1 && c <= 0) || (mode === -1 && c >= 0)) found = i;
        }
        return found < 0 ? fail('#N/A') : found + 1;
      }
      case 'XLOOKUP': {
        count(3, 6);
        const lookup = scalar(get(0));
        const lookupResult = grid(args[1]);
        const returnResult = grid(args[2]);
        const { rows: lookupRows, cols: lookupCols } = lookupResult;
        if (lookupRows !== 1 && lookupCols !== 1) fail('#VALUE!');
        const length = lookupRows * lookupCols;
        const valueAt = (index: number) =>
          lookupResult.at(lookupRows === 1 ? 0 : index, lookupRows === 1 ? index : 0);
        if (lookupRows !== returnResult.rows || lookupCols !== returnResult.cols) fail('#VALUE!');
        const mode = args.length >= 5 ? number(get(4)) : 0;
        const searchMode = args.length >= 6 ? number(get(5)) : 1;
        if (![0, -1, 1, 2].includes(mode) || ![1, -1].includes(searchMode)) fail('#VALUE!');
        const matches =
          mode === 2 && typeof lookup === 'string' ? wildcardMatch(lookup) : undefined;
        let index = -1;
        let nearest = -1;
        for (let step = 0; step < length; step++) {
          const i = searchMode === 1 ? step : length - 1 - step;
          const value = valueAt(i);
          if (matches) {
            if (matches(value)) {
              index = i;
              break;
            }
            continue;
          }
          const comparison = compare(value, lookup);
          if (comparison === 0) {
            index = i;
            break;
          }
          if ((mode === 1 && comparison > 0) || (mode === -1 && comparison < 0)) {
            if (
              nearest < 0 ||
              (mode === 1
                ? compare(value, valueAt(nearest)) < 0
                : compare(value, valueAt(nearest)) > 0)
            )
              nearest = i;
          }
        }
        if (index < 0) index = nearest;
        // Missing-value expressions may contain errors or expensive formulas.
        // Excel evaluates them only when no lookup candidate exists.
        return index < 0
          ? args.length >= 4
            ? get(3)
            : fail('#N/A')
          : (returnResult.at(lookupRows === 1 ? 0 : index, lookupRows === 1 ? index : 0) ?? null);
      }
      case 'DATE': {
        count(3);
        let year = Math.trunc(number(get(0)));
        const month = Math.trunc(number(get(1)));
        const day = Math.trunc(number(get(2)));
        if (year < 0 || year > 9999) fail('#NUM!');
        if (year < 1900) year += 1900;
        const first = new Date(Date.UTC(year, month - 1, 1));
        return validSerial(utcSerial(first.getTime()) + day - 1);
      }
      case 'DATEVALUE':
        count(1);
        return Math.floor(dateSerial(get(0)));
      case 'YEAR':
      case 'MONTH':
      case 'DAY': {
        count(1);
        const date = dateParts(dateSerial(get(0)));
        return node.name === 'YEAR' ? date.year : node.name === 'MONTH' ? date.month : date.day;
      }
      case 'DAYS':
        count(2);
        return Math.floor(dateSerial(get(0))) - Math.floor(dateSerial(get(1)));
      case 'EOMONTH': {
        count(2);
        const base = dateParts(dateSerial(get(0)));
        const months = Math.trunc(number(get(1)));
        const nextMonth = Date.UTC(base.year, base.month + months, 1);
        return validSerial(utcSerial(nextMonth) - 1);
      }
      case 'SUM':
      case 'AVERAGE':
      case 'MIN':
      case 'MAX':
      case 'COUNT':
      case 'COUNTA': {
        const values = flatten(args.map((arg) => evaluate(arg, sheet)));
        if (node.name === 'COUNTA') return values.filter((v) => v !== null).length;
        const numbers = values.filter((v): v is number => typeof v === 'number');
        if (node.name === 'COUNT') return numbers.length;
        if (node.name === 'AVERAGE' && !numbers.length) fail('#DIV/0!');
        if (node.name === 'MIN')
          return numbers.length ? numbers.reduce((a, b) => Math.min(a, b)) : 0;
        if (node.name === 'MAX')
          return numbers.length ? numbers.reduce((a, b) => Math.max(a, b)) : 0;
        const sum = finite(numbers.reduce((a, b) => a + b, 0));
        return node.name === 'AVERAGE' ? sum / numbers.length : sum;
      }
      default:
        return fail('#NAME?');
    }
  };
  const result = (sheet: Sheet, key: string): EvaluationResult => {
    try {
      return { kind: 'value', value: read(sheet, key) ?? '' };
    } catch (error) {
      return { kind: 'error', error: error instanceof FormulaError ? error.code : '#ERROR!' };
    }
  };
  const evaluator = ((sheet: Sheet, key: string) => {
    // The hot Canvas/value path retains its scalar contract without allocating
    // an outcome wrapper for every visible cell.
    try {
      return read(sheet, key) ?? '';
    } catch (error) {
      return error instanceof FormulaError ? error.code : '#ERROR!';
    }
  }) as Evaluator;
  evaluator.result = result;
  evaluator.invalidate = (revision?: number) => {
    counters.invalidatedEntries += cache.size;
    cache.clear();
    dependents.clear();
    rangeDependents.clear();
    directEdges = 0;
    rangeEdges = 0;
    if (revision !== undefined) seenRevision = revision;
  };
  evaluator.invalidateCells = (sheetId: string, keys: readonly string[], revision?: number) => {
    const queue: Array<{ id: string; sheetId: string; key: string }> = [];
    const visited = new Set<string>();
    const enqueue = (sourceSheet: string, sourceKey: string) => {
      const canonical = canonicalKey(sourceKey);
      const id = cellId(sourceSheet, canonical);
      if (visited.has(id)) return;
      visited.add(id);
      queue.push({ id, sheetId: sourceSheet, key: canonical });
    };
    for (const key of keys) enqueue(sheetId, key);
    for (let at = 0; at < queue.length; at++) {
      const changed = queue[at];
      const readers = new Set(dependents.get(changed.id));
      const position = parseCellKey(changed.key);
      if (position) {
        const result = rangeDependents.get(changed.sheetId)?.query(position.row, position.col);
        if (result) {
          counters.rangeCandidateChecks += result.candidateChecks;
          counters.rangeNodeVisits += result.nodeVisits;
          for (const reader of result.owners) readers.add(reader);
        }
      }
      // Capture readers before removing outgoing edges, including circular ones.
      for (const reader of readers) {
        const [readerSheet, readerKey] = JSON.parse(reader) as [string, string];
        enqueue(readerSheet, readerKey);
      }
      if (cache.has(changed.id)) {
        counters.invalidatedEntries++;
        removeEntry(changed.id);
      }
    }
    if (revision !== undefined) seenRevision = revision;
  };
  evaluator.resetStats = () => {
    counters.formulaEvaluations = 0;
    counters.cacheHits = 0;
    counters.dependencyChecks = 0;
    counters.invalidatedEntries = 0;
    counters.rangeCandidateChecks = 0;
    counters.rangeNodeVisits = 0;
  };
  Object.defineProperties(evaluator, {
    revision: { enumerable: true, get: () => seenRevision },
    stats: {
      enumerable: true,
      get: (): Readonly<EvaluatorStats> => ({
        ...counters,
        cacheEntries: cache.size,
        directDependencyEdges: directEdges,
        rangeDependencyEdges: rangeEdges,
        rangeIndexNodes: rangeEdges,
        parsedExpressions: parsed.size,
      }),
    },
  });
  return evaluator;
}

export function evaluateCell(sheet: Sheet, key: string, workbook?: Workbook): CellValue {
  return createEvaluator(workbook)(sheet, key);
}

export function displayCell(cell: Cell | undefined, value?: CellValue): string {
  const v = value ?? cell?.value ?? '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return v;
  if (!Number.isFinite(v)) return '#NUM!';
  switch (cell?.style?.format) {
    case 'currency':
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        maximumFractionDigits: 0,
      }).format(v);
    case 'percent':
      return new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(
        v,
      );
    case 'number':
      return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v);
    case 'date': {
      try {
        const date = dateParts(v);
        return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
      } catch {
        return '#NUM!';
      }
    }
    default:
      return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12)));
  }
}
