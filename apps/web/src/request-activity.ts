export interface RequestActivity {
  id: string; label: string; detail: string; processed: number | null; total: number | null;
  target: "sources" | "people";
}
let sequence = 0;
let snapshot: RequestActivity[] = [];
const listeners = new Set<() => void>();
export const getRequestActivity = () => snapshot;
export const subscribeRequestActivity = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function beginRequestActivity(label: string, detail: string, target: RequestActivity["target"] = "sources") {
  const id = `request-${++sequence}`;
  snapshot = [...snapshot, { id, label, detail, target, processed: null, total: null }];
  listeners.forEach((listener) => listener());
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    snapshot = snapshot.filter((task) => task.id !== id);
    listeners.forEach((listener) => listener());
  };
  return Object.assign(finish, { update: (detail: string, processed: number | null = null, total: number | null = null) => {
    if (finished) return;
    snapshot = snapshot.map((task) => task.id === id ? { ...task, detail, processed, total } : task);
    listeners.forEach((listener) => listener());
  } });
}
