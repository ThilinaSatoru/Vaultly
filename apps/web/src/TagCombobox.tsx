import { Check, Plus, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Tag } from "./media";

interface TagComboboxProps {
  label: string;
  tags: Tag[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  onCreate?: (name: string) => Promise<Tag>;
  disabled?: boolean;
  placeholder?: string;
}

export function TagCombobox({ label, tags, selectedIds, onChange, onCreate, disabled, placeholder = "Search tags" }: TagComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [placement, setPlacement] = useState<{ top: number; left: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useRef(`tag-list-${Math.random().toString(36).slice(2)}`).current;
  const selected = tags.filter((tag) => selectedIds.includes(tag.id));
  const filtered = tags.filter((tag) => tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const canCreate = Boolean(onCreate && query.trim() && !tags.some((tag) => tag.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase()));

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const bounds = rootRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const below = window.innerHeight - bounds.bottom - 8;
      const above = below < 180 && bounds.top > below;
      setPlacement({
        top: above ? bounds.top - 5 : bounds.bottom + 5,
        left: bounds.left,
        width: bounds.width,
        maxHeight: Math.min(250, Math.max(80, above ? bounds.top - 8 : below)),
        above,
      });
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  const toggle = (id: number) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
    setQuery("");
    inputRef.current?.focus();
  };

  const create = async () => {
    if (!onCreate || !canCreate || creating) return;
    setCreating(true);
    setError("");
    try {
      const tag = await onCreate(query.trim());
      onChange([...selectedIds, tag.id]);
      setQuery("");
      inputRef.current?.focus();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create tag.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="tag-combobox" ref={rootRef}>
      <span className="tag-combobox-label">{label}</span>
      <div className={`tag-combobox-control${open ? " is-open" : ""}`} onClick={() => { if (!disabled) inputRef.current?.focus(); }}>
        {selected.map((tag) => (
          <span className="tag-badge tag-badge-selected" key={tag.id}>
            {tag.name}
            <button type="button" onClick={(event) => { event.stopPropagation(); toggle(tag.id); }} disabled={disabled} aria-label={`Remove ${tag.name}`}><X size={12} /></button>
          </span>
        ))}
        <Search size={15} className="tag-combobox-search-icon" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setError(""); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.stopPropagation(); setOpen(false); inputRef.current?.blur(); }
            if (event.key === "Enter") {
              event.preventDefault();
              if (filtered.length > 0) toggle(filtered[0].id);
              else if (canCreate) void create();
            }
            if (event.key === "Backspace" && !query && selectedIds.length > 0) toggle(selectedIds[selectedIds.length - 1]);
          }}
          placeholder={selected.length ? "Add more…" : placeholder}
          disabled={disabled || creating}
        />
      </div>
      {open && !disabled && placement && createPortal(
        <div className="tag-combobox-menu" ref={menuRef} id={listId} role="listbox" aria-multiselectable="true" style={{ position: "fixed", top: placement.top, left: placement.left, right: "auto", width: placement.width, maxHeight: placement.maxHeight, transform: placement.above ? "translateY(-100%)" : undefined }}>
          {filtered.length === 0 && !canCreate && <p className="tag-combobox-empty">No matching options</p>}
          {filtered.map((tag) => (
            <button key={tag.id} type="button" role="option" aria-selected={selectedIds.includes(tag.id)} onClick={() => toggle(tag.id)}>
              <span>{tag.name}</span>{selectedIds.includes(tag.id) && <Check size={16} />}
            </button>
          ))}
          {canCreate && <button type="button" className="tag-create-option" onClick={() => void create()} disabled={creating}><Plus size={15} /> Create “{query.trim()}”</button>}
          {error && <p className="tag-combobox-error" role="alert">{error}</p>}
        </div>, document.body,
      )}
    </div>
  );
}
