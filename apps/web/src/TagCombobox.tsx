import { ClearableInput } from "./ClearableField";
import { Check, ChevronDown, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Tag } from "./media";
import { AttributeBadge, AttributeMediaContext } from "./AttributeBadge";
import type { AttributeKind } from "./attribute-navigation";
import { searchAttributes } from "./attribute-search";
import { AttributeManagerContext } from "./attribute-manager";

interface TagComboboxProps {
  label: string;
  tags: Tag[];
  options?: Tag[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  onCreate?: (name: string) => Promise<Tag>;
  disabled?: boolean;
  placeholder?: string;
  attributeKind: AttributeKind;
}

export function TagCombobox({ label, tags, options, selectedIds, onChange, onCreate, disabled, attributeKind, placeholder = "Search tags" }: TagComboboxProps) {
  const manager = useContext(AttributeManagerContext);
  const mediaType = useContext(AttributeMediaContext);
  const managerKind = attributeKind === "tag" ? "tags" : attributeKind === "category" ? "categories" : attributeKind === "cast" || attributeKind === "artist" ? "people" : null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [placement, setPlacement] = useState<{ top: number; left: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreInputFocus = useRef(false);
  const listId = useRef(`tag-list-${Math.random().toString(36).slice(2)}`).current;
  const selectedSet = new Set(selectedIds);
  const selected = tags.filter((tag) => selectedSet.has(tag.id));
  const matches = useMemo(() => open ? searchAttributes(options ?? tags, query) : [], [options, tags, query, open]);
  const filtered = matches.slice(0, 100);
  const canCreate = Boolean(onCreate && query.trim() && !tags.some((tag) => tag.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase()));
  useEffect(() => { setActiveIndex(0); }, [query, tags]);
  useEffect(() => { menuRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);
  useEffect(() => {
    if (!restoreInputFocus.current || disabled || creating) return;
    restoreInputFocus.current = false;
    inputRef.current?.focus({ preventScroll: true });
  }, [disabled, creating]);

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
      // Wait for React to enable the input after creation and any assignment save.
      restoreInputFocus.current = true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create tag.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="tag-combobox" ref={rootRef}>
      <div className="tag-combobox-heading"><span className="tag-combobox-label">{label}</span>{manager && managerKind && <button type="button" className="attribute-manage-link" disabled={disabled} aria-label={`Manage ${managerKind === "people" ? "cast and artists" : managerKind}`} onClick={() => { setOpen(false); manager.open(managerKind, mediaType ?? (attributeKind === "cast" ? "video" : undefined)); }}><SlidersHorizontal size={13} /> Manage</button>}</div>
      <div className={`tag-combobox-control${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`} onClick={() => { if (!disabled && !creating) { setOpen(true); inputRef.current?.focus(); } }}>
        {selected.map((tag) => (
          <span className="tag-badge-selected" key={tag.id}>
            <AttributeBadge kind={attributeKind} {...tag} disabled={disabled} onBrowse={() => setOpen(false)} />
            <button className="tag-badge-remove" type="button" onClick={(event) => { event.stopPropagation(); toggle(tag.id); }} disabled={disabled} aria-label={`Remove ${tag.name}`}><X size={12} /></button>
          </span>
        ))}
        <Search size={15} className="tag-combobox-search-icon" />
        <ClearableInput
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-activedescendant={open && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setError(""); }}
          onKeyDown={(event) => {
            if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) event.stopPropagation();
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActiveIndex((value) => Math.max(0, Math.min(filtered.length - 1, value + (event.key === "ArrowDown" ? 1 : -1)))); }
            if (event.key === "Tab") setOpen(false);
            if (event.key === "Escape") { event.stopPropagation(); setOpen(false); inputRef.current?.blur(); }
            if (event.key === "Enter") {
              event.preventDefault();
              if (filtered.length > 0) toggle(filtered[Math.min(activeIndex, filtered.length - 1)].id);
              else if (canCreate) void create();
            }
            if (event.key === "Backspace" && !query && selectedIds.length > 0) toggle(selectedIds[selectedIds.length - 1]);
          }}
          placeholder={selected.length ? "Add more…" : placeholder}
          disabled={disabled || creating}
        />
        <button className="tag-combobox-toggle" type="button" disabled={disabled || creating} aria-label={`Show ${label.toLowerCase()} options`} aria-expanded={open} onClick={(event) => { event.stopPropagation(); if (open) setOpen(false); else { setOpen(true); inputRef.current?.focus(); } }}><ChevronDown size={15} /></button>
      </div>
      {open && !disabled && placement && createPortal(
        <div className="tag-combobox-menu" ref={menuRef} id={listId} role="listbox" aria-multiselectable="true" style={{ position: "fixed", top: placement.top, left: placement.left, right: "auto", width: placement.width, maxHeight: placement.maxHeight, transform: placement.above ? "translateY(-100%)" : undefined }}>
          {filtered.length === 0 && !canCreate && <p className="tag-combobox-empty">No matching options</p>}
          {filtered.map((tag, index) => (
            <button key={tag.id} id={`${listId}-${index}`} data-option-index={index} className={activeIndex === index ? "is-active" : undefined} type="button" role="option" aria-selected={selectedIds.includes(tag.id)} onMouseDown={(event) => event.preventDefault()} onPointerMove={() => setActiveIndex(index)} onClick={() => toggle(tag.id)}>
              <span>{tag.name}</span>{selectedIds.includes(tag.id) && <Check size={16} />}
            </button>
          ))}
          {matches.length > filtered.length && <p className="tag-combobox-empty">Showing {filtered.length} of {matches.length} options. Refine your search to find more.</p>}
          {canCreate && <button type="button" className="tag-create-option" onClick={() => void create()} disabled={creating}><Plus size={15} /> Create “{query.trim()}”</button>}
          {error && <p className="tag-combobox-error" role="alert">{error}</p>}
        </div>, document.body,
      )}
    </div>
  );
}
