import { Activity, Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, formatCount } from "./media";

export interface BackgroundTask {
  id: string; label: string; detail: string; processed: number | null; total: number | null;
  target: "sources" | "people";
}

export function BackgroundStatusView({ tasks, available, onOpen }: { tasks: BackgroundTask[]; available: boolean | null; onOpen: (target: BackgroundTask["target"]) => void }) {
  const label = available === false ? "Status unavailable" : available === null ? "Checking activity" : tasks.length ? `${tasks.length} running` : "No tasks running";
  return <section className={`sidebar-status${tasks.length ? " is-running" : ""}`} aria-label="Background activity">
    <button className="sidebar-status-heading" type="button" onClick={() => onOpen(tasks[0]?.target ?? "sources")} title={label} aria-label={`Background activity: ${label}`}>
      {tasks.length ? <LoaderCircle className="spin" size={14} /> : available ? <Check size={14} /> : <Activity size={14} />}
      <span>{label}</span>{tasks.length > 0 && <small>{tasks.length}</small>}
    </button>
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
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      let delay = 3000;
      try {
        const next = await api<BackgroundTask[]>("/api/activity", { signal: controller.signal });
        if (stopped) return;
        setTasks(next); setAvailable(true);
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
  return <BackgroundStatusView tasks={tasks} available={available} onOpen={onOpen} />;
}
