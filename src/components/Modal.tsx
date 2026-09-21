import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const element = ref.current;
    const nodes = () =>
      Array.from(
        element?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,a[href],[tabindex],[contenteditable="true"]',
        ) || [],
      )
        .filter((node) => {
          if (
            node.tabIndex < 0 ||
            node.matches(':disabled') ||
            node.closest('[hidden],[inert],[aria-hidden="true"]') ||
            !node.getClientRects().length
          )
            return false;
          const visibility = getComputedStyle(node).visibility;
          return visibility !== 'hidden' && visibility !== 'collapse';
        })
        // Match native sequential focus order: positive tabindex first, then 0.
        .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
    (nodes()[0] ?? element)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || composing.current || e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab') {
        const list = nodes(),
          first = list[0],
          last = list.at(-1);
        if (!first) {
          e.preventDefault();
          element?.focus();
        } else if (
          !element?.contains(document.activeElement) ||
          document.activeElement === element
        ) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onCompositionStartCapture={() => {
          composing.current = true;
        }}
        onCompositionEndCapture={() => {
          composing.current = false;
        }}
        onKeyDownCapture={(event) => {
          if (
            event.key === 'Enter' &&
            (composing.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229)
          )
            event.preventDefault();
        }}
        onSubmitCapture={(event) => {
          if (composing.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
