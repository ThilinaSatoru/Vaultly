import { type RefObject, useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

export function ReaderFullscreen({ target }: { target: RefObject<HTMLElement | null> }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => setActive(document.fullscreenElement === target.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [target]);
  return <><button type="button" aria-label={active ? "Exit reader fullscreen" : "Open reader fullscreen"} title={active ? "Exit fullscreen" : "Fullscreen"}
    onClick={() => {
      const action = active ? document.exitFullscreen?.() : target.current?.requestFullscreen?.();
      if (!action) { setError("Fullscreen is unavailable in this window."); return; }
      void action.then(() => setError("")).catch(() => setError("Fullscreen is unavailable in this window."));
    }}>{active ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>{error && <span role="status">{error}</span>}</>;
}
