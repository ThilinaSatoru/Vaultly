import { useId, useState, type FormEvent } from "react";
import { ClearableInput } from "./ClearableField";
import { AttributeEditorDialog } from "./AttributeEditorDialog";
import { api, type Person } from "./media";

export function PersonProfileDialog({ person, onClose, onSaved }: { person: Person; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(person.name);
  const [gender, setGender] = useState(person.gender ?? "");
  const [country, setCountry] = useState(person.country ?? "");
  const [url, setUrl] = useState(person.profile_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/api/people/${person.id}`, { method: "PATCH", body: JSON.stringify({ name, gender, country, profile_url: url }) });
      onSaved(); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save profile."); }
    finally { setBusy(false); }
  };
  return <AttributeEditorDialog title={`Edit profile · ${person.name}`} onClose={onClose} busy={busy}>
    <form onSubmit={(event) => void save(event)}>
      <label htmlFor={`${id}-name`}>Name</label><ClearableInput id={`${id}-name`} value={name} maxLength={100} required disabled={busy} onChange={(event) => setName(event.target.value)} />
      <label htmlFor={`${id}-gender`}>Gender</label><ClearableInput id={`${id}-gender`} value={gender} maxLength={80} disabled={busy} onChange={(event) => setGender(event.target.value)} />
      <label htmlFor={`${id}-country`}>Country</label><ClearableInput id={`${id}-country`} value={country} maxLength={100} disabled={busy} onChange={(event) => setCountry(event.target.value)} />
      <label htmlFor={`${id}-url`}>Source profile URL</label><ClearableInput id={`${id}-url`} type="url" value={url} maxLength={2000} disabled={busy} onChange={(event) => setUrl(event.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save profile"}</button></div>
    </form>
  </AttributeEditorDialog>;
}
