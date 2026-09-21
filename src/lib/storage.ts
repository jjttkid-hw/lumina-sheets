import type { Workbook, Revision, Comment } from './types';
const PREFIX = 'lumina.v1';
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}.${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeStored(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(`${PREFIX}.${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export const loadWorkbooks = () => readStored<Workbook[]>('workbooks', []);
export const saveWorkbooks = (books: Workbook[]) => writeStored('workbooks', books);
export const loadRevisions = (id: string) => readStored<Revision[]>(`history.${id}`, []);
export const saveRevisions = (id: string, revs: Revision[]) =>
  writeStored(`history.${id}`, revs.slice(0, 20));
export const loadComments = (id: string) => readStored<Comment[]>(`comments.${id}`, []);
export const saveComments = (id: string, comments: Comment[]) =>
  writeStored(`comments.${id}`, comments);
export function snapshotLink(workbook: Workbook): string {
  const bytes = new TextEncoder().encode(JSON.stringify(workbook));
  if (bytes.length > 60000) throw new Error('工作簿较大，请下载文件分享。');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${location.origin}${location.pathname}#snapshot=${encodeURIComponent(btoa(binary))}`;
}
export function readSnapshot(): Workbook | null {
  try {
    const raw = new URLSearchParams(location.hash.slice(1)).get('snapshot');
    if (!raw || raw.length > 100000) return null;
    const binary = atob(raw);
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(binary, (c) => c.charCodeAt(0)),
      ),
    );
  } catch {
    return null;
  }
}
