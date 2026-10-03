import { ListFilter, LoaderCircle, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "./media";

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
  }, [open, endpoint]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await api(endpoint, { method: "PUT", body: JSON.stringify({ patterns: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }) });
      onChanged(); setOpen(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save patterns."); }
    finally { setSaving(false); }
  };
  return <>
    <button className="secondary-button attribute-pattern-button" type="button" title="Edit matching patterns" aria-label={`Patterns for ${attribute.name}`} onClick={() => setOpen(true)}><ListFilter size={16} /> Patterns</button>
    {open && <div className="dialog-backdrop" role="presentation" onMouseDown={() => { if (!saving) setOpen(false); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label={`Patterns for ${attribute.name}`} onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button dialog-close" type="button" aria-label="Close patterns" onClick={() => setOpen(false)} disabled={saving}><X size={20} /></button>
        <h2>Patterns for {attribute.name}</h2>
        <p className="dialog-intro">Add alternative spellings, names, or synonyms, one per line. Any matching phrase in a filename assigns “{attribute.name}”. Its original name also matches.</p>
        <form onSubmit={save}>
          <label htmlFor={`patterns-${kind}-${attribute.id}`}>Alternative words or phrases (optional)</label>
          <textarea id={`patterns-${kind}-${attribute.id}`} className="attribute-pattern-input" rows={7} value={text} onChange={(event) => setText(event.target.value)} placeholder={"One synonym per line"} disabled={!loaded || loading || saving} maxLength={10100} />
          <p className="attribute-help">Matches ignore case, accents, and punctuation and use complete words. Rescan sources to apply changes to indexed files.{kind === "people" && " People keep their existing cast or artist roles."}</p>
          {loading && <p><LoaderCircle className="spin" size={16} /> Loading patterns…</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!loaded || loading || saving}>{saving ? "Saving…" : "Save patterns"}</button></div>
        </form>
      </section>
    </div>}
  </>;
}
