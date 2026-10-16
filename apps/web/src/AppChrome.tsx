import { useEffect, useRef, useState } from "react";

export function useCompactHeader() {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.scrollY > 40);
  useEffect(() => {
    // Separate thresholds prevent a height change from toggling the header
    // repeatedly when scroll anchoring adjusts the page near the boundary.
    const update = () => setCompact((current) => window.scrollY > (current ? 8 : 40));
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => window.removeEventListener("scroll", update);
  }, []);
  return compact;
}

export function SidebarResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (next: number) => onResize(Math.max(200, Math.min(400, next)));
  return <div className="app-sidebar-resize" role="separator" tabIndex={0} aria-label="Resize navigation panel" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={400} aria-valuenow={width}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, width }; }}
    onPointerMove={(event) => { if (drag.current) resize(drag.current.width + event.clientX - drag.current.x); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); resize(width + (event.key === "ArrowRight" ? 10 : -10)); } }} />;
}
