import { useState } from 'react';
import type { FormEvent } from 'react';
import type { StructureEdit } from '../lib/formula-structure';
import type { Selection, Sheet } from '../lib/types';
import Modal from './Modal';
import '../styles/sort-dialog.css';

export default function StructureDialog({
  sheet,
  selection,
  onApply,
  onClose,
}: {
  sheet: Sheet;
  selection: Selection;
  onApply: (edit: StructureEdit) => void;
  onClose: () => void;
}) {
  const [axis, setAxis] = useState<'row' | 'column'>('row');
  const [kind, setKind] = useState<'insert' | 'delete'>('insert');
  const [position, setPosition] = useState(
    String(Math.min(selection.row, selection.endRow ?? selection.row) + 1),
  );
  const [count, setCount] = useState(
    String(Math.abs((selection.endRow ?? selection.row) - selection.row) + 1),
  );
  const [error, setError] = useState('');
  const label = axis === 'row' ? '行' : '列';
  const dimension = axis === 'row' ? sheet.rowCount : sheet.colCount;
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (!/^[1-9]\d*$/.test(position) || !/^[1-9]\d*$/.test(count))
        throw new Error('位置和数量必须是正整数。');
      const index = Number(position) - 1,
        amount = Number(count);
      if (
        !Number.isSafeInteger(index) ||
        !Number.isSafeInteger(amount) ||
        index >= dimension + (kind === 'insert' ? 1 : 0) ||
        (kind === 'delete' && index + amount > dimension)
      )
        throw new Error('操作超出工作表范围，请检查位置和数量。');
      if (kind === 'delete' && amount >= dimension) throw new Error(`工作表至少保留一${label}。`);
      setError('');
      onApply({ axis, kind, index, count: amount });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '行列修改未完成。');
    }
  }
  return (
    <Modal title="插入或删除行列" subtitle="数据与公式引用一起调整，可一次撤销。" onClose={onClose}>
      <form className="sort-dialog" onSubmit={submit} noValidate>
        <div className="sort-dialog-range">
          <label className="sort-dialog-field">
            方向
            <select
              aria-label="行列方向"
              value={axis}
              onChange={(event) => {
                const next = event.target.value as 'row' | 'column';
                setAxis(next);
                setError('');
                const start = next === 'row' ? selection.row : selection.col;
                const end =
                  next === 'row' ? (selection.endRow ?? start) : (selection.endCol ?? start);
                setPosition(String(Math.min(start, end) + 1));
                setCount(String(Math.abs(end - start) + 1));
              }}
            >
              <option value="row">行</option>
              <option value="column">列</option>
            </select>
          </label>
          <label className="sort-dialog-field">
            操作
            <select
              aria-label="行列操作"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as 'insert' | 'delete');
                setError('');
              }}
            >
              <option value="insert">在指定位置前插入</option>
              <option value="delete">从指定位置开始删除</option>
            </select>
          </label>
        </div>
        <div className="sort-dialog-range">
          <label className="sort-dialog-field">
            起始{label}号
            <input
              aria-label="行列起始位置"
              type="number"
              min={1}
              max={dimension + (kind === 'insert' ? 1 : 0)}
              value={position}
              onChange={(event) => {
                setPosition(event.target.value);
                setError('');
              }}
            />
          </label>
          <label className="sort-dialog-field">
            数量
            <input
              aria-label="行列数量"
              type="number"
              min={1}
              value={count}
              onChange={(event) => {
                setCount(event.target.value);
                setError('');
              }}
            />
          </label>
        </div>
        <p className="sort-dialog-hint">
          当前共 {dimension.toLocaleString()} {label}
          。位置按原始行列编号；隐藏行列也参与移动，筛选不缩小操作范围。
        </p>
        <p className="sort-dialog-hint">
          合并、验证规则和打印设置随结构调整。批注绑定原始坐标，不随单元格移动。
        </p>
        {kind === 'delete' && (
          <p className="sort-dialog-hint">
            删除范围内的内容会移除，引用被删除单元格的公式可能变为 #REF!。
          </p>
        )}
        {error && (
          <p className="sort-dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer sort-dialog-footer">
          <button className="button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit">
            {kind === 'insert' ? '插入' : '删除'}
            {label}
          </button>
        </div>
      </form>
    </Modal>
  );
}
