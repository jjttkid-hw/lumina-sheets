import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { leadingFormulaHelp } from '../lib/formula-help';
import '../styles/formula-bar.css';

export interface FormulaBarProps {
  address: string;
  onAddressChange: (value: string) => void;
  onAddressSubmit: () => void;
  value: string;
  cellId: string;
  onCommit: (draft: string) => void;
  onDraftStateChange?: (dirty: boolean) => void;
  placeholder?: string;
  readOnly?: boolean;
}

interface EditorState {
  epoch: number;
  cellId: string;
  value: string;
  draft: string;
  error: string;
  readOnly: boolean;
}

export default function FormulaBar({
  address,
  onAddressChange,
  onAddressSubmit,
  value,
  cellId,
  onCommit,
  onDraftStateChange,
  placeholder = '输入内容或公式，例如 =SUM(D2:D13)',
  readOnly = false,
}: FormulaBarProps) {
  const errorId = `${useId()}-formula-error`;
  const helpId = `${useId()}-formula-help`;
  const [focused, setFocused] = useState(false);
  const [state, setState] = useState<EditorState>({
    epoch: 0,
    cellId,
    value,
    draft: value,
    error: '',
    readOnly,
  });
  const editor = useRef(state);
  const skipBlur = useRef(false);
  const composing = useRef(false);
  const compositionBlur = useRef(false);
  const draftDirty = useRef(false);
  const mounted = useRef(false);
  const lastCommitted = useRef<{ epoch: number; draft: string } | null>(null);

  // Reset in the same render as a selection/value change, before a late blur can
  // observe the new onCommit callback with the previous cell's draft.
  let current = state;
  if (state.cellId !== cellId || state.value !== value || state.readOnly !== readOnly) {
    current = { epoch: state.epoch + 1, cellId, value, draft: value, error: '', readOnly };
    setState(current);
    skipBlur.current = false;
    composing.current = false;
    compositionBlur.current = false;
    draftDirty.current = false;
  }
  editor.current = current;
  // Publish after React commits, never while rendering a candidate cell.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onDraftStateChange?.(false);
    };
  }, [onDraftStateChange]);
  useLayoutEffect(() => {
    onDraftStateChange?.(draftDirty.current);
  }, [current.epoch, onDraftStateChange]);
  const help =
    focused && !readOnly && !current.error ? leadingFormulaHelp(current.draft) : undefined;

  const epoch = current.epoch;
  const ownsEditor = () =>
    mounted.current &&
    editor.current.epoch === epoch &&
    editor.current.cellId === cellId &&
    editor.current.value === value;
  const update = (next: EditorState) => {
    editor.current = next;
    setState(next);
  };
  const acceptedValue = () =>
    lastCommitted.current?.epoch === epoch ? lastCommitted.current.draft : editor.current.value;
  const reportDraft = (draft: string) => {
    draftDirty.current = draft !== acceptedValue();
    onDraftStateChange?.(draftDirty.current);
  };
  const commit = (restoreOnFailure: boolean) => {
    if (readOnly || !ownsEditor()) return false;
    const snapshot = editor.current;
    try {
      if (snapshot.draft !== acceptedValue()) {
        onCommit(snapshot.draft);
        lastCommitted.current = { epoch, draft: snapshot.draft };
      }
      if (ownsEditor()) {
        update({ ...editor.current, error: '' });
        draftDirty.current = false;
        onDraftStateChange?.(false);
      }
      return true;
    } catch (cause) {
      if (ownsEditor()) {
        update({
          ...snapshot,
          draft: restoreOnFailure ? acceptedValue() : snapshot.draft,
          error:
            cause instanceof Error && cause.message ? cause.message : '未能保存，请检查输入内容。',
        });
        reportDraft(editor.current.draft);
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
          onChange={(event) => {
            if (ownsEditor()) onAddressChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (
              ownsEditor() &&
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
          readOnly={readOnly}
          aria-invalid={current.error ? true : undefined}
          aria-describedby={current.error ? errorId : help ? helpId : undefined}
          placeholder={placeholder}
          value={current.draft}
          onFocus={() => {
            if (!ownsEditor()) return;
            setFocused(true);
            skipBlur.current = false;
            compositionBlur.current = false;
          }}
          onChange={(event) => {
            if (readOnly || !ownsEditor()) return;
            skipBlur.current = false;
            update({ ...editor.current, draft: event.target.value, error: '' });
            reportDraft(event.target.value);
          }}
          onCompositionStart={() => {
            if (!ownsEditor()) return;
            composing.current = true;
            compositionBlur.current = false;
          }}
          onCompositionEnd={(event) => {
            if (!ownsEditor()) return;
            composing.current = false;
            // compositionend can precede the final change event. Read the actual
            // input value before finishing a blur deferred during composition.
            if (event?.currentTarget) {
              const draft = event.currentTarget.value;
              update({ ...editor.current, draft, error: '' });
              reportDraft(draft);
            }
            if (compositionBlur.current) {
              compositionBlur.current = false;
              commit(true);
            }
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
              update({ ...editor.current, draft: acceptedValue(), error: '' });
              draftDirty.current = false;
              onDraftStateChange?.(false);
              skipBlur.current = true;
              event.currentTarget.blur();
            }
          }}
          onBlur={() => {
            if (!ownsEditor()) return;
            setFocused(false);
            if (composing.current) {
              compositionBlur.current = true;
              return;
            }
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            commit(true);
          }}
        />
      </div>
      {help && (
        <p className="formula-bar-help" id={helpId}>
          <code>{help.syntax}</code>
          <span>{help.description}。方括号表示可省略的尾部参数。</span>
        </p>
      )}
      {current.error && (
        <p className="formula-bar-error" id={errorId} role="alert">
          {current.error}
        </p>
      )}
    </div>
  );
}
