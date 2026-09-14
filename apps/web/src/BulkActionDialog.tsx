import { LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { TagCombobox } from "./TagCombobox";
import { api, type Category, type Person, type SeriesSummary, type Tag } from "./media";

type BulkField = "tags" | "categories" | "series" | "cast" | "artists";

interface BulkActionDialogProps {
  itemIds: number[];
  tags: Tag[];
  categories: Category[];
  people: Person[];
  series: SeriesSummary[];
  onTagCreated: (name: string) => Promise<Tag>;
  onCategoryCreated: (name: string) => Promise<Category>;
  onPersonCreated: (name: string) => Promise<Person>;
  onSeriesCreated: (name: string) => Promise<SeriesSummary>;
  onClose: () => void;
  onDone: () => void;
}

const labels: Record<BulkField, string> = {
  tags: "Tags", categories: "Categories", series: "Series & sets", cast: "Cast", artists: "Artists",
};

export function BulkActionDialog({ itemIds, tags, categories, people, series, onTagCreated, onCategoryCreated, onPersonCreated, onSeriesCreated, onClose, onDone }: BulkActionDialogProps) {
  const [field, setField] = useState<BulkField>("tags");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [valueIds, setValueIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const options = field === "tags" ? tags : field === "categories" ? categories
    : field === "series" ? series.map((entry) => ({ id: entry.id, name: entry.title })) : people;
  const onCreate = mode === "remove" ? undefined : field === "tags" ? onTagCreated
    : field === "categories" ? onCategoryCreated : field === "series"
      ? async (name: string) => { const created = await onSeriesCreated(name); return { id: created.id, name: created.title }; }
      : onPersonCreated;

  const apply = async () => {
    if (!valueIds.length) { setError(`Choose at least one ${labels[field].toLowerCase()} entry.`); return; }
    setBusy(true); setError("");
    try {
      await api("/api/items/bulk", { method: "POST", body: JSON.stringify({ itemIds, field, mode, valueIds }) });
      onDone();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update selected media.");
    } finally { setBusy(false); }
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="dialog bulk-dialog" role="dialog" aria-modal="true" aria-label="Bulk edit selected media" onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
      <h2>Bulk edit {itemIds.length} {itemIds.length === 1 ? "item" : "items"}</h2>
      <p className="dialog-intro">Add or remove the chosen values on every selected item. Existing unrelated metadata stays intact.</p>
      <div className="bulk-action-fields">
        <label>Action<select value={mode} onChange={(event) => { setMode(event.target.value as "add" | "remove"); setValueIds([]); }}><option value="add">Add</option><option value="remove">Remove</option></select></label>
        <label>Metadata<select value={field} onChange={(event) => { setField(event.target.value as BulkField); setValueIds([]); }}><option value="tags">Tags</option><option value="categories">Categories</option><option value="series">Series & sets</option><option value="cast">Cast</option><option value="artists">Artists</option></select></label>
      </div>
      <TagCombobox label={`Choose ${labels[field].toLowerCase()}`} tags={options} selectedIds={valueIds} onChange={setValueIds} onCreate={onCreate} disabled={busy} placeholder={`Search ${labels[field].toLowerCase()}`} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="button" onClick={() => void apply()} disabled={busy || !valueIds.length}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{mode === "add" ? "Add" : "Remove"} {labels[field].toLowerCase()}</button></div>
    </section>
  </div>;
}
