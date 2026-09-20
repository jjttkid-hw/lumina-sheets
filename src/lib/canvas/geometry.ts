import type { CellRange } from '../types';

export const ROW_HEIGHT = 36;
export const HEADER_HEIGHT = 34;
export const ROW_LABEL_WIDTH = 44;
export const MAX_SCROLL_EXTENT = 8_000_000;
export const DEFAULT_WIDTHS = [96, 132, 112, 124, 124, 124, 96, 124, 106, 220];

/** Column positions are built once per width change; every hit test is logarithmic. */
export class ColumnMetrics {
  readonly offsets: Float64Array;
  private readonly hiddenRuns: Array<{ start: number; end: number }> = [];
  constructor(
    readonly count: number,
    widths: Record<number, number> = {},
    overrides: Record<number, number> = {},
    hidden: readonly number[] = [],
  ) {
    const hiddenColumns = new Set(
      hidden.filter((col) => Number.isInteger(col) && col >= 0 && col < count),
    );
    for (const col of [...hiddenColumns].sort((a, b) => a - b)) {
      const previous = this.hiddenRuns.at(-1);
      if (previous && previous.end + 1 === col) previous.end = col;
      else this.hiddenRuns.push({ start: col, end: col });
    }
    this.offsets = new Float64Array(count + 1);
    for (let col = 0; col < count; col++) {
      const width = overrides[col] ?? widths[col] ?? DEFAULT_WIDTHS[col] ?? 120;
      this.offsets[col + 1] =
        this.offsets[col] + (hiddenColumns.has(col) ? 0 : Math.max(32, Math.min(2000, width)));
    }
  }
  get total() {
    return this.offsets[this.count];
  }
  width(col: number) {
    return col >= 0 && col < this.count ? this.offsets[col + 1] - this.offsets[col] : 0;
  }
  at(offset: number) {
    if (this.total <= 0) return -1;
    if (offset >= this.total) return this.previousVisible(this.count - 1);
    let low = 0,
      high = this.count;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.offsets[middle + 1] <= offset) low = middle + 1;
      else high = middle;
    }
    return this.nextVisible(Math.min(this.count - 1, Math.max(0, low)));
  }
  visible(scroll: number, available: number) {
    if (this.total <= 0 || available <= 0) return { first: -1, last: -1 };
    const first = this.at(Math.max(0, scroll));
    return { first, last: this.at(Math.max(scroll, scroll + available - 0.001)) };
  }
  nextVisible(index: number, direction = 1) {
    if (!this.count || Number.isNaN(index)) return -1;
    const forward = direction >= 0;
    let candidate = forward
      ? Math.max(0, Math.ceil(index))
      : Math.min(this.count - 1, Math.floor(index));
    if (candidate < 0 || candidate >= this.count) return -1;
    let low = 0,
      high = this.hiddenRuns.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.hiddenRuns[middle].end < candidate) low = middle + 1;
      else high = middle;
    }
    const run = this.hiddenRuns[low];
    if (run && run.start <= candidate) candidate = forward ? run.end + 1 : run.start - 1;
    return candidate >= 0 && candidate < this.count ? candidate : -1;
  }
  previousVisible(index: number) {
    return this.nextVisible(index, -1);
  }
}

/** Native scroll ranges are capped below all major browsers' layout limits. */
export function scrollAxis(logicalSize: number, viewport: number) {
  const physicalSize = Math.max(viewport, Math.min(MAX_SCROLL_EXTENT, logicalSize));
  const logicalMax = Math.max(0, logicalSize - viewport);
  const physicalMax = Math.max(0, physicalSize - viewport);
  const ratio = physicalMax ? logicalMax / physicalMax : 1;
  return {
    physicalSize,
    logicalMax,
    ratio,
    toLogical: (position: number) => Math.max(0, Math.min(logicalMax, position * ratio)),
    toPhysical: (position: number) => Math.max(0, Math.min(physicalMax, position / ratio)),
  };
}

export function visibleRowWindow(count: number, frozen: number, scroll: number, available: number) {
  const first = Math.min(count, Math.max(frozen, frozen + Math.floor(scroll / ROW_HEIGHT)));
  const last = Math.min(count - 1, Math.ceil((scroll + available) / ROW_HEIGHT) - 1);
  return { first, last };
}

export function pixelSize(width: number, height: number, dpr: number) {
  const ratio = Math.max(1, Math.min(4, dpr || 1));
  return { width: Math.round(width * ratio), height: Math.round(height * ratio), ratio };
}

export interface MergeRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
interface MergeNode {
  rect: MergeRect;
  max: number;
  left?: MergeNode;
  right?: MergeNode;
}
/** Interval tree stores one rectangle per merge, including million-cell merges. */
export class MergeIndex {
  private root?: MergeNode;
  constructor(merges: CellRange[] = [], rowCount = 1_048_576, colCount = 16_384) {
    const rects = merges
      .map((merge) => ({
        top: Math.max(0, Math.min(merge.start.row, merge.end.row)),
        bottom: Math.min(rowCount - 1, Math.max(merge.start.row, merge.end.row)),
        left: Math.max(0, Math.min(merge.start.col, merge.end.col)),
        right: Math.min(colCount - 1, Math.max(merge.start.col, merge.end.col)),
      }))
      .filter((rect) => rect.bottom >= rect.top && rect.right >= rect.left)
      .sort((a, b) => a.top - b.top);
    const build = (start: number, end: number): MergeNode | undefined => {
      if (start >= end) return;
      const middle = (start + end) >>> 1;
      const left = build(start, middle),
        right = build(middle + 1, end),
        rect = rects[middle];
      return { rect, left, right, max: Math.max(rect.bottom, left?.max ?? -1, right?.max ?? -1) };
    };
    this.root = build(0, rects.length);
  }
  query(top: number, bottom: number, left = 0, right = 16_383): MergeRect[] {
    const matches: MergeRect[] = [];
    const visit = (node?: MergeNode) => {
      if (!node || node.max < top) return;
      visit(node.left);
      const rect = node.rect;
      if (rect.top > bottom) return;
      if (rect.bottom >= top && rect.right >= left && rect.left <= right) matches.push(rect);
      visit(node.right);
    };
    visit(this.root);
    return matches;
  }
  at(row: number, col: number) {
    return this.query(row, row, col, col)[0];
  }
}
