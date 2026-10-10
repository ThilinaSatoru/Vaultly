import { Download, Keyboard, RotateCcw, Settings2, Upload, X } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { api } from "./media";
import { defaultBindings, eventBinding, formatBinding, readBindings, readBooleanPreference, readNumberPreference, type ShortcutAction, writeBindings, writePreference } from "./preferences";

const shortcutGroups: Array<{ title: string; actions: Array<{ action: ShortcutAction; label: string }> }> = [
  { title: "Viewer and collections", actions: [
    { action: "viewer.close", label: "Close viewer" }, { action: "series.previous", label: "Previous collection item" }, { action: "series.next", label: "Next collection item" },
  ] },
  { title: "Video player", actions: [
    { action: "video.playPause", label: "Play / pause" }, { action: "video.fullscreen", label: "Toggle fullscreen" },
    { action: "video.seekBack", label: "Seek backward" }, { action: "video.seekForward", label: "Seek forward" },
    { action: "video.seekBackLarge", label: "Large seek backward" }, { action: "video.seekForwardLarge", label: "Large seek forward" },
    { action: "video.volumeUp", label: "Volume up 5%" }, { action: "video.volumeDown", label: "Volume down 5%" }, { action: "video.mute", label: "Mute" },
  ] },
  { title: "PDF reader", actions: [
    { action: "reader.previousPage", label: "Previous page" }, { action: "reader.nextPage", label: "Next page" },
    { action: "reader.scrollUp", label: "Scroll up" }, { action: "reader.scrollDown", label: "Scroll down" },
    { action: "reader.zoomIn", label: "Zoom in" }, { action: "reader.resetFit", label: "Reset to fit" },
  ] },
  { title: "Comic reader", actions: [
    { action: "comic.zoomIn", label: "Zoom in" }, { action: "comic.zoomOut", label: "Zoom out" },
    { action: "comic.fitWidth", label: "Fit to width" }, { action: "comic.resetFit", label: "Reset to fit screen" },
    { action: "comic.fullscreen", label: "Toggle fullscreen" },
  ] },
];

export function SettingsView() {
  const [bindings, setBindings] = useState(readBindings);
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [autoPlay, setAutoPlay] = useState(() => readBooleanPreference("vaultly.video.autoplay", true));
  const [autoAdvance, setAutoAdvance] = useState(() => readBooleanPreference("vaultly.video.autoAdvance", true));
  const [continuous, setContinuous] = useState(() => readBooleanPreference("vaultly.reader.continuous", true));
  const [scrollSensitivity, setScrollSensitivity] = useState(() => readNumberPreference("vaultly.reader.scrollSensitivity", 100, 25, 300));
  const [keySensitivity, setKeySensitivity] = useState(() => readNumberPreference("vaultly.reader.keySensitivity", 100, 25, 300));
  const [videoVolume, setVideoVolume] = useState(() => Math.round(readNumberPreference("vaultly.video.volume", 1, 0, 1) * 100));
  const [videoMuted, setVideoMuted] = useState(() => readBooleanPreference("vaultly.video.muted", false));
  const [pdfFit, setPdfFit] = useState(() => window.localStorage.getItem("vaultly.pdf.fit") ?? "page");
  const [pdfZoom, setPdfZoom] = useState(() => readNumberPreference("vaultly.pdf.zoom", 100, 25, 400));
  const [comicFit, setComicFit] = useState(() => window.localStorage.getItem("vaultly.comic.fit") ?? "screen");
  const [comicZoom, setComicZoom] = useState(() => readNumberPreference("vaultly.comic.zoom", 100, 25, 400));
  const [seekAmount, setSeekAmount] = useState(() => readNumberPreference("vaultly.video.seekAmount", 5, .25, 999));
  const [seekUnit, setSeekUnit] = useState(() => window.localStorage.getItem("vaultly.video.seekUnit") === "minutes" ? "minutes" : "seconds");
  const [largeSeekAmount, setLargeSeekAmount] = useState(() => readNumberPreference("vaultly.video.seekLargeAmount", 1, .25, 999));
  const [largeSeekUnit, setLargeSeekUnit] = useState(() => window.localStorage.getItem("vaultly.video.seekLargeUnit") === "seconds" ? "seconds" : "minutes");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const restoreInput = useRef<HTMLInputElement>(null);

  const preferences = () => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith("vaultly.")))
    .map((key) => [key, window.localStorage.getItem(key) ?? ""]));

  const createBackup = async () => {
    setBackupBusy(true); setBackupMessage("");
    try {
      const response = await fetch("/api/backup/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: preferences() }) });
      if (!response.ok) throw new Error((await response.json()).message || "Could not create the backup.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `vaultly-backup-${new Date().toISOString().slice(0, 10)}.json.gz`;
      link.click();
      URL.revokeObjectURL(url);
      setBackupMessage("Backup created successfully.");
    } catch (requestError) {
      setBackupMessage(requestError instanceof Error ? requestError.message : "Could not create the backup.");
    } finally { setBackupBusy(false); }
  };

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !window.confirm("Restore this backup? Current Vaultly metadata and preferences will be replaced.")) return;
    setBackupBusy(true); setBackupMessage("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
      const restored = await api<{ preferences?: Record<string, unknown> }>("/api/backup/restore", { method: "POST", headers: { "Content-Type": compressed ? "application/gzip" : "application/json" }, body: compressed ? file : new TextDecoder().decode(bytes) });
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith("vaultly.")) window.localStorage.removeItem(key);
      }
      if (restored.preferences && typeof restored.preferences === "object") {
        for (const [key, value] of Object.entries(restored.preferences)) {
          if (key.startsWith("vaultly.") && typeof value === "string") window.localStorage.setItem(key, value);
        }
      }
      window.location.reload();
    } catch (requestError) {
      setBackupMessage(requestError instanceof Error ? requestError.message : "Could not restore the backup.");
    } finally { setBackupBusy(false); }
  };

  const updateBindings = (next: Record<ShortcutAction, string[]>) => { setBindings(next); writeBindings(next); };
  const capture = (action: ShortcutAction, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (capturing !== action) return;
    event.preventDefault(); event.stopPropagation();
    if (event.code === "Escape") { setCapturing(null); return; }
    const binding = eventBinding(event.nativeEvent);
    const namespace = action.split(".")[0];
    const next = Object.fromEntries(Object.entries(bindings).map(([key, values]) => [key, key.startsWith(`${namespace}.`) ? values.filter((value) => value !== binding) : values])) as Record<ShortcutAction, string[]>;
    next[action] = [...new Set([...next[action], binding])];
    updateBindings(next);
    setCapturing(null);
  };

  return <section className="settings-view">
    <div className="page-heading"><div><p className="eyebrow">Vaultly preferences</p><h1>Settings & controls</h1><p>Preferences stay on this computer and remain active until you change them.</p></div></div>
    <details className="settings-panel"><summary className="settings-panel-heading"><Download size={18} /><div><h2>Backup and migration</h2><p>Save or restore your library and preferences.</p></div></summary>
      <div className="backup-actions"><button className="primary-button" type="button" disabled={backupBusy} onClick={() => void createBackup()}><Download size={17} /> Create backup</button><button className="secondary-button" type="button" disabled={backupBusy} onClick={() => restoreInput.current?.click()}><Upload size={17} /> Restore backup</button><input ref={restoreInput} className="visually-hidden" type="file" accept="application/gzip,application/json,.gz,.json" onChange={(event) => void restoreBackup(event)} /></div>
      <p className="backup-note">After moving to another computer, restore the backup and use <strong>Sources → Relocate source</strong> for any drive or folder paths that changed. Rescanning preserves matched metadata.</p>
      {backupMessage && <p className="backup-message" role="status">{backupMessage}</p>}
    </details>
    <details className="settings-panel" open><summary className="settings-panel-heading"><Settings2 size={18} /><div><h2>Playback and reading</h2><p>Automatic playback, seeking, and reader scrolling.</p></div></summary>
      <label className="setting-toggle"><input type="checkbox" checked={autoPlay} onChange={(event) => { setAutoPlay(event.target.checked); writePreference("vaultly.video.autoplay", event.target.checked); }} /><span><strong>Autoplay videos</strong><small>Start playback when a video viewer opens.</small></span></label>
      <label className="setting-toggle"><input type="checkbox" checked={autoAdvance} onChange={(event) => { setAutoAdvance(event.target.checked); writePreference("vaultly.video.autoAdvance", event.target.checked); }} /><span><strong>Open next collection item automatically</strong><small>At the end of a video, continue to the next file in its collection.</small></span></label>
      <label className="setting-select"><span><strong>Arrow-key seek</strong><small>Used by Left Arrow and Right Arrow.</small></span><input type="number" min={0.25} max={999} step={0.25} value={seekAmount} onChange={(event) => { const value = Math.max(.25, Math.min(999, Number(event.target.value) || .25)); setSeekAmount(value); writePreference("vaultly.video.seekAmount", value); }} aria-label="Arrow-key seek duration" /><select value={seekUnit} onChange={(event) => { setSeekUnit(event.target.value); writePreference("vaultly.video.seekUnit", event.target.value); }} aria-label="Arrow-key seek unit"><option value="seconds">Seconds</option><option value="minutes">Minutes</option></select></label>
      <label className="setting-select"><span><strong>Shift + Arrow-key seek</strong><small>Used for the larger forward or backward jump.</small></span><input type="number" min={0.25} max={999} step={0.25} value={largeSeekAmount} onChange={(event) => { const value = Math.max(.25, Math.min(999, Number(event.target.value) || .25)); setLargeSeekAmount(value); writePreference("vaultly.video.seekLargeAmount", value); }} aria-label="Large seek duration" /><select value={largeSeekUnit} onChange={(event) => { setLargeSeekUnit(event.target.value); writePreference("vaultly.video.seekLargeUnit", event.target.value); }} aria-label="Large seek unit"><option value="seconds">Seconds</option><option value="minutes">Minutes</option></select></label>
      <label className="setting-toggle"><input type="checkbox" checked={continuous} onChange={(event) => { setContinuous(event.target.checked); writePreference("vaultly.reader.continuous", event.target.checked); }} /><span><strong>Continuous collection reading</strong><small>Moving beyond the first or last page opens the adjacent collection file.</small></span></label>
      <label className="setting-range"><span><strong>Scroll sensitivity</strong><small>{scrollSensitivity}% · Mouse wheel and trackpad scrolling in PDF and comic readers.</small></span><input type="range" min={25} max={300} step={25} value={scrollSensitivity} onChange={(event) => { const value = Number(event.target.value); setScrollSensitivity(value); writePreference("vaultly.reader.scrollSensitivity", value); }} /></label>
      <label className="setting-range"><span><strong>Arrow-key sensitivity</strong><small>{keySensitivity}% · Adjusts scroll distance per press and speed while held in PDF and comic readers.</small></span><input type="range" min={25} max={300} step={25} value={keySensitivity} onChange={(event) => { const value = Number(event.target.value); setKeySensitivity(value); writePreference("vaultly.reader.keySensitivity", value); }} /></label>
      <p className="detail-hint">At 100%, Up/Down scrolls half the reader viewport per press. Hold the key to scroll continuously.</p>
    </details>
    <details className="settings-panel"><summary className="settings-panel-heading"><Settings2 size={18} /><div><h2>Viewer defaults</h2><p>Volume, fit mode, and zoom.</p></div></summary>
      <label className="setting-range"><span><strong>Video volume</strong><small>{videoVolume}%</small></span><input type="range" min={0} max={100} step={1} value={videoVolume} onChange={(event) => { const value = Number(event.target.value); setVideoVolume(value); writePreference("vaultly.video.volume", value / 100); }} /></label>
      <label className="setting-toggle"><input type="checkbox" checked={videoMuted} onChange={(event) => { setVideoMuted(event.target.checked); writePreference("vaultly.video.muted", event.target.checked); }} /><span><strong>Start muted</strong><small>Preserve mute state between videos.</small></span></label>
      <label className="setting-select"><span><strong>PDF fit mode</strong><small>Initial layout when opening PDFs.</small></span><select value={pdfFit} onChange={(event) => { setPdfFit(event.target.value); writePreference("vaultly.pdf.fit", event.target.value); }}><option value="page">Fit page</option><option value="width">Fit width</option><option value="custom">Custom zoom</option></select><input type="number" min={25} max={400} step={25} value={pdfZoom} onChange={(event) => { const value = Math.max(25, Math.min(400, Number(event.target.value) || 25)); setPdfZoom(value); writePreference("vaultly.pdf.zoom", value); }} aria-label="PDF zoom percentage" /></label>
      <label className="setting-select"><span><strong>Comic fit mode</strong><small>Initial layout when opening image comics.</small></span><select value={comicFit} onChange={(event) => { setComicFit(event.target.value); setComicZoom(100); writePreference("vaultly.comic.fit", event.target.value); writePreference("vaultly.comic.zoom", 100); }}><option value="screen">Fit screen</option><option value="width">Fit width</option><option value="custom">Custom zoom</option></select><input type="number" min={25} max={400} step={25} value={comicZoom} onChange={(event) => { const value = Math.max(25, Math.min(400, Number(event.target.value) || 25)); setComicZoom(value); setComicFit("custom"); writePreference("vaultly.comic.zoom", value); writePreference("vaultly.comic.fit", "custom"); }} aria-label="Comic zoom percentage" /></label>
    </details>
    {shortcutGroups.map((group) => <details className="settings-panel" key={group.title}><summary className="settings-panel-heading"><Keyboard size={18} /><div><h2>{group.title}</h2><p>{group.actions.length} keyboard shortcuts</p></div></summary>
      <p className="detail-hint">Select Add key, then press a combination. Escape cancels.</p>
      <div className="shortcut-list">{group.actions.map(({ action, label }) => <div className="shortcut-row" key={action}><strong>{label}</strong><div className="shortcut-bindings">{bindings[action].map((binding) => <span key={binding}>{formatBinding(binding)}<button type="button" onClick={() => updateBindings({ ...bindings, [action]: bindings[action].filter((value) => value !== binding) })} aria-label={`Remove ${formatBinding(binding)}`}><X size={12} /></button></span>)}<button type="button" className={capturing === action ? "capturing" : ""} onClick={() => setCapturing(action)} onKeyDown={(event) => capture(action, event)}>{capturing === action ? "Press keys…" : "Add key"}</button><button type="button" title="Reset binding" aria-label={`Reset ${label}`} onClick={() => updateBindings({ ...bindings, [action]: defaultBindings[action] })}><RotateCcw size={14} /></button></div></div>)}</div>
    </details>)}
  </section>;
}
