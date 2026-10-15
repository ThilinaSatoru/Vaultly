import { Activity, Check, LoaderCircle } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getRequestActivity, subscribeRequestActivity } from "./request-activity";
import { api, formatCount } from "./media";

export interface BackgroundTask {
  id: string; label: string; detail: string; processed: number | null; total: number | null;
  target: "sources" | "people";
}
export interface SystemResources {
  cpuPercent: number; freeBytes: number; totalBytes: number; appBytes: number;
  activeProcesses: number; waitingProcesses: number; processLimit: number; lowMemory: boolean;
}

export function BackgroundStatusView({ tasks, available, onOpen, resources }: { tasks: BackgroundTask[]; available: boolean | null; onOpen: (target: BackgroundTask["target"]) => void; resources?: SystemResources | null }) {
  const label = tasks.length ? `${tasks.length} running` : available === false ? "Status unavailable" : available === null ? "Checking activity" : "No tasks running";
  return <section className={`sidebar-status${tasks.length ? " is-running" : ""}`} aria-label="Background activity">
    <button className="sidebar-status-heading" type="button" onClick={() => onOpen(tasks[0]?.target ?? "sources")} title={label} aria-label={`Background activity: ${label}`}>
      {tasks.length ? <LoaderCircle className="spin" size={14} /> : available ? <Check size={14} /> : <Activity size={14} />}
      <span>{label}</span>{tasks.length > 0 && <small>{tasks.length}</small>}
    </button>
    <p className="system-resources" role="status">Database {available === false ? "unreachable" : available === null ? "checking" : tasks.some((task) => task.id.startsWith("source-") || (task.id.startsWith("request-") && task.detail !== "Reading and validating JSON")) ? "processing changes" : "connected"}</p>
    {resources && <p className={`system-resources${resources.lowMemory ? " is-low" : ""}`}>
      CPU {resources.cpuPercent}% · {(resources.freeBytes / 1024 ** 3).toFixed(1)} GB free · API {Math.round(resources.appBytes / 1024 ** 2)} MB<br />
      {resources.activeProcesses} / {resources.processLimit} processes · {resources.waitingProcesses} waiting{resources.lowMemory && " · waiting for memory"}
    </p>}
    {tasks.length > 0 && <div className="sidebar-status-tasks">{tasks.map((task) => {
      const percent = task.total !== null && task.total > 0 && task.processed !== null ? Math.min(100, Math.max(0, Math.floor(task.processed / task.total * 100))) : undefined;
      const counts = task.processed !== null && task.total !== null ? `${formatCount(task.processed)} / ${formatCount(task.total)}` : "";
      return <button key={task.id} className="sidebar-status-task" type="button" onClick={() => onOpen(task.target)} title={`${task.label} · ${task.detail}${counts ? ` · ${counts}` : ""}`}>
        <span className="sidebar-status-task-name"><span className="sidebar-status-task-label">{task.label}</span><small>{percent === undefined ? counts : `${percent}%`}</small></span>
        <span className="sidebar-status-task-detail">{task.detail}{counts && percent !== undefined ? ` · ${counts}` : ""}</span>
        <span className={`sidebar-status-progress${percent === undefined ? " indeterminate" : ""}`} role="progressbar" aria-label={`${task.label}: ${task.detail}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={percent === undefined ? undefined : { width: `${percent}%` }} /></span>
      </button>;
    })}</div>}
  </section>;
}

export function BackgroundStatus({ onOpen }: { onOpen: (target: BackgroundTask["target"]) => void }) {
  const requests = useSyncExternalStore(subscribeRequestActivity, getRequestActivity, getRequestActivity);
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [resources, setResources] = useState<SystemResources | null>(null);
  useEffect(() => {
    const bridge = (window as Window & { vaultlyWindow?: { taskActivity?: (running: boolean) => void } }).vaultlyWindow;
    bridge?.taskActivity?.(requests.length > 0);
    if (bridge) return;
    if (!requests.length && !tasks.length) return;
    const confirmExit = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", confirmExit);
    return () => window.removeEventListener("beforeunload", confirmExit);
  }, [requests.length, tasks.length]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      let delay = 3000;
      try {
        const [next, usage] = await Promise.all([api<BackgroundTask[]>("/api/activity", { signal: controller.signal }), api<SystemResources>("/api/system/resources", { signal: controller.signal })]);
        if (stopped) return;
        setTasks(next); setAvailable(true);
        setResources(usage);
        if (next.length) delay = 1000;
      } catch {
        if (stopped) return;
        setAvailable(false); setTasks([]);
      }
      if (!stopped) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, []);
  return <BackgroundStatusView tasks={[...requests, ...tasks]} available={available} onOpen={onOpen} resources={resources} />;
}
