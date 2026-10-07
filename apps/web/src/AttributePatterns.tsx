import { ListFilter, LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "./media";
import { AttributeEditorDialog } from "./AttributeEditorDialog";

export function AttributePatterns({ kind, attribute, onChanged }: {
  kind: "tags" | "categories" | "people";
  attribute: { id: number; name: string };
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const endpoint = `/api/attributes/${kind}/${attribute.id}/patterns`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setLoaded(false); setError("");
    api<{ patterns: string[] }>(endpoint, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setText(data.patterns.join("\n")); setLoaded(true); } })
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load patterns."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, endpoint, loadAttempt]);
  const openEditor = () => {
    setText(""); setError(""); setLoaded(false); setLoading(true); setOpen(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!loaded || loading || saving) return;
    setSaving(true); setError("");
    try {
      await api(endpoint, { method: "PUT", body: JSON.stringify({ patterns: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }) });
      onChanged(); setOpen(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save patterns."); }
    finally { setSaving(false); }
  };
  return <>
    <button className="secondary-button attribute-pattern-button" type="button" title="Edit matching patterns" aria-label={`Patterns for ${attribute.name}`} onClick={openEditor}><ListFilter size={16} /> Patterns</button>
    {open && <AttributeEditorDialog title={`Patterns for ${attribute.name}`} onClose={() => setOpen(false)} busy={saving} focusReady={loaded && !loading && !saving}>
        <p className="dialog-intro">Add alternative spellings, names, or synonyms, one per line. Any matching phrase in a filename assigns “{attribute.name}”. Its original name also matches.</p>
        <p className="dialog-intro">Names and patterns with multiple words automatically match in any word order, with the words separated or joined together (for example, “Jane Doe”, “Doe Jane”, “JaneDoe”, or “DoeJane”). Rescan to apply matches to existing media.</p>
        <form onSubmit={save}>
          <label htmlFor={`patterns-${kind}-${attribute.id}`}>Alternative words or phrases (optional)</label>
          <textarea id={`patterns-${kind}-${attribute.id}`} className="attribute-pattern-input" rows={7} value={text} onChange={(event) => setText(event.target.value)} placeholder={"One synonym per line"} disabled={!loaded || loading || saving} maxLength={10100} />
          <p className="attribute-help">Matches ignore case, accents, and punctuation and use complete words. Rescan sources to apply changes to indexed files.{kind === "people" && " Matching people are Cast on videos and Artists on comics and stories."}</p>
          {loading && <p><LoaderCircle className="spin" size={16} /> Loading patterns…</p>}
          {error && <div className="form-error" role="alert"><p>{error}</p>{!loaded && <button className="secondary-button" type="button" onClick={() => { setLoading(true); setError(""); setLoadAttempt((attempt) => attempt + 1); }} disabled={loading}>Retry loading patterns</button>}</div>}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!loaded || loading || saving}>{saving ? "Saving…" : "Save patterns"}</button></div>
        </form>
    </AttributeEditorDialog>}
  </>;
}
