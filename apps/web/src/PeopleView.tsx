import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api, formatCount, type Person } from "./media";

export function PeopleView({ people, onChanged }: { people: Person[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setWorking(true); setError("");
    try {
      await api("/api/people", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setName(""); onChanged();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not add person."); }
    finally { setWorking(false); }
  };

  const rename = async (person: Person) => {
    const nextName = window.prompt("Person name", person.name)?.trim();
    if (!nextName || nextName === person.name) return;
    setError("");
    try { await api(`/api/people/${person.id}`, { method: "PATCH", body: JSON.stringify({ name: nextName }) }); onChanged(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not rename person."); }
  };

  const remove = async (person: Person) => {
    if (!window.confirm(`Delete “${person.name}” from metadata? Media files will not be deleted.`)) return;
    setError("");
    try { await api(`/api/people/${person.id}`, { method: "DELETE" }); onChanged(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not delete person."); }
  };

  return <section className="categories-view">
    <div className="page-heading"><div><p className="eyebrow">Organize</p><h1>People</h1><p>Use people as cast or artists on any video, comic, or story.</p></div></div>
    <form className="category-form" onSubmit={add}><label htmlFor="new-person">New person</label><div><input id="new-person" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" maxLength={100} /><button className="primary-button" type="submit" disabled={working || !name.trim()}><Plus size={18} /> Add</button></div></form>
    {error && <p className="page-error" role="alert">{error}</p>}
    <div className="category-list">{people.length === 0 ? <div className="category-empty">No people yet. Add one here or while editing an item.</div> : people.map((person) =>
      <div className="category-row" key={person.id}><div className="category-symbol"><Users size={20} /></div><div><strong>{person.name}</strong><span>{formatCount(person.cast_count ?? 0)} cast · {formatCount(person.artist_count ?? 0)} artist credits</span></div>
        <button className="icon-button" type="button" title="Rename" aria-label={`Rename ${person.name}`} onClick={() => void rename(person)}><Pencil size={17} /></button>
        <button className="icon-button danger-icon" type="button" title="Delete" aria-label={`Delete ${person.name}`} onClick={() => void remove(person)}><Trash2 size={17} /></button></div>)}</div>
  </section>;
}
