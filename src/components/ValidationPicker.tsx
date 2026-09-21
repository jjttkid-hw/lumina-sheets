import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import type { CellValue } from '../lib/types';
import { validationOptionLabel, validationOptionType } from '../lib/validation-options';
import '../styles/validation-picker.css';

export interface ValidationPickerProps {
  address: string;
  values: CellValue[];
  unsupportedFormulaCount: number;
  currentValue: CellValue;
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  onChoose: (value: CellValue) => boolean;
  onClose: (restoreFocus: boolean) => void;
}

const ROW_HEIGHT = 36;
const OVERSCAN = 3;
const MAX_LIST_HEIGHT = ROW_HEIGHT * 8;
const stop = (event: SyntheticEvent) => event.stopPropagation();

export default function ValidationPicker({
  address,
  values,
  unsupportedFormulaCount,
  currentValue,
  left,
  top,
  width,
  maxHeight,
  onChoose,
  onClose,
}: ValidationPickerProps) {
  const id = useId();
  const listId = `${id}-options`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const closing = useRef(false);
  const choosing = useRef(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() => Math.max(0, values.indexOf(currentValue)));
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(() =>
    Math.max(0, Math.min(MAX_LIST_HEIGHT, maxHeight)),
  );
  const [rejected, setRejected] = useState(false);
  const unsupportedNote =
    unsupportedFormulaCount > 0
      ? `= 开头文本当前按公式解释，未列为可选项（${unsupportedFormulaCount} 项）。`
      : undefined;
  const options = useMemo(
    () =>
      values.map((value, index) => {
        const label = validationOptionLabel(value);
        const type = validationOptionType(value);
        return {
          value,
          index,
          label,
          type,
          search: `${label} ${type} ${value}`.toLocaleLowerCase(),
        };
      }),
    [values],
  );
  const filtered = useMemo(() => {
    const search = query.toLocaleLowerCase();
    return search ? options.filter((option) => option.search.includes(search)) : options;
  }, [options, query]);
  const activeIndex = filtered.length ? Math.min(active, filtered.length - 1) : -1;
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setViewportHeight(list.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [maxHeight, rejected, unsupportedFormulaCount, filtered.length]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeIndex < 0) return;
    const rowTop = activeIndex * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const height = Math.max(1, list.clientHeight);
    if (rowTop < list.scrollTop) list.scrollTop = rowTop;
    else if (rowBottom > list.scrollTop + height) list.scrollTop = Math.max(0, rowBottom - height);
    setScrollTop(list.scrollTop);
  }, [activeIndex, viewportHeight, query]);

  const close = (restoreFocus: boolean) => {
    if (closing.current) return;
    closing.current = true;
    onClose(restoreFocus);
  };
  const choose = (value: CellValue) => {
    if (closing.current) return;
    choosing.current = true;
    try {
      const accepted = onChoose(value);
      closing.current = accepted;
      setRejected(!accepted);
    } catch {
      setRejected(true);
    } finally {
      choosing.current = false;
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        event.preventDefault();
        if (activeIndex < 0) return;
        setActive(
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? filtered.length - 1
              : Math.max(
                  0,
                  Math.min(filtered.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)),
                ),
        );
        break;
      case 'Enter':
        event.preventDefault();
        if (activeIndex >= 0) choose(filtered[activeIndex].value);
        break;
    }
  };

  const totalHeight = filtered.length * ROW_HEIGHT;
  const visibleScrollTop = Math.min(scrollTop, Math.max(0, totalHeight - viewportHeight));
  const start = Math.max(0, Math.floor(visibleScrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    filtered.length,
    Math.ceil((visibleScrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const rendered = Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
  // Keep aria-activedescendant valid even when the user scrolls away from the keyboard cursor.
  if (activeIndex >= 0 && !rendered.includes(activeIndex)) {
    rendered.push(activeIndex);
    rendered.sort((a, b) => a - b);
  }

  return (
    <div
      className={`validation-picker${maxHeight < 180 ? ' validation-picker-compact' : ''}${maxHeight < 100 ? ' validation-picker-micro' : ''}`}
      role="group"
      aria-label={`${address} 的可选值`}
      style={{ left, top, width, maxHeight: Math.max(0, maxHeight) }}
      onKeyDown={keyDown}
      onKeyUp={stop}
      onKeyPress={stop}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onWheel={stop}
      onBlur={(event) => {
        if (!choosing.current && !event.currentTarget.contains(event.relatedTarget)) close(false);
      }}
    >
      <div className="validation-picker-header">
        <div className="validation-picker-heading">
          <strong>{address} · 选择内容</strong>
          <span aria-live="polite" aria-atomic="true">
            {query ? `${filtered.length} / ${values.length}` : values.length} 个选项
          </span>
        </div>
        <input
          ref={inputRef}
          className="validation-picker-search"
          type="text"
          role="combobox"
          aria-label={`搜索 ${address} 的可选值`}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            activeIndex >= 0 ? optionId(filtered[activeIndex].index) : undefined
          }
          aria-describedby={unsupportedFormulaCount > 0 ? `${id}-unsupported` : undefined}
          title={unsupportedNote}
          autoComplete="off"
          spellCheck={false}
          placeholder="搜索选项"
          value={query}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setScrollTop(0);
            if (listRef.current) listRef.current.scrollTop = 0;
            setRejected(false);
          }}
        />
      </div>
      <div
        ref={listRef}
        id={listId}
        className="validation-picker-list"
        role="listbox"
        aria-label={`${address} 的选项`}
        style={{ height: Math.min(MAX_LIST_HEIGHT, Math.max(ROW_HEIGHT, totalHeight)) }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {filtered.length ? (
          <div role="presentation" style={{ height: totalHeight, position: 'relative' }}>
            {rendered.map((index) => {
              const option = filtered[index];
              const current = option.value === currentValue;
              return (
                <div
                  key={option.index}
                  id={optionId(option.index)}
                  className={`validation-picker-option${index === activeIndex ? ' active' : ''}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-label={`${option.label}，${option.type}${current ? '，当前值' : ''}`}
                  aria-posinset={index + 1}
                  aria-setsize={filtered.length}
                  style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                  title={`${option.label}（${option.type}）`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(option.value)}
                >
                  <span className="validation-picker-option-label">{option.label}</span>
                  <span className="validation-picker-option-type">{option.type}</span>
                  <span className="validation-picker-current" aria-hidden="true">
                    {current ? '✓' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="validation-picker-empty" role="presentation">
            {query ? '没有匹配的选项' : '没有可用选项'}
          </div>
        )}
      </div>
      <div className="validation-picker-footer">
        {rejected && (
          <p className="validation-picker-error" role="alert">
            未能应用该选项，请查看表格错误提示
          </p>
        )}
        {unsupportedFormulaCount > 0 && (
          <p id={`${id}-unsupported`} className="validation-picker-note">
            {unsupportedNote}
          </p>
        )}
        <p className="validation-picker-keys">↑↓ 选择 · Enter 确定 · Esc 取消</p>
      </div>
    </div>
  );
}
