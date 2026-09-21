import type { LuminaPersistence } from './persistence';
import { assertCommentRecords, assertRevisionRecords } from './auxiliary-records';

type RecoverySource = Pick<LuminaPersistence, 'loadWorkbooks' | 'loadComments' | 'loadRevisions'> &
  Partial<Pick<LuminaPersistence, 'readRecoveryStorage'>>;

/** Best-effort rescue: keep successful sections even when another store fails.
 * Does not explicitly flush/write; persistence reads may perform legacy migration. */
export async function collectRecoveryBackup(source: RecoverySource, storage: () => Storage) {
  const warnings: string[] = [];
  const legacy: Record<string, string | null> = Object.create(null);
  try {
    const local = storage();
    for (let index = 0; index < local.length; index++) {
      const key = local.key(index);
      if (!key?.startsWith('lumina.')) continue;
      try {
        legacy[key] = local.getItem(key);
        if (
          /^lumina\.v1\.(?:workbooks$|trash$|history\.|comments\.)/.test(key) &&
          legacy[key] !== null
        ) {
          try {
            const value: unknown = JSON.parse(legacy[key]!);
            if (!Array.isArray(value)) throw new Error('not a list');
            if (key.startsWith('lumina.v1.history.')) assertRevisionRecords(value);
            if (key.startsWith('lumina.v1.comments.')) assertCommentRecords(value);
          } catch {
            warnings.push(`旧版列表记录损坏，已保留原始内容：${key}`);
          }
        }
      } catch {
        warnings.push(`无法读取本地条目：${key}`);
      }
    }
  } catch {
    warnings.push('浏览器本地存储无法读取');
  }
  let workbooks: Awaited<ReturnType<RecoverySource['loadWorkbooks']>> = [];
  const damaged: {
    damagedWorkbookDirectory?: unknown;
    rawStorage?: Awaited<ReturnType<LuminaPersistence['readRecoveryStorage']>>;
  } = {};
  try {
    const loaded = await source.loadWorkbooks();
    if (Array.isArray(loaded)) {
      workbooks = loaded;
    } else {
      damaged.damagedWorkbookDirectory = loaded;
      warnings.push('工作簿目录不是列表，原始内容已保留在 damagedWorkbookDirectory');
    }
  } catch {
    warnings.push('工作簿存储无法读取；本文件不包含完整工作簿备份');
    if (source.readRecoveryStorage) {
      try {
        damaged.rawStorage = await source.readRecoveryStorage();
        warnings.push(...damaged.rawStorage.warnings);
        warnings.push('已保留原始快照和日志；原始快照未重放日志，可能缺少后续编辑。');
      } catch {
        warnings.push('原始存储救援读取失败，请保留浏览器数据。');
      }
    }
  }
  const records = [];
  for (const workbook of workbooks) {
    if (
      !workbook ||
      typeof workbook !== 'object' ||
      Array.isArray(workbook) ||
      typeof workbook.id !== 'string' ||
      !workbook.id
    ) {
      warnings.push(`工作簿目录条目 ${records.length + 1} 损坏，已保留原始内容`);
      records.push({ workbook, comments: null, revisions: null });
      continue;
    }
    const [comments, revisions] = await Promise.allSettled([
      Promise.resolve().then(() => source.loadComments(workbook.id)),
      Promise.resolve().then(() => source.loadRevisions(workbook.id)),
    ]);
    if (comments.status === 'rejected') warnings.push(`批注读取失败：${workbook.id}`);
    if (revisions.status === 'rejected') warnings.push(`历史版本读取失败：${workbook.id}`);
    if (comments.status === 'fulfilled') {
      try {
        assertCommentRecords(comments.value);
      } catch {
        warnings.push(`批注记录损坏，已保留原始内容：${workbook.id}`);
      }
    }
    if (revisions.status === 'fulfilled') {
      try {
        assertRevisionRecords(revisions.value);
      } catch {
        warnings.push(`历史版本记录损坏，已保留原始内容：${workbook.id}`);
      }
    }
    records.push({
      workbook,
      comments: comments.status === 'fulfilled' ? comments.value : null,
      revisions: revisions.status === 'fulfilled' ? revisions.value : null,
    });
  }
  return {
    format: 'lumina-recovery',
    version: 1,
    createdAt: new Date().toISOString(),
    complete: warnings.length === 0,
    warnings,
    records,
    legacy,
    ...damaged,
  };
}
