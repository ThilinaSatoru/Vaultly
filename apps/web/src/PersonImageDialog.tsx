import { useState, type ChangeEvent, type FormEvent } from "react";
import { AttributeEditorDialog } from "./AttributeEditorDialog";
import { api, type Person } from "./media";

export function PersonImageDialog({ person, onClose, onSaved }: { person: Person; onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [referrer, setReferrer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (input: { data: string } | { url: string; referrer?: string }) => {
    await api(`/api/people/${person.id}/image`, { method: "PUT", body: JSON.stringify(input) });
    onSaved(); onClose();
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true); setError("");
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Choose an image smaller than 10 MB.");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read that image."));
        reader.readAsDataURL(file);
      });
      await save({ data });
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not upload image."); }
    finally { setBusy(false); }
  };
  const fromUrl = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await save({ url: url.trim(), ...(referrer.trim() ? { referrer: referrer.trim() } : {}) }); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not download image."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError("");
    try { await api(`/api/people/${person.id}/image`, { method: "DELETE" }); onSaved(); onClose(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not remove image."); }
    finally { setBusy(false); }
  };
  return <AttributeEditorDialog title={`Profile image · ${person.name}`} onClose={onClose} busy={busy}>
    {person.profile_image && <img className="person-image-preview" src={`/api/people/${person.id}/image?v=${person.profile_image}`} alt={person.name} />}
    <p className="dialog-intro">Upload an image or download one from a URL. Images are saved on this computer and included in backups.</p>
    <label className="person-image-upload">Upload image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy} onChange={(event) => void upload(event)} /></label>
    <form className="category-form" onSubmit={(event) => void fromUrl(event)}><label htmlFor="person-image-url">Image URL</label><div><input id="person-image-url" type="url" placeholder="https://example.com/photo.jpg" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} required /></div><label htmlFor="person-image-referrer">Source page URL (optional)</label><div><input id="person-image-referrer" type="url" placeholder="Page where you found the image" value={referrer} onChange={(event) => setReferrer(event.target.value)} disabled={busy} /></div><p className="dialog-intro">Some sites require the gallery or page URL to allow image downloads.</p><button className="primary-button" type="submit" disabled={busy || !url.trim()}>Save image</button></form>
    <p className="dialog-intro">PNG, JPEG, GIF, or WebP · up to 10 MB.</p>
    {error && <p className="page-error" role="alert">{error}</p>}
    {busy && <p role="status">Saving image…</p>}
    {person.profile_image && <button className="secondary-button" type="button" disabled={busy} onClick={() => void remove()}>Remove image</button>}
  </AttributeEditorDialog>;
}
