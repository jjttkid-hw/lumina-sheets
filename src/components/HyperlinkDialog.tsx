import { useState } from 'react';
import type { Cell } from '../lib/types';
import { replaceCellText } from '../lib/rich-text';
import { copyHyperlink } from '../lib/cell-hyperlink';
import { externalHyperlinkUrl } from '../lib/hyperlink-navigation';
import Modal from './Modal';
import '../styles/sort-dialog.css';

export default function HyperlinkDialog({
  address,
  cell,
  onApply,
  onClose,
  onNavigate,
}: {
  address: string;
  cell?: Cell;
  onApply: (cell: Cell) => void;
  onClose: () => void;
  onNavigate?: () => void;
}) {
  const [label, setLabel] = useState(String(cell?.value ?? ''));
  const [target, setTarget] = useState(cell?.hyperlink?.target ?? '');
  const [tooltip, setTooltip] = useState(cell?.hyperlink?.tooltip ?? '');
  const [error, setError] = useState('');
  const savedTarget = cell?.hyperlink?.target;
  const externalUrl = savedTarget ? externalHyperlinkUrl(savedTarget) : undefined;
  function apply(remove = false) {
    try {
      if (remove) {
        const { hyperlink: _link, ...rest } = cell!;
        onApply(rest);
      } else {
        if (
          typeof cell?.value === 'number' ||
          typeof cell?.value === 'boolean' ||
          String(cell?.value ?? '').startsWith('=')
        )
          throw new Error('请先选择普通文本或空白单元格。');
        if (label.length > 32767) throw new Error('显示文字不能超过 32,767 个字符。');
        const hyperlink = copyHyperlink({ target, ...(tooltip ? { tooltip } : {}) }, label);
        onApply({ ...replaceCellText(cell, label), hyperlink });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '链接未能保存。');
    }
  }
  return (
    <Modal title="单元格链接" subtitle={`${address} · 保存后可撤销`} onClose={onClose}>
      <form
        className="sort-dialog"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label className="sort-dialog-field">
          显示文字
          <input
            aria-label="链接显示文字"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              setError('');
            }}
          />
        </label>
        <label className="sort-dialog-field">
          目标地址
          <input
            aria-label="链接目标地址"
            placeholder="https://example.com 或 #数据!A1"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setError('');
            }}
          />
        </label>
        <label className="sort-dialog-field">
          提示文字（可选）
          <input
            aria-label="链接提示文字"
            value={tooltip}
            onChange={(event) => {
              setTooltip(event.target.value);
              setError('');
            }}
          />
        </label>
        <p className="sort-dialog-hint">
          链接会随工作簿保存并导出到 Excel。打开入口使用已保存的目标，修改后请先保存。
        </p>
        {savedTarget && (
          <div className="sort-dialog-hint">
            <p>已保存目标：{savedTarget}</p>
            {externalUrl ? (
              <a className="button" href={externalUrl} target="_blank" rel="noopener noreferrer">
                打开已保存链接
              </a>
            ) : savedTarget.startsWith('#') && onNavigate ? (
              <button
                className="button"
                type="button"
                onClick={() => {
                  try {
                    onNavigate();
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : '无法跳转到目标。');
                  }
                }}
              >
                跳转到目标单元格
              </button>
            ) : (
              <span>此类型的目标仅保留，不在浏览器中打开。</span>
            )}
          </div>
        )}
        {error && (
          <p className="sort-dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer sort-dialog-footer">
          {cell?.hyperlink && (
            <button className="button" type="button" onClick={() => apply(true)}>
              移除链接
            </button>
          )}
          <button className="button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit">
            保存链接
          </button>
        </div>
      </form>
    </Modal>
  );
}
