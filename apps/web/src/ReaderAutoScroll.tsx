import { useEffect, useState, type RefObject } from "react";
import { Pause, Play } from "lucide-react";
import { readNumberPreference } from "./preferences";
import { vaultStorage } from "./vault-session";

export function ReaderAutoScroll({ scrollRef, enabled = true, contentKey }: { scrollRef: RefObject<HTMLElement | null>; enabled?: boolean; contentKey: number | string }) {
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(() => readNumberPreference("vaultly.reader.autoScrollSpeed", 12, 1, 100));
  useEffect(() => { setRunning(false); }, [contentKey, enabled]);
  useEffect(() => { vaultStorage.setItem("vaultly.reader.autoScrollSpeed", String(speed)); }, [speed]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!enabled || !running || !element) return;
    let frame = 0;
    let previous = performance.now();
    // Keep a fractional position: at slow speeds browsers round scrollTop.
    let position = element.scrollTop;
    const pause = () => setRunning(false);
    const visibility = () => { if (document.hidden) pause(); };
    const manualScroll = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Space"].includes(event.code)) pause(); };
    const animate = (now: number) => {
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      position += speed * Math.min(50, now - previous) / 1000;
      previous = now;
      element.scrollTo({ top: Math.min(position, maximum), behavior: "instant" });
      if (position >= maximum) { pause(); return; }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    element.addEventListener("wheel", pause, { passive: true });
    element.addEventListener("touchstart", pause, { passive: true });
    element.addEventListener("pointerdown", pause);
    element.addEventListener("keydown", pause);
    window.addEventListener("blur", pause);
    window.addEventListener("keydown", manualScroll);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("wheel", pause);
      element.removeEventListener("touchstart", pause);
      element.removeEventListener("pointerdown", pause);
      element.removeEventListener("keydown", pause);
      window.removeEventListener("blur", pause);
      window.removeEventListener("keydown", manualScroll);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [scrollRef, enabled, running, speed]);
  return <div className="reader-auto-scroll"><button type="button" disabled={!enabled} aria-pressed={running} onClick={() => setRunning((value) => !value)} title="Auto-scroll pauses when you interact with the reading area">{running ? <Pause size={16} /> : <Play size={16} />}{running ? "Pause scroll" : "Auto-scroll"}</button><label>Speed <input aria-label="Auto-scroll speed" type="range" min="1" max="100" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /><output>{speed} px/s</output></label></div>;
}
