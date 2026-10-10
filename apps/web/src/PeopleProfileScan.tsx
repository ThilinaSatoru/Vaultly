import { useEffect, useRef, useState } from "react";
import { api } from "./media";
import { LogView } from "./LogView";

interface ProfileScan {
  available: boolean; status: "idle" | "running" | "completed" | "cancelled" | "failed";
  total: number; processed: number; updated: number; currentName: string | null; error?: string; startedAt?: string;
  results: Array<{ id: number; name: string; outcome: string; message?: string }>;
}
const outcomeLabels: Record<string, string> = { updated: "Photo saved", existing: "Kept existing photo", "not-found": "No exact match", ambiguous: "Multiple matches — choose manually", changed: "Person changed during scan", error: "Could not download" };

export function PeopleProfileScan({ onChanged }: { onChanged: () => void }) {
  const [report, setReport] = useState<ProfileScan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refreshed = useRef("");
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<ProfileScan>("/api/people/profile-scan");
        if (stopped) return;
        setReport(next);
        if (next.status !== "running" && next.status !== "idle" && next.startedAt && refreshed.current !== next.startedAt) {
          refreshed.current = next.startedAt; onChangedRef.current();
        }
        if (next.available) timer = setTimeout(poll, 2000);
      } catch (requestError) { if (!stopped) setError(requestError instanceof Error ? requestError.message : "Could not load scan status."); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  const action = async (cancel = false) => {
    setBusy(true); setError("");
    try { setReport(await api<ProfileScan>(`/api/people/profile-scan${cancel ? "/cancel" : ""}`, { method: "POST" })); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not update scan."); }
    finally { setBusy(false); }
  };
  return <section className="people-profile-scan" aria-label="Find profile images">
    <div className="people-profile-scan-heading"><div><strong>Find profile images</strong><p>Check existing people against both performer directories. Exact names and listed aliases match; existing photos are kept.</p></div>
      {report?.status === "running" ? <button className="secondary-button" disabled={busy} onClick={() => void action(true)}>Cancel scan</button> : <button className="secondary-button" disabled={busy || !report?.available} onClick={() => void action()}>Scan all existing people</button>}
    </div>
    {report && !report.available && <p>Open the desktop app to run the browser scraper.</p>}
    {report && report.status !== "idle" && <div role="status"><p>{report.status === "running" ? `Checking ${report.currentName ?? "directories"}…` : `Scan ${report.status}.`} {report.processed} / {report.total} people checked · {report.updated} photos saved.</p><progress value={report.processed} max={Math.max(1, report.total)} aria-label="Profile scan progress" /></div>}
    {(error || report?.error) && <p className="page-error" role="alert">{error || report?.error}</p>}
    {Boolean(report?.results.length) && <details><summary>View scan results</summary><LogView revision={report!.processed} label="Profile scan results"><ul>{report!.results.map((row) => <li key={row.id}><strong>{row.name}</strong> — {outcomeLabels[row.outcome] ?? row.outcome}{row.message && <p>{row.message}</p>}</li>)}</ul></LogView></details>}
  </section>;
}
