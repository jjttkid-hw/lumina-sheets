import type { Comment, Revision } from './types';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Validate display/edit metadata without rewriting stored recovery payloads. */
function list(value: unknown, valid: (item: Record<string, unknown>) => boolean) {
  if (!Array.isArray(value)) throw new Error('辅助记录必须为列表');
  const ids = new Set<string>();
  for (const item of value) {
    if (
      !record(item) ||
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id) ||
      !date(item.createdAt) ||
      !valid(item)
    )
      throw new Error('辅助记录损坏或标识重复');
    ids.add(item.id);
  }
}
export function assertCommentRecords(value: unknown): asserts value is Comment[] {
  list(
    value,
    (item) =>
      typeof item.sheetId === 'string' &&
      typeof item.cell === 'string' &&
      typeof item.text === 'string' &&
      typeof item.resolved === 'boolean',
  );
}
export function assertRevisionRecords(value: unknown): asserts value is Revision[] {
  // Full workbook validation belongs to restoreVersion; do not normalize or
  // silently discard an invalid recovery point merely to display its metadata.
  list(
    value,
    (item) =>
      typeof item.name === 'string' &&
      record(item.workbook) &&
      typeof item.workbook.id === 'string' &&
      Array.isArray(item.workbook.sheets),
  );
}
