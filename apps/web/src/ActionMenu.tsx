import { MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuAction { label: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean }
export function ActionMenu({ label = "More actions", actions, contextTarget }: { label?: string; actions: MenuAction[]; contextTarget?: React.RefObject<HTMLElement | null> }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const close = (restore = true) => { setAnchor(null); if (restore) trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    const node = contextTarget?.current;
    if (!node) return;
    const context = (event: MouseEvent) => { event.preventDefault(); setAnchor({ x: event.clientX, y: event.clientY }); };
    node.addEventListener("contextmenu", context);
    return () => node.removeEventListener("contextmenu", context);
  }, [contextTarget]);
  useLayoutEffect(() => {
    if (!anchor) return;
    const bounds = menu.current?.getBoundingClientRect();
    setPosition({ top: Math.max(8, Math.min(anchor.y, window.innerHeight - (bounds?.height ?? 180) - 8)), left: Math.max(8, Math.min(anchor.x, window.innerWidth - 240 - 8)) });
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false); };
    const dismiss = () => close(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); };
  }, [anchor]);
  return <div className="action-menu-wrap"><button ref={trigger} className="action-menu-trigger" type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={() => { if (anchor) close(); else { const bounds = trigger.current!.getBoundingClientRect(); setAnchor({ x: bounds.right - 240, y: bounds.bottom + 6 }); } }}><MoreHorizontal size={18} /></button>
    {anchor && createPortal(<div ref={menu} role="menu" aria-label={label} className="context-menu" style={{ position: "fixed", ...position }} onKeyDown={(event) => {
      event.stopPropagation();
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") close();
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    }}><p>{label}</p>{actions.map((action) => <button key={action.label} type="button" role="menuitem" disabled={action.disabled} className={action.danger ? "danger" : undefined} onClick={() => { close(); action.onSelect(); }}>{action.icon}<span>{action.label}</span></button>)}</div>, document.fullscreenElement ?? document.body)}
  </div>;
}
