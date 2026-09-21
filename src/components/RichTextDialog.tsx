import { useState } from 'react';
import type { Cell, RichTextStyle } from '../lib/types';
import { richTextMetrics } from '../lib/canvas/rich-text';
import { formatTextRange, textareaTextRange } from '../lib/rich-text-edit';
import Modal from './Modal';
import '../styles/sort-dialog.css';
import '../styles/rich-text-dialog.css';

export default function RichTextDialog({
  address,
  cell,
  onApply,
  onClose,
}: {
  address: string;
  cell: Cell;
  onApply: (cell: Cell) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(cell);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [color, setColor] = useState('#198754');
  const [size, setSize] = useState('18');
  const [family, setFamily] = useState('Arial');
  const [error, setError] = useState('');
  const text = String(draft.value);
  const supported = typeof draft.value === 'string' && !draft.value.startsWith('=');
  const selected = range.start < range.end;
  function format(patch: RichTextStyle | null) {
    try {
      setDraft(formatTextRange(draft, range.start, range.end, patch));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '格式未能应用。');
    }
  }
  return (
    <Modal
      title="局部文字格式"
      subtitle={`${address} · 选中文字后设置样式，保存后可撤销。`}
      onClose={onClose}
    >
      <form
        className="sort-dialog rich-text-dialog"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          try {
            if (!supported) throw new Error('局部格式仅支持普通文本单元格。');
            onApply(structuredClone(draft));
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '格式未能保存。');
          }
        }}
      >
        <label className="sort-dialog-field">
          选中需要设置格式的文字
          <textarea
            aria-label="选择局部格式文字"
            readOnly
            value={text}
            rows={4}
            onSelect={(event) => {
              const { selectionStart: start, selectionEnd: end } = event.currentTarget;
              try {
                setRange(textareaTextRange(text, start, end));
                setError('');
              } catch (cause) {
                setRange({ start: 0, end: 0 });
                setError(cause instanceof Error ? cause.message : '请重新选择文字。');
              }
            }}
          />
        </label>
        <p className="sort-dialog-hint" role="status">
          {selected
            ? `已选择：${text.slice(range.start, range.end)}`
            : '可拖动选择，或用 Shift + 方向键选择文字。'}
        </p>
        {!supported && <p role="alert">局部格式仅支持普通文本单元格。</p>}
        <fieldset className="rich-text-controls" disabled={!supported || !selected}>
          <legend>应用到所选文字</legend>
          <div className="rich-text-actions">
            {(
              [
                ['bold', '粗体'],
                ['italic', '斜体'],
                ['underline', '下划线'],
                ['strike', '删除线'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="sort-dialog-field">
                {label}
                <select
                  aria-label={`所选文字${label}`}
                  value=""
                  onChange={(event) => {
                    if (event.target.value) format({ [key]: event.target.value === 'on' });
                  }}
                >
                  <option value="">设置…</option>
                  <option value="on">开启</option>
                  <option value="off">关闭</option>
                </select>
              </label>
            ))}
          </div>
          <div className="rich-text-actions">
            <label className="sort-dialog-field">
              上下标
              <select
                aria-label="所选文字上下标"
                value=""
                onChange={(event) => {
                  if (event.target.value)
                    format({ verticalAlign: event.target.value as RichTextStyle['verticalAlign'] });
                }}
              >
                <option value="">设置…</option>
                <option value="baseline">正常</option>
                <option value="superscript">上标</option>
                <option value="subscript">下标</option>
              </select>
            </label>
          </div>
          <div className="rich-text-actions">
            <label className="sort-dialog-field">
              文字颜色
              <input
                aria-label="局部文字颜色"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
            <button type="button" className="button" onClick={() => format({ color })}>
              应用颜色
            </button>
            <label className="sort-dialog-field">
              字号
              <input
                aria-label="局部文字字号"
                type="number"
                min={6}
                max={96}
                value={size}
                onChange={(e) => setSize(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="button"
              onClick={() => format({ fontSize: Number(size) })}
            >
              应用字号
            </button>
          </div>
          <div className="rich-text-actions">
            <label className="sort-dialog-field">
              字体
              <input
                aria-label="局部文字字体"
                value={family}
                maxLength={128}
                onChange={(e) => setFamily(e.target.value)}
              />
            </label>
            <button type="button" className="button" onClick={() => format({ fontFamily: family })}>
              应用字体
            </button>
            <button type="button" className="button" onClick={() => format(null)}>
              恢复单元格样式
            </button>
          </div>
        </fieldset>
        <p className="sort-dialog-hint">样式预览。字体取决于当前设备；修改文字请返回表格编辑。</p>
        <div
          className="rich-text-preview"
          aria-label="局部文字格式预览"
          style={{ textAlign: draft.style?.align }}
        >
          {(draft.richText ?? [{ text }]).map((run, index) => {
            const style = { ...draft.style, ...run.style };
            const metrics = richTextMetrics(style);
            return (
              <span
                key={index}
                style={{
                  fontWeight: style.bold ? 'bold' : 'normal',
                  fontStyle: style.italic ? 'italic' : 'normal',
                  color: style.color,
                  fontSize: metrics.size,
                  position: 'relative',
                  top: metrics.offset,
                  fontFamily: style.fontFamily
                    ? `${JSON.stringify(style.fontFamily)}, sans-serif`
                    : undefined,
                  textDecoration:
                    [style.underline ? 'underline' : '', style.strike ? 'line-through' : '']
                      .filter(Boolean)
                      .join(' ') || 'none',
                }}
              >
                {run.text}
              </span>
            );
          })}
        </div>
        {error && (
          <p className="sort-dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer sort-dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="button primary" disabled={!supported}>
            保存格式
          </button>
        </div>
      </form>
    </Modal>
  );
}
