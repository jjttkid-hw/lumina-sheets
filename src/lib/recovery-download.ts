import { collectRecoveryBackup } from './recovery-backup';

/** Export only while the requesting view is still active. */
export async function downloadRecoveryBackup(
  source: Parameters<typeof collectRecoveryBackup>[0],
  isCurrent: () => boolean,
): Promise<string | undefined> {
  const backup = await collectRecoveryBackup(source, () => localStorage);
  if (!isCurrent()) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
  );
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Lumina-恢复备份.json';
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return backup.complete
    ? '已导出当前可读取的本地数据。尚未进入存储队列的编辑不包含在内。'
    : '已导出部分数据；存在读取失败或损坏记录，请查看文件中的 warnings。';
}
