import { useId, useState, type FormEvent } from "react";
import { AttributeEditorDialog } from "./AttributeEditorDialog";
import { api, type MediaDetail } from "./media";

export type RenamedMedia = Pick<MediaDetail, "id" | "title" | "filename" | "file_extension" | "relative_path">;

export function RenameMediaDialog({ item, onClose, onSaved }: {
  item: MediaDetail;
  onClose: () => void;
  onSaved: (renamed: RenamedMedia) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();
  const extension = item.file_extension ? item.filename.slice(item.filename.lastIndexOf(".")) : "";
  const fileName = `${title.trim()}${extension}`;
  const rootFolder = item.relative_path === ".";
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !title.trim() || rootFolder) return;
    setSaving(true); setError("");
    try {
      const renamed = await api<RenamedMedia>(`/api/items/${item.id}/rename`, {
        method: "POST", body: JSON.stringify({ title: title.trim() }),
      });
      onSaved(renamed); onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not rename media.");
    } finally { setSaving(false); }
  };
  return <AttributeEditorDialog title="Rename title" onClose={onClose} busy={saving} focusReady={!saving}>
    <form onSubmit={save}>
      <label htmlFor={inputId}>Title</label>
      <input id={inputId} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255 - extension.length} disabled={saving || rootFolder} required />
      <p className="detail-hint">This also renames the {extension ? "file, keeping its extension" : "comic folder"}.</p>
      <p className="detail-hint">New {extension ? "file" : "folder"} name: <strong>{fileName}</strong></p>
      {rootFolder && <p className="form-error" role="alert">The library root folder cannot be renamed here. Rename the source instead.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="primary-button" type="submit" disabled={saving || !title.trim() || rootFolder}>{saving ? "Renaming…" : "Rename title"}</button>
      </div>
    </form>
  </AttributeEditorDialog>;
}
