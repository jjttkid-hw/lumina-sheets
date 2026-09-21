import { expect, it } from 'vitest';
import { assertCommentRecords, assertRevisionRecords } from '../src/lib/auxiliary-records';
import { createBlankWorkbook } from '../src/lib/seed';

const book = createBlankWorkbook();
const comment = {
  id: 'c',
  sheetId: book.sheets[0].id,
  cell: 'A1',
  text: 'note',
  resolved: false,
  createdAt: book.createdAt,
};
const revision = { id: 'r', name: 'snapshot', workbook: book, createdAt: book.createdAt };
it.each([
  [assertCommentRecords, comment],
  [assertRevisionRecords, revision],
] as const)(
  'rejects malformed metadata and duplicate IDs without changing source (%#)',
  (check, item) => {
    for (const value of [
      {},
      [null],
      [{ ...item, createdAt: 'bad date' }],
      [{ ...item, id: '' }],
      [item, structuredClone(item)],
    ]) {
      const before = structuredClone(value);
      expect(() => check(value)).toThrow();
      expect(value).toEqual(before);
    }
    expect(() => check([item])).not.toThrow();
  },
);
it('keeps damaged workbook contents available for explicit restore validation', () => {
  const point = structuredClone(revision);
  point.workbook.sheets[0].rowCount = 0;
  const before = structuredClone(point);
  expect(() => assertRevisionRecords([point])).not.toThrow();
  expect(point).toEqual(before);
});
it('rejects non-renderable comment text and missing revision workbook metadata', () => {
  expect(() => assertCommentRecords([{ ...comment, text: {} }])).toThrow();
  expect(() => assertRevisionRecords([{ ...revision, workbook: null }])).toThrow();
});
