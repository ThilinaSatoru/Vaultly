import { Select } from "./Select";
import { useEffect, useRef, useState } from "react";
import { api } from "./media";
import { LogView } from "./LogView";

interface Progress {
  status: "running" | "completed" | "cancelled" | "failed";
  processed: number; total: number; converted: number; skipped: number;
  currentPath: string; errors: string[];
  logs?: string[];
  failed?: number;
}

export function SourceConversion({ sourceId, enabled, scanEnabled, scanBusy, expanded, onScan, onExpand, onChanged, onRunning }: {
  sourceId: number; enabled: boolean; scanEnabled: boolean; scanBusy: boolean; expanded: boolean;
  onScan: (englishAttributes: boolean) => Promise<void>; onExpand: () => void;
  onChanged: () => void; onRunning: (running: boolean) => void;
}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState("scan-all");
  const callbacks = useRef({ onChanged, onRunning });
  callbacks.current = { onChanged, onRunning };
  const running = progress?.status === "running";
  useEffect(() => { callbacks.current.onRunning(running || busy); }, [running, busy]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Progress | null>(`/api/sources/${sourceId}/conversion`);
        if (stopped) return;
        setProgress(next);
        if (next?.status === "running") timer = setTimeout(() => void poll(), 1500);
        else if (running) callbacks.current.onChanged();
      } catch (requestError) {
        if (!stopped) {
          setError(requestError instanceof Error ? requestError.message : "Could not load conversion progress.");
          if (running) timer = setTimeout(() => void poll(), 3000);
        }
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [sourceId, running]);
  const action = async (cancel = false) => {
    if (!cancel) {
      if (!expanded) onExpand();
      if (selection.startsWith("scan-")) {
        await onScan(selection === "scan-all");
        return;
      }
    }
    setBusy(true); setError("");
    try {
      setProgress(await api<Progress>(`/api/sources/${sourceId}/conversion${cancel ? "/cancel" : ""}`, {
        method: "POST", ...(!cancel && { body: JSON.stringify({ mode: selection }) }),
      }));
      callbacks.current.onChanged();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not convert videos."); }
    finally { setBusy(false); }
  };
  return <>
    <div className="source-operations">
      <Select aria-label="Scan or convert source" value={selection} onChange={(event) => setSelection(event.target.value)} disabled={busy || scanBusy || running}>
        <option value="scan-all" disabled={!scanEnabled}>Scan</option>
        <option value="quick" disabled={!enabled}>Convert (quick)</option>
        <option value="slow" disabled={!enabled}>Convert (slow)</option>
      </Select>
      <button className="secondary-button" type="button" disabled={busy || scanBusy || running || (selection.startsWith("scan-") ? !scanEnabled : !enabled)} onClick={() => void action()}>
        {busy || scanBusy ? "Working…" : "Run"}
      </button>
    </div>
    <div hidden={!expanded}>
      {progress && <section className="scan-progress" aria-label="Video conversion">
        <div className="scan-progress-heading"><strong>Video conversion</strong>
          {running && <button className="source-attributes-edit" disabled={busy} onClick={() => void action(true)}>{busy ? "Working…" : "Cancel conversion"}</button>}
        </div>
        <p>Converts unsupported video formats and codecs to MP4. Originals are replaced only after verification; library details are kept.</p>
        <div role="status">
          <p>{running ? `Converting: ${progress.currentPath || "checking videos"}` : `Conversion ${progress.status}.`} {progress.processed} / {progress.total} checked · {progress.converted} converted · {progress.skipped} skipped.</p>
          {running && <progress value={progress.processed} max={Math.max(1, progress.total)} aria-label="Conversion progress" />}
          {!!progress.logs?.length && <LogView revision={progress.logs.join("\n")} label="Conversion log">{progress.logs.map((line, index) => <p key={index}>{line}</p>)}</LogView>}
          {progress.errors.length > 0 && <details><summary>{progress.failed ?? progress.errors.length} conversion errors{(progress.failed ?? 0) > progress.errors.length && " (latest 100 shown)"}</summary><LogView revision={progress.errors.join("\n")} label="Conversion errors"><ul>{progress.errors.map((message, index) => <li key={index}>{message}</li>)}</ul></LogView></details>}
        </div>
      </section>}
    </div>
    {error && <p className="scan-error" role="alert">{error}</p>}
  </>;
}
