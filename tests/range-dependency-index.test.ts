import { describe, expect, it } from 'vitest';
import { RangeDependencyIndex, type DependencyRectangle } from '../src/lib/range-dependency-index';

const rectangle = (
  firstRow: number,
  lastRow = firstRow,
  firstCol = 0,
  lastCol = firstCol,
): DependencyRectangle => ({ firstRow, lastRow, firstCol, lastCol });
const hits = (range: DependencyRectangle, row: number, col: number) =>
  row >= range.firstRow && row <= range.lastRow && col >= range.firstCol && col <= range.lastCol;

describe('dynamic rectangle dependency index', () => {
  it('prunes ten thousand disjoint row and column ranges', () => {
    for (const axis of ['row', 'column']) {
      const index = new RangeDependencyIndex();
      for (let i = 0; i < 10_000; i++)
        index.add(
          String(i),
          axis === 'row' ? rectangle(i * 3, i * 3 + 1, 4, 5) : rectangle(4, 5, i * 3, i * 3 + 1),
        );
      const result = index.query(axis === 'row' ? 15_000 : 4, axis === 'row' ? 4 : 15_000);
      expect([...result.owners]).toEqual(['5000']);
      expect(result.candidateChecks).toBeLessThan(32);
      expect(result.nodeVisits).toBeLessThan(64);
      expect(index.nodeCount).toBe(10_000);
      expect(index.query(1_048_575, 16_383)).toMatchObject({ candidateChecks: 0, nodeVisits: 1 });
    }
  });

  it('keeps million-row rectangles constant-size and includes all boundaries', () => {
    const index = new RangeDependencyIndex();
    index.add('wide', rectangle(0, 1_048_575, 0, 16_383));
    expect(index.nodeCount).toBe(1);
    for (const [row, col] of [
      [0, 0],
      [0, 16_383],
      [1_048_575, 0],
      [1_048_575, 16_383],
    ])
      expect([...index.query(row, col).owners]).toEqual(['wide']);
    expect(index.query(1_048_576, 0).owners.size).toBe(0);
    expect(index.query(0, 16_384).owners.size).toBe(0);
    expect(index.query(-1, 0).owners.size).toBe(0);
  });

  it('reports linear candidate work for densely overlapping output and deduplicates owners', () => {
    const index = new RangeDependencyIndex();
    for (let i = 0; i < 1000; i++) index.add(`owner-${i}`, rectangle(0, 1_048_575, 0, 16_383));
    index.add('owner-0', rectangle(50, 100, 0, 10));
    const result = index.query(70, 4);
    expect(result.owners.size).toBe(1000);
    expect(result.candidateChecks).toBe(1001);
    expect(result.nodeVisits).toBe(1001);
    expect(index.removeOwner('owner-0')).toBe(2);
    expect(index.query(70, 4).owners.size).toBe(999);
  });

  it('releases owner ranges, handles clear, and does not reuse stale handles', () => {
    const index = new RangeDependencyIndex();
    const old = index.add('a', rectangle(0));
    index.add('a', rectangle(2));
    index.add('b', rectangle(3));
    expect(index.removeOwner('a')).toBe(2);
    expect(index.nodeCount).toBe(1);
    expect(index.remove(old)).toBe(false);
    expect(index.query(0, 0).owners.size).toBe(0);
    index.clear();
    index.add('c', rectangle(0));
    expect(index.remove(old)).toBe(false);
    expect([...index.query(0, 0).owners]).toEqual(['c']);
    index.clear();
    expect(index.size).toBe(0);
    expect(index.query(0, 0).nodeVisits).toBe(0);
  });

  it('matches a brute-force oracle during randomized insertions, removals and queries', () => {
    let seed = 419;
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };
    const index = new RangeDependencyIndex();
    const entries = new Map<number, { owner: string; range: DependencyRectangle }>();
    for (let step = 0; step < 2500; step++) {
      if (random(4) === 0 && entries.size) {
        const handle = [...entries.keys()][random(entries.size)];
        expect(index.remove(handle)).toBe(true);
        entries.delete(handle);
      } else {
        const row = random(300),
          col = random(100);
        const range = rectangle(row, row + random(40), col, col + random(20));
        const owner = `o${random(200)}`;
        entries.set(index.add(owner, range), { owner, range });
      }
      const row = random(350),
        col = random(130);
      const expected = [
        ...new Set(
          [...entries.values()]
            .filter((entry) => hits(entry.range, row, col))
            .map((entry) => entry.owner),
        ),
      ].sort();
      expect([...index.query(row, col).owners].sort()).toEqual(expected);
      expect(index.nodeCount).toBe(entries.size);
    }
    for (const handle of [...entries.keys()].reverse()) expect(index.remove(handle)).toBe(true);
    expect(index.size).toBe(0);
    expect(index.query(2, 2).nodeVisits).toBe(0);
  });

  it('rejects malformed bounds before inserting anything', () => {
    const index = new RangeDependencyIndex();
    expect(() => index.add('bad', rectangle(5, 4))).toThrow(RangeError);
    expect(() => index.add('bad', rectangle(-1))).toThrow(RangeError);
    expect(() => index.add('bad', rectangle(0.5))).toThrow(RangeError);
    expect(() => index.add('bad', rectangle(0, Infinity))).toThrow(RangeError);
    expect(index.size).toBe(0);
  });
});
