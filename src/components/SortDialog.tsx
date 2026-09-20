import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { cellKey, columnLabel } from '../lib/engine';
import type { RowSortRequest } from '../lib/row-sort';
import type { Selection, Sheet } from '../lib/types';
import Modal from './Modal';
import '../styles/sort-dialog.css';

export interface SortDialogProps {
  sheet: Sheet;
  selection: Selection;
  direction: 'asc' | 'desc';
  onClose: () => void;
  onSort: (request: RowSortRequest) => void;
}

export default function SortDialog({
  sheet,
  selection,
  direction,
  onClose,
  onSort,
}: SortDialogProps) {
  const id = useId();
  const [startRow, setStartRow] = useState(
    String(Math.min(selection.row, selection.endRow ?? selection.row) + 1),
  );
  const [endRow, setEndRow] = useState(
    String(Math.max(selection.row, selection.endRow ?? selection.row) + 1),
  );
  const [primaryColumn, setPrimaryColumn] = useState(String(selection.col));
  const [primaryDirection, setPrimaryDirection] = useState(direction);
  const [secondaryColumn, setSecondaryColumn] = useState('');
  const [secondaryDirection, setSecondaryDirection] = useState<'asc' | 'desc'>('asc');
  const [includeHidden, setIncludeHidden] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'center' });
  }, [error]);
  const columns = useMemo(
    () =>
      Array.from({ length: sheet.colCount }, (_, column) => {
        const value = sheet.cells[cellKey(0, column)]?.value;
        const title =
          typeof value === 'string' && !value.startsWith('=')
            ? value.trim().replace(/\s+/g, ' ')
            : '';
        const shortTitle = [...title].slice(0, 24).join('');
        return {
          value: String(column),
          label: `${columnLabel(column)}${shortTitle ? ` · ${shortTitle}${[...title].length > 24 ? '…' : ''}` : ''}`,
        };
      }),
    [sheet.colCount, sheet.cells],
  );
  const start = Number(startRow);
  const end = Number(endRow);
  const validRange =
    startRow.trim() !== '' &&
    endRow.trim() !== '' &&
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 1 &&
    end >= start &&
    end <= sheet.rowCount;
  const count = validRange ? end - start + 1 : 0;
  const hiddenCount = validRange
    ? (sheet.hiddenRows ?? []).filter((row) => row >= start - 1 && row < end).length
    : 0;
  const change = (update: () => void) => {
    update();
    setError('');
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validRange) {
      setError(
        `请输入有效的起始行和结束行（1–${sheet.rowCount.toLocaleString()}），结束行不能小于起始行。`,
      );
      return;
    }
    if (count < 2) {
      setError('请至少选择两行进行排序。');
      return;
    }
    if (count > 100_000) {
      setError('单次最多排序 100,000 行，请缩小范围。');
      return;
    }
    if (start <= (sheet.frozenRows ?? 0)) {
      setError(`前 ${sheet.frozenRows} 行已冻结，请从第 ${(sheet.frozenRows ?? 0) + 1} 行开始。`);
      return;
    }
    const primary = Number(primaryColumn);
    const secondary = secondaryColumn === '' ? null : Number(secondaryColumn);
    if (
      !Number.isSafeInteger(primary) ||
      primary < 0 ||
      primary >= sheet.colCount ||
      (secondary !== null &&
        (!Number.isSafeInteger(secondary) || secondary < 0 || secondary >= sheet.colCount))
    ) {
      setError('请选择有效的排序列。');
      return;
    }
    if (secondary === primary) {
      setError('主要列与次要列不能相同。');
      return;
    }
    const keys: RowSortRequest['keys'] = [{ column: primary, direction: primaryDirection }];
    if (secondary !== null) keys.push({ column: secondary, direction: secondaryDirection });
    setError('');
    try {
      onSort({ startRow: start - 1, rowCount: count, keys, includeHidden });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '排序未完成，请检查范围后重试。');
    }
  };

  return (
    <Modal title="排序行" subtitle="选定行范围，再设置排序顺序。" onClose={onClose}>
      <form className="sort-dialog" onSubmit={submit} noValidate>
        <fieldset className="sort-dialog-section">
          <legend>排序范围</legend>
          <div className="sort-dialog-range">
            <label className="sort-dialog-field">
              起始行
              <input
                type="number"
                min={1}
                max={sheet.rowCount}
                step={1}
                value={startRow}
                aria-describedby={`${id}-range-hint`}
                onChange={(event) => change(() => setStartRow(event.target.value))}
              />
            </label>
            <label className="sort-dialog-field">
              结束行
              <input
                type="number"
                min={1}
                max={sheet.rowCount}
                step={1}
                value={endRow}
                aria-describedby={`${id}-range-hint`}
                onChange={(event) => change(() => setEndRow(event.target.value))}
              />
            </label>
          </div>
          <p className="sort-dialog-hint" id={`${id}-range-hint`}>
            {count === 1
              ? '当前仅选中一行，请将范围扩展到至少两行。'
              : count
                ? `第 ${start.toLocaleString()}–${end.toLocaleString()} 行，共 ${count.toLocaleString()} 行。`
                : `本工作表共 ${sheet.rowCount.toLocaleString()} 行，请填写有效范围。`}
          </p>
        </fieldset>

        <fieldset className="sort-dialog-section">
          <legend>排序依据</legend>
          <div className="sort-dialog-key">
            <label className="sort-dialog-field">
              主要列
              <select
                value={primaryColumn}
                onChange={(event) => change(() => setPrimaryColumn(event.target.value))}
              >
                {columns.map((column) => (
                  <option key={column.value} value={column.value}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sort-dialog-field">
              主要方向
              <select
                value={primaryDirection}
                onChange={(event) =>
                  change(() => setPrimaryDirection(event.target.value as 'asc' | 'desc'))
                }
              >
                <option value="asc">升序 · 小到大</option>
                <option value="desc">降序 · 大到小</option>
              </select>
            </label>
          </div>
          <div className="sort-dialog-key">
            <label className="sort-dialog-field">
              次要列（可选）
              <select
                value={secondaryColumn}
                onChange={(event) => change(() => setSecondaryColumn(event.target.value))}
              >
                <option value="">不设置</option>
                {columns.map((column) => (
                  <option key={column.value} value={column.value}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sort-dialog-field">
              次要方向
              <select
                value={secondaryDirection}
                disabled={secondaryColumn === ''}
                onChange={(event) =>
                  change(() => setSecondaryDirection(event.target.value as 'asc' | 'desc'))
                }
              >
                <option value="asc">升序 · 小到大</option>
                <option value="desc">降序 · 大到小</option>
              </select>
            </label>
          </div>
          <p className="sort-dialog-hint">主要列相同时，再按次要列排序。</p>
        </fieldset>

        <label className="sort-dialog-checkbox">
          <input
            type="checkbox"
            checked={includeHidden}
            onChange={(event) => change(() => setIncludeHidden(event.target.checked))}
          />
          包含隐藏行
        </label>
        <div className="sort-dialog-summary">
          <p>整行内容与样式一起移动，公式保留并随所在行调整。</p>
          <p>
            {includeHidden
              ? '隐藏行也参与排序，隐藏位置保持不变。'
              : `隐藏行留在原位${hiddenCount ? `，本范围内跳过 ${hiddenCount.toLocaleString()} 行` : ''}。`}
          </p>
          <p>筛选不会缩小排序范围。请避开表头、合计行和合并区域。</p>
        </div>
        {error && (
          <p className="sort-dialog-error" role="alert" ref={errorRef}>
            {error}
          </p>
        )}
        <div className="modal-footer sort-dialog-footer">
          <button className="button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit">
            应用排序
          </button>
        </div>
      </form>
    </Modal>
  );
}
