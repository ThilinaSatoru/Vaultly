import { useEffect, useState, type RefObject } from "react";
import { Pause, Play } from "lucide-react";
import { matchesShortcut, readNumberPreference } from "./preferences";
import { vaultStorage } from "./vault-session";

export function ReaderAutoScroll({ scrollRef, enabled = true, contentKey }: { scrollRef: RefObject<HTMLElement | null>; enabled?: boolean; contentKey: number | string }) {
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(() => readNumberPreference("vaultly.reader.autoScrollSpeed", 12, 1, 100));
  useEffect(() => { setRunning(false); }, [contentKey, enabled]);
  useEffect(() => { vaultStorage.setItem("vaultly.reader.autoScrollSpeed", String(speed)); }, [speed]);
  useEffect(() => {
    if (!enabled) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matchesShortcut(event, "reader.autoScroll")) return;
      const target = event.target as HTMLElement | null;
      if (typeof target?.closest === "function") {
        if (target.closest("input, textarea, select, button, a, .shortcut-help-popover, [contenteditable], .dialog-backdrop, .management-drawer, .management-dock")) return;
        const viewer = target.closest(".viewer");
        if (viewer && viewer !== scrollRef.current?.closest(".viewer")) return;
      }
      event.preventDefault();
      if (!event.repeat) setRunning((value) => !value);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [enabled, scrollRef]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!enabled || !running || !element) return;
    let frame = 0;
    let previous = performance.now();
    // Keep a fractional position: at slow speeds browsers round scrollTop.
    let position = element.scrollTop;
    let heldPointer: number | null = null;
    const pause = () => setRunning(false);
    const hold = (event: PointerEvent) => { if (event.button === 0) heldPointer = event.pointerId; };
    const release = (event: PointerEvent) => {
      if (heldPointer !== event.pointerId) return;
      heldPointer = null; position = element.scrollTop; previous = performance.now();
    };
    const visibility = () => { if (document.hidden) pause(); };
    const manualScroll = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.code)) pause(); };
    const animate = (now: number) => {
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      if (heldPointer !== null) { previous = now; frame = requestAnimationFrame(animate); return; }
      position += speed * Math.min(50, now - previous) / 1000;
      previous = now;
      element.scrollTo({ top: Math.min(position, maximum), behavior: "instant" });
      if (position >= maximum) { pause(); return; }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    element.addEventListener("wheel", pause, { passive: true });
    element.addEventListener("touchstart", pause, { passive: true });
    element.addEventListener("pointerdown", hold);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", pause);
    window.addEventListener("keydown", manualScroll);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("wheel", pause);
      element.removeEventListener("touchstart", pause);
      element.removeEventListener("pointerdown", hold);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", pause);
      window.removeEventListener("keydown", manualScroll);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [scrollRef, enabled, running, speed]);
  return <div className="reader-auto-scroll"><button type="button" disabled={!enabled} aria-pressed={running} onClick={() => setRunning((value) => !value)} title="Space toggles auto-scroll. Hold the mouse button in the reading area to pause; release to continue.">{running ? <Pause size={16} /> : <Play size={16} />}{running ? "Pause scroll" : "Auto-scroll"}</button><label>Speed <input aria-label="Auto-scroll speed" type="range" min="1" max="100" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /><output>{speed} px/s</output></label></div>;
}
