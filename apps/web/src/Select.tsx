import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";

// Keep a real select for form submission, validation, and React change events.
// The visible control and popup share one keyboard-accessible interaction.
export function Select({ children, className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [label, setLabel] = useState("");
  const [accessibleLabel, setAccessibleLabel] = useState<string | undefined>(props["aria-label"]);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 180, maxHeight: 280 });
  const search = useRef({ text: "", time: 0 });
  const options = () => Array.from(native.current?.options ?? []);
  useLayoutEffect(() => {
    setLabel(native.current?.selectedOptions[0]?.textContent ?? "Choose…");
    const parentLabel = trigger.current?.closest("label")?.cloneNode(true) as HTMLElement | undefined;
    parentLabel?.querySelectorAll(".custom-select, input, button, svg").forEach((node) => node.remove());
    setAccessibleLabel(props["aria-label"] || parentLabel?.textContent?.trim() || undefined);
  });
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const choose = (index: number) => {
    const select = native.current;
    const option = options()[index];
    if (!select || !option || option.disabled) return;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };
  const show = () => {
    setActive(Math.max(0, native.current?.selectedIndex ?? 0));
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const height = Math.min(280, options().length * 38 + 12);
      const below = window.innerHeight - bounds.bottom - 12;
      const above = below < height && bounds.top > below;
      const maxHeight = Math.max(40, Math.min(height, above ? bounds.top - 12 : below));
      const width = Math.min(Math.max(bounds.width, 200), window.innerWidth - 24);
      setPosition({ top: above ? bounds.top - maxHeight - 6 : bounds.bottom + 6, left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)), width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  useEffect(() => { popup.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);
  return <div className={`custom-select ${className}`}>
    <select {...props} id={props.id ? `${props.id}-native` : undefined} ref={native} className="select-native" tabIndex={-1} aria-hidden="true" onInvalid={(event) => { event.preventDefault(); trigger.current?.focus(); show(); }} onChange={(event) => { props.onChange?.(event); setLabel(event.currentTarget.selectedOptions[0]?.textContent ?? ""); }}>{children}</select>
    <button ref={trigger} id={props.id} type="button" className="select-trigger" disabled={props.disabled} role="combobox" aria-label={accessibleLabel} aria-labelledby={props["aria-labelledby"]} aria-required={props.required} aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} title={props.title} onClick={() => open ? close() : show()} onBlur={(event) => { if (!popup.current?.contains(event.relatedTarget as Node)) setOpen(false); }} onKeyDown={(event) => {
      const list = options();
      if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === "Escape") { close(); return; }
        if (event.key === "Enter" || event.key === " ") { if (open) choose(active); else show(); return; }
        if (!open) show();
        const step = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
        let index = event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : (open ? active : native.current?.selectedIndex ?? 0) + step;
        while (index >= 0 && index < list.length && list[index].disabled) index += step;
        if (index >= 0 && index < list.length) setActive(index);
      } else if (event.key === "Tab") { setOpen(false); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.stopPropagation();
        const time = Date.now();
        search.current = { text: time - search.current.time < 700 ? search.current.text + event.key : event.key, time };
        const index = list.findIndex((option) => !option.disabled && option.text.toLowerCase().startsWith(search.current.text.toLowerCase()));
        if (index >= 0) { if (open) setActive(index); else choose(index); }
      }
    }}><span>{label}</span><ChevronDown size={15} /></button>
    {open && !props.disabled && createPortal(<div ref={popup} id={id} role="listbox" className="select-menu" aria-label={props["aria-label"] || label} style={{ position: "fixed", ...position }} onMouseDown={(event) => event.preventDefault()}>
      {options().map((option, index) => <div key={`${option.value}-${index}`} id={`${id}-${index}`} role="option" aria-selected={option.selected} aria-disabled={option.disabled} className={`${active === index ? "is-active" : ""}${option.selected ? " is-selected" : ""}`} data-index={index} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}><span>{option.text}</span>{option.selected && <Check size={15} />}</div>)}
    </div>, document.fullscreenElement ?? document.body)}
  </div>;
}
