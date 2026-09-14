import { Folder, Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { api, formatCount, type Category } from "./media";

interface CategoriesViewProps {
  categories: Category[];
  onChanged: () => void;
}

export function CategoriesView({ categories, onChanged }: CategoriesViewProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setWorking(true);
    setError("");
    try {
      await api("/api/categories", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setName("");
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not add category.");
    } finally {
      setWorking(false);
    }
  };

  const rename = async (category: Category) => {
    const nextName = window.prompt("Category name", category.name)?.trim();
    if (!nextName || nextName === category.name) return;
    setError("");
    try {
      await api(`/api/categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ name: nextName }) });
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not rename category.");
    }
  };

  const remove = async (category: Category) => {
    if (!window.confirm(`Delete “${category.name}”? Media files and items will not be deleted.`)) return;
    setError("");
    try {
      await api(`/api/categories/${category.id}`, { method: "DELETE" });
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete category.");
    }
  };

  return (
    <section className="categories-view">
      <div className="page-heading"><div><p className="eyebrow">Organize</p><h1>Categories</h1><p>Create categories, then assign them to media from an item’s viewer.</p></div></div>
      <form className="category-form" onSubmit={add}>
        <label htmlFor="new-category">New category</label>
        <div><input id="new-category" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Favorites" maxLength={80} /><button className="primary-button" type="submit" disabled={working || !name.trim()}><Plus size={18} /> Add</button></div>
      </form>
      {error && <p className="page-error" role="alert">{error}</p>}
      <div className="category-list">
        {categories.length === 0 ? <div className="category-empty">No categories yet. Add one above to start organizing your library.</div> : categories.map((category) => (
          <div className="category-row" key={category.id}>
            <div className="category-symbol"><Folder size={20} /></div>
            <div><strong>{category.name}</strong><span>{formatCount(category.item_count)} items</span></div>
            <button className="icon-button" type="button" title="Rename" aria-label={`Rename ${category.name}`} onClick={() => rename(category)}><Pencil size={17} /></button>
            <button className="icon-button danger-icon" type="button" title="Delete" aria-label={`Delete ${category.name}`} onClick={() => remove(category)}><Trash2 size={17} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
