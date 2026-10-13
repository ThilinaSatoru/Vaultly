import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { api, formatCount } from "./media";

interface Progress { status: "running" | "completed" | "failed"; processed: number; total: number; removed: number; added: number; error?: string }
export function PeopleMatchingRepair({ onChanged }: { onChanged: () => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = useRef(onChanged); changed.current = onChanged;
  const running = progress?.status === "running";
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Progress | null>("/api/people/matching/repair");
        if (stopped) return;
        setProgress(next);
        if (next?.status === "running") timer = setTimeout(() => void poll(), 1000);
        else if (next?.status === "completed" || running) changed.current();
      } catch (reason) { if (!stopped) { setError(reason instanceof Error ? reason.message : "Could not load matching progress."); if (running) timer = setTimeout(() => void poll(), 2000); } }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [running]);
  const repair = async () => {
    setBusy(true); setError("");
    try { setProgress(await api<Progress>("/api/people/matching/repair", { method: "POST" })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not repair people matches."); }
    finally { setBusy(false); }
  };
  return <section className="people-repair" aria-label="Strict people matching">
    <button type="button" className="secondary-button" disabled={busy || running} onClick={() => void repair()}>{busy || running ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{running ? "Repairing people matches…" : "Repair people matches"}</button>
    <p>Use complete names or unique aliases. Removes old mismatches and preserves new manual credits.</p>
    {progress && <span role="status">{running ? `${formatCount(progress.processed)} / ${formatCount(progress.total)} items` : progress.status === "completed" ? `${formatCount(progress.removed)} incorrect links removed · ${formatCount(progress.added)} correct links added` : progress.error}</span>}
    {error && <span role="alert">{error}</span>}
  </section>;
}
