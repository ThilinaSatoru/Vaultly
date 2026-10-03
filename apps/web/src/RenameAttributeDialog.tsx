import { useId, useState, type FormEvent } from "react";
import { AttributeEditorDialog } from "./AttributeEditorDialog";
import { api } from "./media";

export function RenameAttributeDialog({ kind, attribute, onClose, onSaved }: {
  kind: "tags" | "categories" | "people";
  attribute: { id: number; name: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(attribute.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();
  const label = kind === "tags" ? "Tag" : kind === "categories" ? "Category" : "Person";
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (saving || !nextName) return;
    if (nextName === attribute.name) { onClose(); return; }
    setSaving(true); setError("");
    try {
      await api(`/api/${kind}/${attribute.id}`, { method: "PATCH", body: JSON.stringify({ name: nextName }) });
      onSaved(); onClose();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not rename attribute."); }
    finally { setSaving(false); }
  };
  return <AttributeEditorDialog title={`Rename ${label.toLowerCase()}`} onClose={onClose} busy={saving} focusReady={!saving}>
    <form onSubmit={save}>
      <label htmlFor={inputId}>{label} name</label>
      <input id={inputId} value={name} onChange={(event) => setName(event.target.value)} maxLength={kind === "people" ? 100 : 80} disabled={saving} required />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save name"}</button></div>
    </form>
  </AttributeEditorDialog>;
}
