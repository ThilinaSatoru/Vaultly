import { getActiveProfile, getPreferenceRevision, vaultStorage } from "./vault-session";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export interface NavigationEntry {
  id: string;
  pageId?: string;
  label: string;
  fields: Record<string, unknown>;
  scroll: { x: number; y: number };
  breadcrumbs: Array<{ id: string; label: string; viewer?: boolean }>;
}

const navigationKey = "vaultly.ui.navigation";
export function persistNavigation(entry: NavigationEntry) {
  // Browser history IDs cannot be traversed in a new window. Keep the browsing
  // destination, filters and scroll, and let Continue watching reopen playback.
  const fields = { ...entry.fields, selectedItemId: null, viewerSeriesContext: null, viewerGalleryContext: null };
  const label = entry.fields.selectedItemId != null
    ? [...entry.breadcrumbs].reverse().find((crumb) => !crumb.viewer)?.label ?? "Library"
    : entry.label;
  vaultStorage.setItem(navigationKey, JSON.stringify({ label, fields, scroll: entry.scroll }));
}
export function restoredNavigation(): NavigationEntry {
  const fresh = { id: crypto.randomUUID(), label: "Home", fields: {}, scroll: { x: 0, y: 0 }, breadcrumbs: [] };
  try {
    const saved = JSON.parse(vaultStorage.getItem(navigationKey) ?? "null");
    if (saved && typeof saved.label === "string" && saved.fields && typeof saved.fields === "object" && !Array.isArray(saved.fields)) {
      return { ...fresh, label: saved.label, fields: { ...saved.fields, selectedItemId: null },
        scroll: { x: Number.isFinite(saved.scroll?.x) ? saved.scroll.x : 0, y: Number.isFinite(saved.scroll?.y) ? saved.scroll.y : 0 } };
    }
  } catch { /* Ignore a damaged or unavailable browser store. */ }
  return fresh;
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
  const [entry, setEntry] = useState<NavigationEntry>(() => window.history.state?.vaultly ?? restoredNavigation());
  const current = useRef(entry);
  const restoring = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const preferenceRevision = useRef(getPreferenceRevision());
  const persist = () => {
    // A backup restore or profile deletion replaces this session's preferences.
    // Its final pagehide/unmount must not write the old browsing state back.
    if (preferenceRevision.current === getPreferenceRevision()) persistNavigation(current.current);
  };
  const commit = (next: NavigationEntry, push = false) => {
    current.current = next;
    window.history[push ? "pushState" : "replaceState"]({ ...window.history.state, vaultly: next }, "");
    persist();
    setEntry(next);
  };
  const saveScroll = () => {
    // Loading a destination can clamp the window to the top. Keep its saved
    // position until the user takes control, including during history traversal.
    if (restoring.current === current.current.id) return;
    const next = { ...current.current, scroll: { x: window.scrollX, y: window.scrollY } };
    current.current = next;
    window.history.replaceState({ ...window.history.state, vaultly: next }, "");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 200);
  };
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    window.history.replaceState({ ...window.history.state, vaultly: current.current }, "");
    const pop = (event: PopStateEvent) => {
      if (getActiveProfile() && event.state?.vaultProfile !== getActiveProfile()?.id) {
        const fresh: NavigationEntry = { id: crypto.randomUUID(), label: "Home", fields: {}, scroll: { x: 0, y: 0 }, breadcrumbs: [] };
        window.history.replaceState({ vaultProfile: getActiveProfile()?.id, vaultly: fresh }, "");
        restoring.current = fresh.id;
        current.current = fresh; setEntry(fresh);
      } else if (event.state?.vaultly) {
        restoring.current = event.state.vaultly.id;
        current.current = event.state.vaultly;
        setEntry(event.state.vaultly);
      }
      persist();
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("scroll", saveScroll);
    const flush = () => { clearTimeout(saveTimer.current); persist(); };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("scroll", saveScroll);
      window.removeEventListener("pagehide", flush);
      flush();
      window.history.scrollRestoration = previous;
    };
  }, []);
  useLayoutEffect(() => {
    // Galleries may briefly fit the target, then collapse while fetching or
    // resize as artwork loads. Keep restoring through those layout changes.
    restoring.current = entry.id;
    const { x, y } = entry.scroll;
    let frame = 0;
    const restore = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (restoring.current !== entry.id) return;
        window.scrollTo({ left: x, top: y, behavior: "instant" });
      });
    };
    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(restore);
    resizeObserver.observe(document.body);
    restore();
    const disconnect = () => {
      observer.disconnect();
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
    };
    const stop = () => {
      disconnect();
      if (restoring.current !== entry.id) return;
      restoring.current = null;
      saveScroll();
    };
    const keydown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stop();
    };
    // Capture before a click handler pushes a new history entry.
    window.addEventListener("wheel", stop, { passive: true, capture: true });
    window.addEventListener("pointerdown", stop, true);
    window.addEventListener("touchstart", stop, { passive: true, capture: true });
    window.addEventListener("keydown", keydown, true);
    return () => {
      disconnect();
      window.removeEventListener("wheel", stop, true);
      window.removeEventListener("pointerdown", stop, true);
      window.removeEventListener("touchstart", stop, true);
      window.removeEventListener("keydown", keydown, true);
    };
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
