import { useState } from 'react';
import Modal from './Modal';
import {
  findStoredCells,
  replaceStoredCells,
  type CellMatch,
  type FindCellsOptions,
} from '../lib/search-replace';
import type { Cell, Sheet } from '../lib/types';
import '../styles/find-replace.css';

export default function FindReplaceDialog({
  sheet,
  onClose,
  onNavigate,
  onReplace,
}: {
  sheet: Sheet;
  onClose: () => void;
  onNavigate: (key: string) => void;
  onReplace: (changes: Array<{ key: string; cell: Cell }>) => void;
}) {
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<FindCellsOptions>({});
  const [matches, setMatches] = useState<CellMatch[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reset = () => {
    setMatches(null);
    setError('');
    setNotice('');
  };
  const run = (replace: boolean) => {
    try {
      setError('');
      if (replace) {
        const result = replaceStoredCells(sheet, { ...options, search, replacement });
        if (result.changes.length) onReplace(result.changes);
        setMatches(null);
        setNotice(
          result.changedCells
            ? `已替换 ${result.matches} 处文字，修改 ${result.changedCells} 格；可一次撤销。`
            : `找到 ${result.matches} 处；内容没有变化。`,
        );
      } else {
        const found = findStoredCells(sheet, search, options);
        setMatches(found);
        setNotice(
          `找到 ${found.length} 处文字，涉及 ${new Set(found.map((m) => m.key)).size} 格。`,
        );
      }
    } catch (cause) {
      setMatches(null);
      setNotice('');
      setError(cause instanceof Error ? cause.message : '操作未完成。');
    }
  };
  const cells = matches ? [...new Map(matches.map((m) => [m.key, m])).values()] : [];
  return (
    <Modal
      title="查找与替换"
      subtitle={`当前工作表 · ${sheet.name} · 替换可一次撤销`}
      onClose={onClose}
    >
      <form
        className="find-replace"
        onSubmit={(event) => {
          event.preventDefault();
          run(false);
        }}
      >
        <label className="field-label">
          查找文字
          <input
            autoFocus
            aria-label="查找文字"
            value={search}
            maxLength={32767}
            onChange={(event) => {
              setSearch(event.target.value);
              reset();
            }}
          />
        </label>
        <label className="field-label">
          替换为
          <input
            aria-label="替换为"
            placeholder="留空可删除匹配文字"
            value={replacement}
            maxLength={32767}
            onChange={(event) => {
              setReplacement(event.target.value);
              setError('');
              setNotice('');
            }}
          />
        </label>
        <fieldset className="find-replace-options">
          <legend>匹配方式</legend>
          {(
            [
              ['matchCase', '区分大小写'],
              ['wholeCell', '匹配整个单元格'],
              ['includeFormulas', '包含公式源码'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={!!options[key]}
                onChange={(event) => {
                  setOptions({ ...options, [key]: event.target.checked });
                  reset();
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <p className="find-replace-hint">
          查找已存储文字，包含隐藏或筛选掉的单元格。默认跳过公式；不查找数字、计算结果或格式化显示。替换保留单元格样式，清除被修改文字的局部格式。
        </p>
        {error && <p role="alert">{error}</p>}
        <p role="status" aria-live="polite">
          {notice}
        </p>
        {cells.length > 0 && (
          <div className="find-replace-results" aria-label="查找结果">
            {cells.slice(0, 20).map((match) => (
              <button type="button" key={match.key} onClick={() => onNavigate(match.key)}>
                <strong>{match.key}</strong>
                <span>{match.value.slice(0, 100)}</span>
              </button>
            ))}
            {cells.length > 20 && (
              <p>显示前 20 格，共 {cells.length} 格。请缩小查找内容以定位其余结果。</p>
            )}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            关闭
          </button>
          <button type="submit" className="button secondary" disabled={!search}>
            查找全部
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!search}
            onClick={() => run(true)}
          >
            全部替换
          </button>
        </div>
      </form>
    </Modal>
  );
}
