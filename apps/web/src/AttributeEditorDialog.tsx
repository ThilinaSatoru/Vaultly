import { X } from "lucide-react";
import { useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ManagementPanelContext } from "./management-panel";

export function AttributeEditorDialog({ title, children, onClose, busy = false, focusReady = true, open = true, className = "", backdropClassName = "", focusSelector = "input:not(:disabled), textarea:not(:disabled)" }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  focusReady?: boolean;
  open?: boolean;
  className?: string;
  backdropClassName?: string;
  focusSelector?: string;
}) {
  const management = useContext(ManagementPanelContext);
  open = open && (management?.visible ?? true);
  const dialog = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    if (!management) document.body.style.overflow = "hidden";
    return () => {
      if (!management) document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, Boolean(management)]);
  useEffect(() => {
    if (!open) return;
    const input = focusReady ? dialog.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(focusSelector) : null;
    (input ?? dialog.current)?.focus({ preventScroll: true });
  }, [focusReady, open, focusSelector]);
  return createPortal(<div className={`dialog-backdrop attribute-editor-backdrop ${management ? "management-editor-window" : ""} ${backdropClassName}`} hidden={!open} inert={!open} role="presentation" onClick={(event) => {
    if (!management && !busy && event.target === event.currentTarget) onClose();
  }}>
    <section className={`dialog attribute-editor-dialog ${className}`} ref={dialog} tabIndex={-1} role="dialog" aria-modal={!management && open || undefined} aria-labelledby={titleId} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab" && !management) {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']") ?? []).filter((control) => control.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); dialog.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="attribute-editor-heading">
        <button className="icon-button dialog-close" type="button" aria-label="Close editor" onClick={onClose} disabled={busy}><X size={20} /></button>
        <h2 id={titleId}>{title}</h2>
      </div>
      {children}
    </section>
  </div>, document.body);
}
