import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export interface NavigationEntry {
  id: string;
  pageId?: string;
  label: string;
  fields: Record<string, unknown>;
  scroll: { x: number; y: number };
  breadcrumbs: Array<{ id: string; label: string; viewer?: boolean }>;
}

export function nextEntry(current: NavigationEntry, fields: Record<string, unknown>, label: string): NavigationEntry {
  const id = crypto.randomUUID();
  return {
    id, pageId: fields.selectedItemId != null ? current.pageId ?? current.id : id,
    label, fields: { ...current.fields, ...fields },
    scroll: fields.selectedItemId != null ? current.scroll : { x: 0, y: 0 },
    breadcrumbs: [...current.breadcrumbs, { id: current.id, label: current.label, ...(current.fields.selectedItemId != null ? { viewer: true } : {}) }],
  };
}

export function useNavigation() {
  const [entry, setEntry] = useState<NavigationEntry>(() => window.history.state?.vaultly ?? {
    id: crypto.randomUUID(), label: "Home", fields: {}, scroll: { x: 0, y: 0 }, breadcrumbs: [],
  });
  const current = useRef(entry);
  const commit = (next: NavigationEntry, push = false) => {
    current.current = next;
    window.history[push ? "pushState" : "replaceState"]({ ...window.history.state, vaultly: next }, "");
    setEntry(next);
  };
  const saveScroll = () => {
    const next = { ...current.current, scroll: { x: window.scrollX, y: window.scrollY } };
    current.current = next;
    window.history.replaceState({ ...window.history.state, vaultly: next }, "");
  };
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    window.history.replaceState({ ...window.history.state, vaultly: current.current }, "");
    const pop = (event: PopStateEvent) => {
      if (event.state?.vaultly) {
        current.current = event.state.vaultly;
        setEntry(event.state.vaultly);
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("scroll", saveScroll);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("scroll", saveScroll);
      window.history.scrollRestoration = previous;
    };
  }, []);
  useEffect(() => {
    // Wait for asynchronous galleries to have enough content before restoring.
    const { x, y } = entry.scroll;
    let frame = 0;
    const restore = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        window.scrollTo(x, y);
        if (document.documentElement.scrollHeight >= y + window.innerHeight) observer.disconnect();
      });
    };
    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true });
    restore();
    const stop = () => { observer.disconnect(); cancelAnimationFrame(frame); };
    window.addEventListener("wheel", stop, { once: true });
    window.addEventListener("pointerdown", stop, { once: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("wheel", stop); window.removeEventListener("pointerdown", stop); };
  }, [entry.id]);
  const update = (fields: Record<string, unknown>, label?: string) => {
    commit({ ...current.current, fields: { ...current.current.fields, ...fields }, label: label ?? current.current.label });
  };
  const push = (fields: Record<string, unknown>, label: string) => {
    saveScroll();
    commit(nextEntry(current.current, fields, label), true);
  };
  const reset = (fields: Record<string, unknown>, label: string) => {
    saveScroll();
    const id = crypto.randomUUID();
    commit({ id, pageId: id, label, fields, scroll: { x: 0, y: 0 }, breadcrumbs: [] }, true);
  };
  const back = () => { if (current.current.breadcrumbs.length) window.history.back(); };
  const goTo = (id: string) => {
    const index = current.current.breadcrumbs.findIndex((crumb) => crumb.id === id);
    if (index >= 0) window.history.go(index - current.current.breadcrumbs.length);
  };
  return { entry, current, update, push, reset, back, goTo };
}

export const NavigationContext = createContext<ReturnType<typeof useNavigation> | null>(null);

export function useNavigationField<T>(key: string, fallback: T, destination?: string): [T, Dispatch<SetStateAction<T>>] {
  const navigation = useContext(NavigationContext);
  const initial = useRef(fallback);
  if (!navigation) throw new Error("Navigation provider is required");
  const value = (key in navigation.entry.fields ? navigation.entry.fields[key] : initial.current) as T;
  const setValue: Dispatch<SetStateAction<T>> = (action) => {
    const previous = (key in navigation.current.current.fields ? navigation.current.current.fields[key] : initial.current) as T;
    const next = typeof action === "function" ? (action as (value: T) => T)(previous) : action;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    if (destination && next !== null) navigation.push({ [key]: next }, destination);
    else navigation.update({ [key]: next });
  };
  return [value, setValue];
}
