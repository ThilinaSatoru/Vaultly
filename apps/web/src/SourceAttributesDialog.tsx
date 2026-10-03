import { X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { TagCombobox } from "./TagCombobox";
import { api, type Category, type Tag } from "./media";

export interface SourceAttributeOptions {
  tags: Tag[];
  categories: Category[];
  onTagCreated: (name: string) => Promise<Tag>;
  onCategoryCreated: (name: string) => Promise<Category>;
}

export function SourceAttributeFields({ tags, categories, onTagCreated, onCategoryCreated, tagIds, categoryIds, onTagsChange, onCategoriesChange, disabled }: SourceAttributeOptions & {
  tagIds: number[];
  categoryIds: number[];
  onTagsChange: (ids: number[]) => void;
  onCategoriesChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  return <div className="source-attribute-fields">
    <TagCombobox attributeKind="tag" label="Common tags" tags={tags} selectedIds={tagIds} onChange={onTagsChange} onCreate={onTagCreated} disabled={disabled} placeholder="Choose or create tags" />
    <TagCombobox attributeKind="category" label="Common categories" tags={categories} selectedIds={categoryIds} onChange={onCategoriesChange} onCreate={onCategoryCreated} disabled={disabled} placeholder="Choose or create categories" />
    <p className="attribute-help">These attributes apply to every item in this source, including files in subfolders. You can keep adding individual attributes to each item.</p>
  </div>;
}

export function SourceAttributesDialog({ source, onClose, onSaved, ...options }: SourceAttributeOptions & {
  source: { id: number; name: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/sources/${source.id}/attributes`;
  useEffect(() => {
    const controller = new AbortController();
    api<{ tags: Tag[]; categories: Category[] }>(endpoint, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setTagIds(result.tags.map((tag) => tag.id)); setCategoryIds(result.categories.map((category) => category.id)); setLoaded(true); } })
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load attributes."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await api(endpoint, { method: "PUT", body: JSON.stringify({ tagIds, categoryIds }) });
      onSaved(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save common attributes."); }
    finally { setSaving(false); }
  };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={() => { if (!saving) onClose(); }}>
    <section className="dialog" role="dialog" aria-modal="true" aria-label={`Common attributes for ${source.name}`} onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="Close common attributes" disabled={saving}><X size={20} /></button>
      <h2>Common attributes</h2><p className="dialog-intro">{source.name}</p>
      <form onSubmit={save}>
        <SourceAttributeFields {...options} tagIds={tagIds} categoryIds={categoryIds} onTagsChange={setTagIds} onCategoriesChange={setCategoryIds} disabled={!loaded || loading || saving} />
        {loading && <p>Loading attributes…</p>}
        <p className="attribute-help">Changes update existing media immediately and apply to future scans. Removing a common attribute keeps any matching attribute assigned individually.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!loaded || loading || saving}>{saving ? "Saving…" : "Save attributes"}</button></div>
      </form>
    </section>
  </div>;
}
