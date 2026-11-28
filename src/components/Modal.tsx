import { useEffect, useRef, type ReactNode } from "react";

type Props = { open: boolean; onClose: () => void; labelledBy: string; busy?: boolean; className?: string; children: ReactNode };

// native modal dialog: centered, dims the page, esc closes, focus stays inside
export function Modal({ open, onClose, labelledBy, busy = false, className, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // start typing in the first field rather than on the close button
      dialog.querySelector<HTMLElement>("input, select, textarea")?.focus();
    }
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className={["modal", className].filter(Boolean).join(" ")} aria-labelledby={labelledBy}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    // a click on the dimmed area lands on the dialog itself, not its content
    onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="modal-content">
      <button type="button" className="modal-close" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
      {children}
    </div>
  </dialog>;
}
