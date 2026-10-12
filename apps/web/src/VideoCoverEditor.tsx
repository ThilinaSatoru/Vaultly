import { useRef, useState } from "react";
import { api, type MediaItem } from "./media";
import { vaultUrl } from "./vault-session";

export function MediaCoverEditor({ item, onChanged }: { item: MediaItem; onChanged: (changes: Partial<MediaItem>) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (file?: File) => {
    setBusy(true); setError("");
    try {
      if (file && file.size > 5 * 1024 * 1024) throw new Error("Choose an image smaller than 5 MB.");
      let image = "";
      if (file) image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("Could not read this cover."));
        reader.readAsDataURL(file);
      });
      const result = await api<Partial<MediaItem>>(`/api/items/${item.id}/cover`, file ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) } : { method: "DELETE" });
      onChanged(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update the cover."); }
    finally { setBusy(false); }
  };
  return <div className="video-cover-editor">
    <h3>Cover image</h3>
    {item.has_cover ? <img alt={`${item.title} cover`} src={vaultUrl(`/api/items/${item.id}/thumbnail?cover=${encodeURIComponent(item.cover_signature ?? "")}`)} /> : null}
    <div><button className="secondary-button" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Saving…" : "Choose cover"}</button>
      {Boolean(item.custom_cover) && <button className="secondary-button" type="button" disabled={busy} onClick={() => void save()}>Use scanned cover / thumbnail</button>}</div>
    <input ref={input} type="file" className="visually-hidden" accept="image/png,image/jpeg,image/webp,image/avif" aria-label="Cover image" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void save(file); }} />
    <p className="detail-hint">Scans look for cover, poster, folder, front, fanart, banner or a matching media name in PNG, JPEG, WebP or AVIF. Gallery cards follow the cover’s portrait or landscape shape.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
