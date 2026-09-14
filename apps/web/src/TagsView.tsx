import { Pencil, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { api, formatCount, type Tag } from "./media";

export function TagsView({ tags, onChanged }: { tags: Tag[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setWorking(true);
    setError("");
    try {
      await api("/api/tags", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setName("");
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not add tag.");
    } finally {
      setWorking(false);
    }
  };

  const rename = async (tag: Tag) => {
    const nextName = window.prompt("Tag name", tag.name)?.trim();
    if (!nextName || nextName === tag.name) return;
    setError("");
    try {
      await api(`/api/tags/${tag.id}`, { method: "PATCH", body: JSON.stringify({ name: nextName }) });
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not rename tag.");
    }
  };

  const remove = async (tag: Tag) => {
    if (!window.confirm(`Delete “${tag.name}”? Media files and items will not be deleted.`)) return;
    setError("");
    try {
      await api(`/api/tags/${tag.id}`, { method: "DELETE" });
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete tag.");
    }
  };

  return (
    <section className="categories-view">
      <div className="page-heading"><div><p className="eyebrow">Organize</p><h1>Tags</h1><p>Create tags here or directly from an item, then select several to filter your library.</p></div></div>
      <form className="category-form" onSubmit={add}>
        <label htmlFor="new-tag">New tag</label>
        <div><input id="new-tag" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Favorites" maxLength={80} /><button className="primary-button" type="submit" disabled={working || !name.trim()}><Plus size={18} /> Add</button></div>
      </form>
      {error && <p className="page-error" role="alert">{error}</p>}
      <div className="category-list">
        {tags.length === 0 ? <div className="category-empty">No tags yet. Create one here or while editing an item.</div> : tags.map((tag) => (
          <div className="category-row" key={tag.id}>
            <div className="category-symbol"><TagIcon size={20} /></div>
            <div><strong><span className="tag-badge">{tag.name}</span></strong><span>{formatCount(tag.item_count ?? 0)} items</span></div>
            <button className="icon-button" type="button" title="Rename" aria-label={`Rename ${tag.name}`} onClick={() => rename(tag)}><Pencil size={17} /></button>
            <button className="icon-button danger-icon" type="button" title="Delete" aria-label={`Delete ${tag.name}`} onClick={() => remove(tag)}><Trash2 size={17} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
