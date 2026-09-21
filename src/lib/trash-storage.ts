import type { Workbook } from './types';

/** Cooperating tabs serialize read/compare/write using an origin-scoped lock.
 * The fallback remains synchronous within this page, without cross-tab guarantees. */
export async function withTrashLock<T>(operation: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request)
    return navigator.locks.request('lumina.v1.trash', { mode: 'exclusive' }, operation);
  return operation();
}

/** Mutations must distinguish an empty recycle bin from unreadable/corrupt data. */
export function readCurrentTrash(): Workbook[] {
  const raw = localStorage.getItem('lumina.v1.trash');
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        typeof item.id !== 'string' ||
        !item.id ||
        typeof item.name !== 'string' ||
        !Array.isArray(item.sheets) ||
        typeof item.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(item.updatedAt)),
    )
  )
    throw new Error('回收站目录损坏');
  if (new Set(value.map((item) => item.id)).size !== value.length)
    throw new Error('回收站目录标识重复');
  return value;
}

export function assertTrashSource(current: Workbook[], source: Workbook): void {
  const matches = current.filter((item) => item.id === source.id);
  if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(source))
    throw new Error('回收站原件已变化，请刷新后重试');
}
