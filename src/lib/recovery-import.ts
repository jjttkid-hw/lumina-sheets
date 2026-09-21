import { validateWorkbook } from './io';
import { independentWorkbookCopy, workbookCopyName } from './workbook-copy';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export interface RecoveryImport {
  partial: boolean;
  warningCount: number;
  directoryWarnings: string[];
  records: {
    name: string;
    workbook: unknown;
    source: '工作空间' | '旧版文档' | '回收站' | '历史版本' | '旧版历史' | '原始快照（未重放日志）';
    detail?: string;
  }[];
}
/** Only expose workbook snapshots. Legacy settings are never written back implicitly. */
export function readRecoveryImport(input: unknown): RecoveryImport | null {
  if (!object(input) || input.format !== 'lumina-recovery') return null;
  if (input.version !== 1 || !Array.isArray(input.records) || input.records.length > 1000)
    throw new Error('恢复备份版本或工作簿目录无效（最多 1,000 本）。');
  const records: RecoveryImport['records'] = [];
  const directoryWarnings: string[] = [];
  const append = (snapshots: unknown[], source: RecoveryImport['records'][number]['source']) => {
    if (records.length + snapshots.length > 1000)
      throw new Error('恢复备份工作簿目录无效（所有来源合计最多 1,000 本）。');
    for (const workbook of snapshots) {
      records.push({
        name:
          object(workbook) && typeof workbook.name === 'string'
            ? workbook.name.slice(0, 200)
            : `工作簿 ${records.length + 1}`,
        workbook,
        source,
      });
    }
  };
  const appendHistory = (value: unknown, source: '历史版本' | '旧版历史', label: string) => {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      directoryWarnings.push(`${label}无法列出历史版本，请保留原备份文件。`);
      return;
    }
    // Validate only the selected workbook; a damaged revision must not hide others.
    for (const revision of value) {
      append([object(revision) ? revision.workbook : undefined], source);
      const title =
        object(revision) && typeof revision.name === 'string'
          ? revision.name.slice(0, 200)
          : '未命名版本';
      const date =
        object(revision) &&
        typeof revision.createdAt === 'string' &&
        Number.isFinite(Date.parse(revision.createdAt))
          ? new Date(revision.createdAt).toISOString()
          : '时间未知';
      records[records.length - 1].detail = `${title} · ${date}`;
    }
  };
  append(
    input.records.map((record) => (object(record) ? record.workbook : undefined)),
    '工作空间',
  );
  if (input.legacy !== undefined && !object(input.legacy)) {
    directoryWarnings.push('旧版存储目录损坏，请保留原备份文件。');
  } else if (object(input.legacy)) {
    for (const [key, source] of [
      ['lumina.v1.workbooks', '旧版文档'],
      ['lumina.v1.trash', '回收站'],
    ] as const) {
      const raw = input.legacy[key];
      if (raw === undefined || raw === null) continue;
      let snapshots: unknown;
      try {
        if (typeof raw !== 'string') throw new Error('not raw JSON');
        snapshots = JSON.parse(raw);
        if (!Array.isArray(snapshots)) throw new Error('not a list');
      } catch {
        directoryWarnings.push(`${source}列表损坏，无法列出；请保留原备份文件。`);
        continue;
      }
      // Keep separate versions of the same ID, including invalid entries for explicit validation.
      append(snapshots as unknown[], source);
    }
  }
  for (let i = 0; i < input.records.length; i++) {
    const record = input.records[i];
    if (object(record)) appendHistory(record.revisions, '历史版本', `工作空间条目 ${i + 1}`);
  }
  if (object(input.legacy)) {
    for (const [key, raw] of Object.entries(input.legacy)) {
      if (!key.startsWith('lumina.v1.history.')) continue;
      let revisions: unknown;
      try {
        if (typeof raw !== 'string') throw new Error('not raw JSON');
        revisions = JSON.parse(raw);
      } catch {
        directoryWarnings.push('旧版历史列表损坏，无法列出；请保留原备份文件。');
        continue;
      }
      appendHistory(revisions, '旧版历史', '旧版存储');
    }
  }
  if (input.rawStorage !== undefined) {
    const raw = input.rawStorage;
    if (
      object(raw) &&
      object(raw.stores) &&
      Array.isArray(raw.stores.workbooks) &&
      (raw.backend === 'memory' || raw.backend === 'indexeddb')
    ) {
      append(
        raw.stores.workbooks.map((row) =>
          object(row) ? row[raw.backend === 'memory' ? 'value' : 'workbook'] : row,
        ),
        '原始快照（未重放日志）',
      );
      directoryWarnings.push('原始快照未重放日志，可能缺少后续编辑；请保留原文件中的日志材料。');
    } else directoryWarnings.push('原始快照目录无法列出，请保留原备份文件。');
  }
  if (!records.length) throw new Error('备份中没有工作簿快照，请保留原文件中的 legacy 恢复材料。');
  return {
    partial: input.complete !== true || directoryWarnings.length > 0,
    warningCount:
      (Array.isArray(input.warnings) ? input.warnings.length : 0) + directoryWarnings.length,
    directoryWarnings,
    records,
  };
}
export function restoreRecoveryWorkbook(recovery: RecoveryImport, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= recovery.records.length)
    throw new Error('请选择备份中的工作簿。');
  const copy = independentWorkbookCopy(validateWorkbook(recovery.records[index].workbook));
  copy.name = workbookCopyName(copy.name, '（恢复副本）');
  return copy;
}
