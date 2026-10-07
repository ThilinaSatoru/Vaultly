import { AttributePatterns } from "./AttributePatterns";
import { AttributePatternSummary, useAttributeList } from "./AttributeManagerTools";
import { RenameAttributeDialog } from "./RenameAttributeDialog";
import { AttributeBadge } from "./AttributeBadge";
import { PersonImageDialog } from "./PersonImageDialog";
import { PeopleProfileScan } from "./PeopleProfileScan";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api, formatCount, type Person } from "./media";

export function PeopleView({ people, onChanged, allowBrowse = true }: { people: Person[]; onChanged: () => void; allowBrowse?: boolean }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [renaming, setRenaming] = useState<Person | null>(null);
  const [imagePerson, setImagePerson] = useState<Person | null>(null);
  const { filtered, tools } = useAttributeList(people, (person) => (person.cast_count ?? 0) + (person.artist_count ?? 0));

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

  const remove = async (person: Person) => {
    if (!window.confirm(`Delete “${person.name}” from metadata? Media files will not be deleted.`)) return;
    setError("");
    try { await api(`/api/people/${person.id}`, { method: "DELETE" }); onChanged(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not delete person."); }
  };

  return <section className="categories-view">
    <div className="page-heading"><div><p className="eyebrow">Organize</p><h1>Cast & artists</h1><p>One shared list of people: Cast for videos, Artists for comics and stories. Search names and patterns, or customize matching below.</p></div></div>
    <form className="category-form" onSubmit={add}><label htmlFor="new-person">New person</label><div><input id="new-person" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" maxLength={100} /><button className="primary-button" type="submit" disabled={working || !name.trim()}><Plus size={18} /> Add</button></div></form>
    {error && <p className="page-error" role="alert">{error}</p>}
    <PeopleProfileScan onChanged={onChanged} />
    {tools}
    <div className="category-list">{people.length === 0 ? <div className="category-empty">No people yet. Add one here or while editing an item.</div> : filtered.length === 0 ? <div className="category-empty">No people match. Try another search or filter.</div> : filtered.map((person) =>
      <div className="category-row" key={person.id}><button type="button" className="category-symbol person-avatar" title={`Set profile image for ${person.name}`} aria-label={`Set profile image for ${person.name}`} onClick={() => setImagePerson(person)}>{person.profile_image ? <img src={`/api/people/${person.id}/image?v=${person.profile_image}`} alt="" /> : <Users size={20} />}</button><div><div className="attribute-badges">{allowBrowse ? <AttributeBadge kind="artist" {...person} /> : <span className="tag-badge">{person.name}</span>}</div><span>{formatCount(person.cast_count ?? 0)} cast · {formatCount(person.artist_count ?? 0)} artist credits</span><AttributePatternSummary patterns={person.patterns} /></div>
        <AttributePatterns kind="people" attribute={person} onChanged={onChanged} />
            <button className="icon-button" type="button" title="Rename" aria-label={`Rename ${person.name}`} onClick={() => setRenaming(person)}><Pencil size={17} /></button>
        <button className="icon-button danger-icon" type="button" title="Delete" aria-label={`Delete ${person.name}`} onClick={() => void remove(person)}><Trash2 size={17} /></button></div>)}</div>
    {renaming && <RenameAttributeDialog kind="people" attribute={renaming} onClose={() => setRenaming(null)} onSaved={onChanged} />}
    {imagePerson && <PersonImageDialog person={imagePerson} onClose={() => setImagePerson(null)} onSaved={onChanged} />}
  </section>;
}
