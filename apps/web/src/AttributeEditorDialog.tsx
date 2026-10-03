import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function AttributeEditorDialog({ title, children, onClose, busy = false, focusReady = true }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  focusReady?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const input = focusReady ? dialog.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not(:disabled), textarea:not(:disabled)") : null;
    (input ?? dialog.current)?.focus({ preventScroll: true });
  }, [focusReady]);
  return createPortal(<div className="dialog-backdrop attribute-editor-backdrop" role="presentation" onClick={(event) => {
    if (!busy && event.target === event.currentTarget) onClose();
  }}>
    <section className="dialog attribute-editor-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab") {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex='0']") ?? []);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); dialog.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
      }
    }}>
      <button className="icon-button dialog-close" type="button" aria-label="Close editor" onClick={onClose} disabled={busy}><X size={20} /></button>
      <h2 id={titleId}>{title}</h2>
      {children}
    </section>
  </div>, document.body);
}
