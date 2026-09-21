import { useState } from 'react';
import Modal from './Modal';

export default function SheetRenameDialog({
  name,
  onApply,
  onClose,
}: {
  name: string;
  onApply: (name: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState('');
  return (
    <Modal title="重命名工作表" subtitle="公式与内部链接一起更新，可撤销。" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onApply(draft);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '重命名未完成。');
          }
        }}
      >
        <label className="field-label">
          工作表名称
          <input
            autoFocus
            aria-label="工作表名称"
            value={draft}
            maxLength={31}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="button primary" disabled={!draft.trim()}>
            保存名称
          </button>
        </div>
      </form>
    </Modal>
  );
}
