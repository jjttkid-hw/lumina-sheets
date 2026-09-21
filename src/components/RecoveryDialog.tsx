import { useState } from 'react';
import type { RecoveryImport } from '../lib/recovery-import';
import Modal from './Modal';
import '../styles/sort-dialog.css';

export default function RecoveryDialog({
  backup,
  onRestore,
  onClose,
}: {
  backup: RecoveryImport;
  onRestore: (index: number) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState('0');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const visible = backup.records
    .map((record, i) => ({ record, i }))
    .filter(({ record }) =>
      `${record.name} ${record.source} ${record.detail ?? ''}`.toLocaleLowerCase().includes(needle),
    );
  const selected = visible.find(({ i }) => String(i) === index);
  return (
    <Modal title="从备份恢复工作簿" subtitle="选择一本工作簿，恢复为独立副本。" onClose={onClose}>
      <form
        className="sort-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selected) {
            setError('请从搜索结果中选择待恢复的工作簿。');
            return;
          }
          try {
            onRestore(selected.i);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '恢复失败，请选择其他工作簿。');
          }
        }}
      >
        <label className="sort-dialog-field">
          搜索备份
          <input
            type="search"
            aria-label="搜索备份快照"
            placeholder="工作簿名称、来源、版本或时间"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              // Search/IME confirmation must never submit a recovery operation.
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
        </label>
        <p role="status" className="sort-dialog-hint">
          找到 {visible.length} 个快照，共 {backup.records.length} 个。
          {!visible.length && '请调整搜索条件。'}
        </p>
        <label className="sort-dialog-field">
          工作簿
          <select
            aria-label="待恢复工作簿"
            value={selected ? index : ''}
            disabled={!visible.length}
            onChange={(event) => {
              setIndex(event.target.value);
              setError('');
            }}
          >
            {!selected && (
              <option value="" disabled>
                请选择快照
              </option>
            )}
            {visible.map(({ record, i }) => (
              <option value={i} key={i}>
                {i + 1}. [{record.source}] {record.name}
                {record.detail ? ` — ${record.detail}` : ''}
              </option>
            ))}
          </select>
        </label>
        {backup.partial && (
          <p role="status" className="sort-dialog-hint">
            这是一份部分备份，记录了 {backup.warningCount}{' '}
            项读取或目录警告。请保留原文件，检查各来源中的可用快照。
          </p>
        )}
        {backup.directoryWarnings.map((warning, i) => (
          <p key={i} role="status" className="sort-dialog-hint">
            {warning}
          </p>
        ))}
        <p className="sort-dialog-hint">
          原工作簿保持不变。本次恢复所选快照的表格内容、公式、样式与规则。历史版本可单独恢复为工作簿；批注、历史列表和旧设置不会自动合并导入，请保留原备份文件。
        </p>
        <p className="sort-dialog-hint">恢复后请检查内容并确认已保存，再处理原浏览器数据。</p>
        {error && (
          <p role="alert" className="sort-dialog-error">
            {error}
          </p>
        )}
        <div className="modal-footer sort-dialog-footer">
          <button className="button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={!selected}>
            恢复为新工作簿
          </button>
        </div>
      </form>
    </Modal>
  );
}
