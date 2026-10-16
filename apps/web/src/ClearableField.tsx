import { type ComponentProps, useRef, useImperativeHandle } from "react";
import { X } from "lucide-react";

export function clearField(element: HTMLInputElement | HTMLTextAreaElement) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, "");
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.focus({ preventScroll: true });
}

export function ClearableInput({ ref, ...props }: ComponentProps<"input">) {
  const field = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => field.current!);
  const filled = props.value !== undefined && props.value !== "";
  return <span className={`clearable-field${filled ? " has-value" : ""}`}>
    <input {...props} ref={field} />
    {filled && !props.disabled && !props.readOnly && <button className="clear-field-button" type="button"
      aria-label={`Clear ${props["aria-label"] ?? props.placeholder ?? "field"}`} title="Clear field"
      onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (field.current) clearField(field.current); }}><X size={14} /></button>}
  </span>;
}

export function ClearableTextarea({ ref, ...props }: ComponentProps<"textarea">) {
  const field = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => field.current!);
  const filled = props.value !== undefined && props.value !== "";
  return <span className={`clearable-field clearable-field--multiline${filled ? " has-value" : ""}`}>
    <textarea {...props} ref={field} />
    {filled && !props.disabled && !props.readOnly && <button className="clear-field-button" type="button"
      aria-label={`Clear ${props["aria-label"] ?? props.placeholder ?? "field"}`} title="Clear field"
      onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (field.current) clearField(field.current); }}><X size={14} /></button>}
  </span>;
}
