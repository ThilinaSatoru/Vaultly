import { useEffect, useRef, useState, type PointerEvent } from "react";
import { GripHorizontal, Maximize2, Minus, PictureInPicture2, X } from "lucide-react";
import { YoutubeEmbed, type YoutubePlayback } from "./YoutubeLibrary";

export function YoutubePlayer({ playback, floating, onToggleFloating, onClose }: {
  playback: YoutubePlayback;
  floating: boolean;
  onToggleFloating: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [minimized, setMinimized] = useState(false);
  const [width, setWidth] = useState(480);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const floatWidth = Math.min(width, viewport.width - 24, Math.max(360, (viewport.height - 150) * 16 / 9));
  const floatHeight = floatWidth * 9 / 16 + 106;
  const left = position ? Math.max(12, Math.min(position.x, viewport.width - floatWidth - 12)) : undefined;
  const top = position ? Math.max(12, Math.min(position.y, viewport.height - floatHeight - 12)) : undefined;
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!floating) panel.current?.focus({ preventScroll: true });
  }, [floating]);
  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (!floating || event.button !== 0 || (event.target as HTMLElement).closest("button, input")) return;
    const rect = panel.current!.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  // Keep the same embed and its ancestors mounted when switching display modes.
  return <div className={`youtube-playback-overlay${floating || minimized ? " is-floating" : ""}`} role="presentation" onClick={(event) => {
    if (!floating && !minimized && event.target === event.currentTarget) onToggleFloating();
  }}>
    <section ref={panel} className={`youtube-playback-window${floating || minimized ? " is-floating" : ""}${minimized ? " is-minimized" : ""}`} role="dialog" aria-modal={!floating} aria-label={`YouTube player: ${playback.name}`} tabIndex={-1}
      style={floating && !minimized ? { width: floatWidth, ...(position ? { left, top: `max(calc(var(--window-bar-height) + 12px), ${top}px)`, right: "auto", bottom: "auto" } : {}) } : undefined}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); if (!floating) onToggleFloating(); else onClose(); }
        if (event.key === "Tab" && !floating) {
          const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>("button, input, a[href], iframe") ?? []).filter((control) => control.getClientRects().length > 0);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="youtube-playback-heading" onPointerDown={startDrag} onPointerMove={(event) => {
        if (drag.current) setPosition({ x: drag.current.left + event.clientX - drag.current.x, y: drag.current.top + event.clientY - drag.current.y });
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {floating && <GripHorizontal size={16} aria-hidden="true" />}
        <strong title={playback.name}>{playback.name}</strong>
        <button className="secondary-button" type="button" aria-label={floating ? "Return YouTube to full view" : "Float YouTube player"} title={floating ? "Return to full player" : "Keep playing while browsing"} onClick={onToggleFloating}>
          {floating ? <Maximize2 size={16} /> : <PictureInPicture2 size={16} />}{floating ? "Full view" : "Float"}
        </button>
        <button className="icon-button" type="button" aria-label={minimized ? "Restore YouTube player" : "Minimize YouTube player"} title={minimized ? "Restore player" : "Minimize to the floating bar"} onClick={() => setMinimized((value) => !value)}>{minimized ? <Maximize2 size={17} /> : <Minus size={18} />}</button>
        <button className="icon-button" type="button" aria-label="Close YouTube player" onClick={onClose}><X size={19} /></button>
      </header>
      <YoutubeEmbed key={playback.key} playback={playback} />
      <label className="youtube-float-size" hidden={!floating || minimized}>Player size<input type="range" aria-label="YouTube floating player size" min={Math.min(360, viewport.width - 24)} max={Math.max(360, Math.min(800, viewport.width - 24))} step="10" value={floatWidth} onChange={(event) => setWidth(Number(event.target.value))} /></label>
    </section>
  </div>;
}
