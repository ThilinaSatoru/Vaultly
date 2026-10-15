import { LoaderCircle, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api } from "./media";

export interface MediaDeletionResult {
  deletedIds: number[];
  failures: Array<{ id: number; message: string }>;
}

export function DeleteMediaDialog({ itemIds, title, onDeleted, onClose }: {
  itemIds: number[];
  title?: string;
  onDeleted: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [remaining, setRemaining] = useState(itemIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => { if (!busy) onClose(); };
  const remove = async () => {
    if (busy || !remaining.length) return;
    setBusy(true); setError("");
    try {
      const result = await api<MediaDeletionResult>(remaining.length === 1 ? `/api/items/${remaining[0]}` : "/api/items/bulk-delete", {
        method: remaining.length === 1 ? "DELETE" : "POST",
        ...(remaining.length === 1 ? {} : { body: JSON.stringify({ itemIds: remaining }) }),
      });
      setRemaining((ids) => ids.filter((id) => !result.deletedIds.includes(id)));
      if (result.deletedIds.length) onDeleted(result.deletedIds);
      if (result.failures.length) setError(result.failures.map((failure) => `Item ${failure.id}: ${failure.message}`).join("\n"));
      else onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete media.");
    } finally { setBusy(false); }
  };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={close}>
    <section className="dialog" role="dialog" aria-modal="true" aria-label="Permanently delete media" aria-busy={busy} onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-button dialog-close" type="button" onClick={close} disabled={busy} aria-label="Close"><X size={19} /></button>
      <h2>Permanently delete {remaining.length === 1 ? "media" : `${remaining.length} items`}?</h2>
      {title && <p>{title}</p>}
      <p className="dialog-intro">The selected media files will be permanently deleted from disk and removed from your library database. This cannot be undone.</p>
      <p className="attribute-help">For folder-based comics, this deletes the image pages. Other files and subfolders are kept.</p>
      {error && <p className="form-error" role="alert" style={{ whiteSpace: "pre-wrap" }}>{error}</p>}
      <div className="dialog-actions">
        <button className="secondary-button" type="button" onClick={close} disabled={busy}>Cancel</button>
        <button className="danger-button" type="button" onClick={() => void remove()} disabled={busy || !remaining.length}>{busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{busy ? "Deleting…" : "Delete permanently"}</button>
      </div>
    </section>
  </div>;
}
