import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Keyboard, Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatBinding, readBindings, readNumberPreference, type ShortcutAction } from "./preferences";
import { vaultStorage } from "./vault-session";
import { keyLabel, playerNames, playerShortcutGroups, type PlayerKind } from "./shortcut-help";

export function useShortcutBindings() {
  const [bindings, setBindings] = useState(readBindings);
  useEffect(() => {
    const refresh = () => setBindings(readBindings());
    window.addEventListener("vaultly-preferences-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("vaultly-preferences-changed", refresh); window.removeEventListener("storage", refresh); };
  }, []);
  return bindings;
}

function ShortcutIcon({ action }: { action: ShortcutAction }) {
  const Icon = action.endsWith("playPause") || action.endsWith("autoScroll") ? Play
    : action.endsWith("previous") || action.endsWith("previousPage") || action.includes("seekBack") ? ArrowLeft
      : action.endsWith("next") || action.endsWith("nextPage") || action.includes("seekForward") ? ArrowRight
        : action.endsWith("scrollUp") ? ArrowUp : action.endsWith("scrollDown") ? ArrowDown
          : action.endsWith("zoomIn") ? ZoomIn : action.endsWith("zoomOut") ? ZoomOut
            : action.endsWith("fullscreen") ? Maximize2 : action.endsWith("mute") ? VolumeX
              : action.includes("volume") ? Volume2 : action.endsWith("close") ? X : RotateCcw;
  return <Icon size={17} aria-hidden="true" />;
}

function seekDescription(large: boolean) {
  const amount = readNumberPreference(large ? "vaultly.video.seekLargeAmount" : "vaultly.video.seekAmount", large ? 1 : 5, .25, 999);
  const storedUnit = vaultStorage.getItem(large ? "vaultly.video.seekLargeUnit" : "vaultly.video.seekUnit");
  const unit = storedUnit === "minutes" || storedUnit === "seconds" ? storedUnit : large ? "minutes" : "seconds";
  return `${amount} ${amount === 1 ? unit.slice(0, -1) : unit}`;
}

export function ShortcutList({ kind }: { kind: PlayerKind }) {
  const bindings = useShortcutBindings();
  return <div className="shortcut-help-groups">{playerShortcutGroups(kind).map((group) => <section className="shortcut-help-group" key={group.title}>
    <h3>{group.title}</h3>
    <dl>{group.actions.map(({ action, label }) => <div className="shortcut-help-row" key={action}>
      <dt><ShortcutIcon action={action} /><span>{label}{action.includes("seek") && <small>{seekDescription(action.includes("Large"))}</small>}</span></dt>
      <dd>{bindings[action].length ? bindings[action].map((binding, index) => <span className="shortcut-help-alternative" key={binding}>
        {index > 0 && <span className="shortcut-help-or">or</span>}<span className="shortcut-help-combination" aria-label={formatBinding(binding)}>{binding.split("+").map((key, keyIndex) => <span className="shortcut-help-key" key={`${key}-${keyIndex}`}>{keyIndex > 0 && <span aria-hidden="true">+</span>}<kbd>{keyLabel(key)}</kbd></span>)}</span>
      </span>) : <span className="shortcut-help-unassigned">Not assigned</span>}</dd>
    </div>)}</dl>
  </section>)}</div>;
}

export function ShortcutHelp({ kind }: { kind: PlayerKind }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 380, maxHeight: 500 });
  const close = (restoreFocus = true) => { setOpen(false); if (restoreFocus) trigger.current?.focus({ preventScroll: true }); };

  useLayoutEffect(() => {
    if (!open) return;
    popup.current?.showPopover?.();
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(380, window.innerWidth - 24);
      const maxHeight = Math.min(540, window.innerHeight - 24);
      const height = Math.min(popup.current?.scrollHeight ?? maxHeight, maxHeight);
      const below = window.innerHeight - bounds.bottom - 12;
      const top = below >= height ? bounds.bottom + 8 : bounds.top - height - 8;
      setPosition({ width, maxHeight, top: Math.max(12, Math.min(top, window.innerHeight - height - 12)), left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)) });
    };
    place();
    popup.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false);
    };
    const fullscreen = () => close();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("fullscreenchange", fullscreen);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("fullscreenchange", fullscreen);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const host = open ? trigger.current?.closest(".video-player, .viewer") ?? document.body : null;
  return <div className="shortcut-help">
    <button ref={trigger} type="button" className="shortcut-help-trigger" aria-label={`${playerNames[kind]} keyboard shortcuts`} title="Keyboard shortcuts & help" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? close() : setOpen(true)}><Keyboard size={18} aria-hidden="true" /><span>Keys</span></button>
    {open && createPortal(<div ref={popup} id={id} popover="manual" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`} tabIndex={-1} className="shortcut-help-popover" style={position} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); close(); }
    }} onWheel={(event) => event.stopPropagation()} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node) && !trigger.current?.contains(event.relatedTarget as Node)) close(false); }}>
      <header className="shortcut-help-heading"><span className="shortcut-help-heading-icon"><Keyboard size={22} aria-hidden="true" /></span><div><h2 id={`${id}-title`}>{playerNames[kind]}</h2><p>Keyboard shortcuts</p></div><button className="icon-button" type="button" aria-label="Close shortcut help" onClick={() => close()}><X size={18} /></button></header>
      <p className="shortcut-help-hint" id={`${id}-hint`}>Your current key bindings. Click the media area before using them.</p>
      <ShortcutList kind={kind} />
      <div className="shortcut-help-tip"><Pause size={16} aria-hidden="true" /><span>{kind === "video" ? "Scroll over the video to adjust volume. Fullscreen Escape first returns to the window." : "Hold the scroll keys to keep moving. Auto-scroll works when the page can scroll."}</span></div>
      <p className="shortcut-help-footer">Change keys in Settings → {kind === "video" ? "Video player" : kind === "comic" ? "Comic reader or PDF reader" : "PDF reader"}. Close and collection keys are under Viewer and collections. Collection navigation needs adjacent items.</p>
    </div>, document.fullscreenElement ?? host!)}
  </div>;
}
