import { useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import '../styles/formula-bar.css';

export interface FormulaBarProps {
  address: string;
  onAddressChange: (value: string) => void;
  onAddressSubmit: () => void;
  value: string;
  cellId: string;
  onCommit: (draft: string) => void;
  placeholder?: string;
}

interface EditorState {
  cellId: string;
  value: string;
  draft: string;
  error: string;
}

export default function FormulaBar({
  address,
  onAddressChange,
  onAddressSubmit,
  value,
  cellId,
  onCommit,
  placeholder = '输入内容或公式，例如 =SUM(D2:D13)',
}: FormulaBarProps) {
  const errorId = `${useId()}-formula-error`;
  const [state, setState] = useState<EditorState>({ cellId, value, draft: value, error: '' });
  const editor = useRef(state);
  const skipBlur = useRef(false);
  const composing = useRef(false);

  // Reset in the same render as a selection/value change, before a late blur can
  // observe the new onCommit callback with the previous cell's draft.
  let current = state;
  if (state.cellId !== cellId || state.value !== value) {
    current = { cellId, value, draft: value, error: '' };
    setState(current);
    skipBlur.current = false;
    composing.current = false;
  }
  editor.current = current;

  const ownsEditor = () => editor.current.cellId === cellId && editor.current.value === value;
  const update = (next: EditorState) => {
    editor.current = next;
    setState(next);
  };
  const commit = (restoreOnFailure: boolean) => {
    if (!ownsEditor()) return false;
    const snapshot = editor.current;
    try {
      if (snapshot.draft !== snapshot.value) onCommit(snapshot.draft);
      if (ownsEditor()) update({ ...editor.current, error: '' });
      return true;
    } catch (cause) {
      if (ownsEditor()) {
        update({
          ...snapshot,
          draft: restoreOnFailure ? snapshot.value : snapshot.draft,
          error:
            cause instanceof Error && cause.message ? cause.message : '未能保存，请检查输入内容。',
        });
      }
      return false;
    }
  };

  return (
    <div className="formula-bar-container">
      <div className="formula-bar">
        <input
          className="cell-address"
          aria-label="单元格地址"
          value={address}
          onChange={(event) => onAddressChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              onAddressSubmit();
            }
          }}
        />
        <ChevronDown size={12} aria-hidden="true" />
        <span className="formula-divider" aria-hidden="true" />
        <span className="fx" aria-hidden="true">
          ƒx
        </span>
        <input
          aria-label="公式编辑栏"
          aria-invalid={current.error ? true : undefined}
          aria-describedby={current.error ? errorId : undefined}
          placeholder={placeholder}
          value={current.draft}
          onFocus={() => {
            skipBlur.current = false;
          }}
          onChange={(event) => {
            if (!ownsEditor()) return;
            skipBlur.current = false;
            update({ ...editor.current, draft: event.target.value, error: '' });
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              !ownsEditor() ||
              composing.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            if (event.key === 'Enter') {
              event.preventDefault();
              if (commit(false)) {
                skipBlur.current = true;
                event.currentTarget.blur();
              }
            } else if (event.key === 'Escape') {
              event.preventDefault();
              update({ ...editor.current, draft: editor.current.value, error: '' });
              skipBlur.current = true;
              event.currentTarget.blur();
            }
          }}
          onBlur={() => {
            if (!ownsEditor()) return;
            composing.current = false;
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            commit(true);
          }}
        />
      </div>
      {current.error && (
        <p className="formula-bar-error" id={errorId} role="alert">
          {current.error}
        </p>
      )}
    </div>
  );
}
