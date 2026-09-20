import { HEADER_HEIGHT, ROW_HEIGHT } from './geometry';

/**
 * Sparse row geometry in unscaled canvas pixels. `count` is the number of
 * displayed rows, including hidden rows; `row(index)` maps a display index to
 * its original sheet row. Hidden rows occupy zero pixels. Without a filtered
 * row list, storage and construction depend only on height/visibility metadata,
 * never on the sheet's logical row count.
 */
export class RowMetrics {
  readonly count: number;
  private readonly rowIndexes: readonly number[] | null;
  private readonly indexes: number[] = [];
  private readonly heights: number[] = [];
  private readonly adjustments: number[] = [0];
  private readonly hiddenRuns: Array<{ start: number; end: number }> = [];

  constructor(
    count: number,
    heights: Record<number, number> = {},
    hidden: number[] = [],
    rowIndexes?: number[] | null,
  ) {
    const logicalCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    this.rowIndexes = rowIndexes ? [...rowIndexes] : null;
    this.count = this.rowIndexes?.length ?? logicalCount;
    const hiddenRows = new Set(
      hidden.filter((row) => Number.isInteger(row) && row >= 0 && row < logicalCount),
    );
    const customHeights = new Map<number, number>();
    for (const [key, value] of Object.entries(heights)) {
      const row = Number(key);
      if (
        Number.isInteger(row) &&
        row >= 0 &&
        row < logicalCount &&
        Number.isFinite(value) &&
        value > 0
      )
        customHeights.set(row, Math.max(1, Math.min(600, value)));
    }
    const changed = new Map<number, number>();
    if (this.rowIndexes) {
      this.rowIndexes.forEach((row, index) => {
        const height = hiddenRows.has(row) ? 0 : (customHeights.get(row) ?? ROW_HEIGHT);
        if (height !== ROW_HEIGHT) changed.set(index, height);
      });
    } else {
      for (const [row, height] of customHeights)
        if (height !== ROW_HEIGHT) changed.set(row, height);
      for (const row of hiddenRows) changed.set(row, 0);
    }
    for (const [index, height] of [...changed].sort((a, b) => a[0] - b[0])) {
      this.indexes.push(index);
      this.heights.push(height);
      this.adjustments.push(this.adjustments.at(-1)! + height - ROW_HEIGHT);
      if (height === 0) {
        const previous = this.hiddenRuns.at(-1);
        if (previous && previous.end + 1 === index) previous.end = index;
        else this.hiddenRuns.push({ start: index, end: index });
      }
    }
  }

  /** Original sheet row, or -1 for a display index outside this view. */
  row(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return -1;
    return this.rowIndexes?.[index] ?? index;
  }

  /** Alias for callers that use the canvas geometry naming convention. */
  rowAt(index: number): number {
    return this.row(index);
  }

  /** Display index for an original row, or -1 when filtering excludes it. */
  indexOfRow(row: number): number {
    if (!Number.isInteger(row) || row < 0) return -1;
    const index = this.indexAtOrAfter(row);
    return this.row(index) === row ? index : -1;
  }

  /** Insertion index in the ascending filtered row list, including `count`. */
  indexAtOrAfter(row: number): number {
    if (!this.rowIndexes) return Math.max(0, Math.min(this.count, Math.ceil(row)));
    let low = 0,
      high = this.rowIndexes.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.rowIndexes[middle] < row) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private lowerBound(index: number): number {
    let low = 0,
      high = this.indexes.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.indexes[middle] < index) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /** Prefix height before a display row; index `count` returns the total. */
  offset(index: number): number {
    const boundary = Number.isNaN(index) ? 0 : Math.max(0, Math.min(this.count, Math.trunc(index)));
    return boundary * ROW_HEIGHT + this.adjustments[this.lowerBound(boundary)];
  }

  /** Height of a display row, or zero for a hidden/out-of-range row. */
  height(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return 0;
    const position = this.lowerBound(index);
    return this.indexes[position] === index ? this.heights[position] : ROW_HEIGHT;
  }

  /** Total visible row height, excluding the column header. */
  get total(): number {
    return this.offset(this.count);
  }

  /**
   * Visible row containing an offset. Exact boundaries select the next visible
   * row; offsets outside the view clamp to its first/last visible row. Empty or
   * entirely hidden views return -1.
   */
  at(offset: number): number {
    if (this.total <= 0) return -1;
    if (offset >= this.total) return this.nextVisible(this.count - 1, -1);
    const target = Number.isNaN(offset) ? 0 : Math.max(0, offset);
    let low = 0,
      high = this.count;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.offset(middle + 1) <= target) low = middle + 1;
      else high = middle;
    }
    return this.nextVisible(low);
  }

  /** Visible row at or beyond `index` in the chosen direction, or -1. */
  nextVisible(index: number, direction = 1): number {
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

  /**
   * Visible scrollable rows. `available` includes the header and frozen rows;
   * `frozen` is a display-row count. Frozen rows are rendered separately. An
   * empty body returns `{ first: -1, last: -1 }`.
   */
  visible(scroll: number, available: number, frozen = 0): { first: number; last: number } {
    const boundary = Math.max(0, Math.min(this.count, Math.trunc(frozen) || 0));
    const frozenHeight = this.offset(boundary);
    const bodyHeight =
      Math.max(0, Number.isFinite(available) ? available : 0) - HEADER_HEIGHT - frozenHeight;
    if (bodyHeight <= 0 || this.nextVisible(boundary) < 0) return { first: -1, last: -1 };
    const logicalScroll = Math.max(0, Number.isFinite(scroll) ? scroll : 0);
    const start = frozenHeight + logicalScroll;
    if (start >= this.total) return { first: -1, last: -1 };
    // The viewport includes the header and frozen pane. Only its remaining
    // pixels can contain scrollable rows.
    const end = start + bodyHeight;
    const first = this.at(start);
    const last = this.at(Math.max(start, end - 0.001));
    return { first, last };
  }

  /** Frozen rows use the same viewport bound, even when the entire sheet is frozen. */
  visibleFrozen(available: number, frozen: number): { first: number; last: number } {
    const boundary = Math.max(0, Math.min(this.count, Math.trunc(frozen) || 0));
    const pixels = Math.min(this.offset(boundary), Math.max(0, available - HEADER_HEIGHT));
    if (pixels <= 0) return { first: -1, last: -1 };
    const first = this.nextVisible(0);
    const last = Math.min(boundary - 1, this.at(pixels - 0.001));
    return first < 0 || first > last ? { first: -1, last: -1 } : { first, last };
  }
}
