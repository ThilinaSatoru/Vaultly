import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Minimize2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { mediaAnalyser } from "./audio-output";
import { formatDuration } from "./media";
import { trackLabel, type MusicTrack } from "./music";
import "./music-visualizer.css";

type Bytes = Uint8Array<ArrayBuffer>;
export interface FeedData { freq: Bytes; time: Bytes; level: number; bass: number; mid: number; high: number; sampleRate: number; live: boolean }
type Listener = (data: FeedData) => void;
class AudioFeed {
  data: FeedData = { freq: new Uint8Array(1024), time: new Uint8Array(2048).fill(128), level: 0, bass: 0, mid: 0, high: 0, sampleRate: 44100, live: false };
  private listeners = new Set<Listener>();
  subscribe = (listener: Listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  emit() { this.listeners.forEach((listener) => listener(this.data)); }
}
export type { AudioFeed };

const bandAverage = (freq: Uint8Array, binHz: number, from: number, to: number) => {
  const a = Math.max(0, Math.floor(from / binHz)), b = Math.min(freq.length, Math.max(a + 1, Math.ceil(to / binHz)));
  let sum = 0; for (let i = a; i < b; i++) sum += freq[i]!;
  return sum / (b - a) / 255;
};

/** One requestAnimationFrame loop per player; every canvas subscribes to the shared frame instead of polling the analyser itself. */
export function useAudioFeed(media: RefObject<HTMLMediaElement | null>, active: boolean): AudioFeed {
  const [feed] = useState(() => new AudioFeed());
  useEffect(() => {
    let raf = 0, idle = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const d = feed.data, node = media.current ? mediaAnalyser(media.current) : null;
      if (active && node) {
        idle = 0;
        if (d.freq.length !== node.frequencyBinCount) d.freq = new Uint8Array(node.frequencyBinCount);
        if (d.time.length !== node.fftSize) d.time = new Uint8Array(node.fftSize);
        node.smoothingTimeConstant = .35; node.getByteFrequencyData(d.freq); node.getByteTimeDomainData(d.time);
        d.sampleRate = node.context.sampleRate; d.live = true;
        const binHz = d.sampleRate / node.fftSize;
        let square = 0; for (let i = 0; i < d.time.length; i++) { const v = (d.time[i]! - 128) / 128; square += v * v; }
        const rms = Math.min(1, Math.sqrt(square / d.time.length) * 2.4);
        d.level = Math.max(rms, d.level * .86);
        d.bass = Math.max(bandAverage(d.freq, binHz, 20, 250), d.bass * .84);
        d.mid = Math.max(bandAverage(d.freq, binHz, 250, 4000), d.mid * .84);
        d.high = Math.max(bandAverage(d.freq, binHz, 4000, 16000), d.high * .84);
      } else {
        d.freq.fill(0); d.time.fill(128); d.live = false;
        d.level *= .86; d.bass *= .84; d.mid *= .84; d.high *= .84;
        if (++idle > 50) { cancelAnimationFrame(raf); raf = 0; d.level = d.bass = d.mid = d.high = 0; }
      }
      feed.emit();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [feed, media, active]);
  return feed;
}

interface Palette { accent: string; accent2: string; accent3: string; text: string; muted: string; bg: string; light: boolean }
type Painter = (c: CanvasRenderingContext2D, w: number, h: number, d: FeedData, k: Palette) => void;
type Rgb = [number, number, number];
const parseRgb = (value: string): Rgb => { const m = value.match(/[\d.]+/g)?.map(Number); return m && m.length >= 3 ? [m[0]!, m[1]!, m[2]!] : [0, 0, 0]; };
const luminance = ([r, g, b]: Rgb) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
/** Keeps the theme's hue but guarantees enough brightness to read on a black canvas. */
const brighten = (rgb: Rgb) => { const lum = luminance(rgb), amount = lum >= .6 ? 0 : (.6 - lum) / (1 - lum); return `rgb(${rgb.map((v) => Math.round(v + (255 - v) * amount)).join(",")})`; };
const darken = (rgb: Rgb, amount: number) => `rgb(${rgb.map((v) => Math.round(v * (1 - amount))).join(",")})`;
/** Resolves theme variables through a probe element so any CSS colour syntax (hex, color-mix, hsl) ends up as plain rgb. */
const readPalette = (node: HTMLElement, dark: boolean): Palette => {
  const host = node.parentElement ?? node, probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none"; host.appendChild(probe);
  const resolve = (name: string, fallback: string) => { probe.style.color = fallback; probe.style.color = `var(${name}, ${fallback})`; return getComputedStyle(probe).color; };
  const bg = dark ? "rgb(0,0,0)" : resolve("--panel", "#0e1013"), light = !dark && luminance(parseRgb(bg)) > .55;
  const tone = (name: string, fallback: string) => { const rgb = parseRgb(resolve(name, fallback)); return light ? darken(rgb, .42) : `rgb(${rgb.join(",")})`; };
  const fixed = (name: string, fallback: string) => dark ? brighten(parseRgb(resolve(name, fallback))) : tone(name, fallback);
  const palette = { accent: fixed("--acid", "#79ff51"), accent2: fixed("--viz-2", "#38bdf8"), accent3: fixed("--viz-3", "#f472b6"), text: dark ? "#e8ecef" : resolve("--text", "#f3f5f7"), muted: dark ? "#8b939e" : resolve("--muted", "#969ba6"), bg, light };
  probe.remove(); return palette;
};

function CanvasView({ feed, make, className, label, dark = false }: { feed: AudioFeed; make: () => Painter; className?: string; label: string; dark?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current, context = node?.getContext("2d");
    if (!node || !context) return;
    const paint = make();
    let w = 1, h = 1, palette = readPalette(node, dark), frames = 0;
    const resize = () => {
      const box = node.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(box.width)); h = Math.max(1, Math.round(box.height));
      node.width = Math.round(w * ratio); node.height = Math.round(h * ratio); context.setTransform(ratio, 0, 0, ratio, 0, 0); palette = readPalette(node, dark);
    };
    const observer = new ResizeObserver(resize); observer.observe(node); resize();
    const off = feed.subscribe((data) => { if (++frames % 120 === 0) palette = readPalette(node, dark); paint(context, w, h, data, palette); });
    return () => { off(); observer.disconnect(); };
  }, [feed, make, dark]);
  return <canvas ref={canvas} className={className} role="img" aria-label={label} />;
}

/** Log-spaced, smoothed frequency bands with falling peak caps. */
class Bands {
  level: Float32Array; peak: Float32Array; hold: Float32Array;
  constructor(readonly count: number, private fmin = 30, private fmax = 16000) { this.level = new Float32Array(count); this.peak = new Float32Array(count); this.hold = new Float32Array(count); }
  update(d: FeedData) {
    const binHz = d.sampleRate / 2 / Math.max(1, d.freq.length), top = Math.min(this.fmax, d.sampleRate / 2 - 1);
    for (let i = 0; i < this.count; i++) {
      const f0 = this.fmin * (top / this.fmin) ** (i / this.count), f1 = this.fmin * (top / this.fmin) ** ((i + 1) / this.count);
      const b0 = Math.floor(f0 / binHz), b1 = Math.min(d.freq.length, Math.max(b0 + 1, Math.ceil(f1 / binHz)));
      let max = 0; for (let b = b0; b < b1; b++) if (d.freq[b]! > max) max = d.freq[b]!;
      const v = Math.min(1, (max / 255) ** 1.7 * (1 + (i / this.count) * .4));
      this.level[i] = v > this.level[i]! ? v : this.level[i]! * .72 + v * .28;
      if (this.level[i]! >= this.peak[i]!) { this.peak[i] = this.level[i]!; this.hold[i] = 10; }
      else if (this.hold[i]! > 0) this.hold[i]!--;
      else this.peak[i] = Math.max(this.level[i]!, this.peak[i]! - .02);
    }
  }
}
function spectrumPainter(count: number, style: "panel" | "mini"): Painter {
  const bands = new Bands(count);
  return (c, w, h, d, k) => {
    bands.update(d);
    c.clearRect(0, 0, w, h);
    const panel = style === "panel", top = panel ? 6 : 0, bottom = panel ? 16 : 0, ph = Math.max(1, h - top - bottom);
    if (panel) {
      c.font = "9px 'IBM Plex Mono', monospace"; c.textBaseline = "alphabetic"; c.lineWidth = 1;
      for (let i = 1; i < 4; i++) { const y = Math.round(top + (ph * i) / 4) + .5; c.globalAlpha = .12; c.strokeStyle = k.muted; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      c.globalAlpha = .7; c.fillStyle = k.muted;
      const top2 = Math.min(16000, d.sampleRate / 2 - 1);
      for (const hz of [100, 1000, 10000]) { const x = (Math.log(hz / 30) / Math.log(top2 / 30)) * w; c.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}`, Math.min(w - 16, x), h - 3); c.globalAlpha = .08; c.strokeStyle = k.muted; c.beginPath(); c.moveTo(Math.round(x) + .5, top); c.lineTo(Math.round(x) + .5, top + ph); c.stroke(); c.globalAlpha = .7; }
      c.globalAlpha = 1;
    }
    const step = w / count, gap = Math.max(1, step * (panel ? .2 : .3)), bw = step - gap;
    c.fillStyle = k.accent;
    for (let i = 0; i < count; i++) { const bh = Math.max(panel ? 2 : 1.5, bands.level[i]! * ph); c.fillRect(i * step + gap / 2, top + ph - bh, bw, bh); }
  };
}

function scopePainter(): Painter {
  return (c, w, h, d, k) => {
    c.clearRect(0, 0, w, h);
    c.lineWidth = 1; c.strokeStyle = k.muted;
    for (let i = 1; i < 8; i++) { const x = Math.round((w * i) / 8) + .5; c.globalAlpha = i === 4 ? .3 : .11; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let i = 1; i < 4; i++) { const y = Math.round((h * i) / 4) + .5; c.globalAlpha = i === 2 ? .3 : .11; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.globalAlpha = 1;
    const t = d.time, span = Math.min(1024, t.length >> 1);
    // Rising zero-crossing trigger keeps periodic signals from smearing across frames.
    let start = 0;
    for (let i = 1; i < t.length - span - 4; i++) if (t[i - 1]! < 128 && t[i]! >= 128 && t[i + 4]! > t[i]!) { start = i; break; }
    const mid = h / 2, amp = h * .46;
    c.beginPath();
    for (let x = 0; x < w; x++) { const v = (t[start + Math.floor((x / w) * span)]! - 128) / 128, y = mid - Math.max(-1, Math.min(1, v * 1.25)) * amp; if (x) c.lineTo(x, y); else c.moveTo(x, y); }
    c.lineJoin = "round"; c.strokeStyle = k.accent; c.lineWidth = 1.6; c.stroke();
    c.font = "9px 'IBM Plex Mono', monospace"; c.fillStyle = k.muted;
    const label = `${((span / d.sampleRate) * 1000 / 8).toFixed(1)} ms/div`;
    c.fillText(label, w - c.measureText(label).width - 6, h - 6);
  };
}

/** Radial equalizer. `dock` is the small halo behind the play button; `hero` is the full-screen backdrop. */
function ringPainter(style: "dock" | "hero"): Painter {
  const hero = style === "hero", bands = new Bands(hero ? 72 : 22, 40, 14000);
  const dots = hero ? Array.from({ length: 56 }, (_, i) => ({ angle: (i / 56) * Math.PI * 2, radius: Math.random(), speed: .002 + Math.random() * .004 })) : [];
  let spin = 0;
  return (c, w, h, d, k) => {
    bands.update(d);
    c.clearRect(0, 0, w, h);
    const cx = w / 2, cy = hero ? h * .56 : h / 2, size = hero ? Math.min(w, h * .8) : Math.min(w, h);
    const r0 = size * (hero ? .2 : .33) * (1 + d.bass * (hero ? .05 : .08)), reach = size * (hero ? .27 : .17);
    spin += .002 + d.level * .01;
    if (hero) {
      for (const dot of dots) {
        dot.radius += dot.speed * (1 + d.bass * 5); if (dot.radius > 1) dot.radius = 0;
        const r = r0 + reach * 1.15 + dot.radius * size * .3, a = dot.angle + spin * .5;
        c.globalAlpha = (1 - dot.radius) * (.15 + d.level * .6); c.fillStyle = dot.angle % 2 > 1 ? k.accent2 : k.accent;
        c.beginPath(); c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1 + (1 - dot.radius) * 1.5, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
    }
    const half = bands.count, total = half * 2;
    c.lineCap = "round"; c.lineWidth = hero ? Math.max(3, size * .008) : 2;
    for (let i = 0; i < total; i++) {
      const band = i < half ? i : total - 1 - i, level = bands.level[band]!, angle = (i / total) * Math.PI * 2 - Math.PI / 2;
      const len = Math.max(hero ? 3 : 1.5, level * reach), x = Math.cos(angle), y = Math.sin(angle);
      c.globalAlpha = .35 + level * .65; c.strokeStyle = level > .7 ? k.accent3 : i % 2 ? k.accent : k.accent2;
      c.beginPath(); c.moveTo(cx + x * r0, cy + y * r0); c.lineTo(cx + x * (r0 + len), cy + y * (r0 + len)); c.stroke();
    }
    c.globalAlpha = 1; c.lineWidth = 1; c.strokeStyle = k.accent; c.globalAlpha = .55 + d.level * .4;
    c.beginPath(); c.arc(cx, cy, r0 - (hero ? 8 : 2.5), 0, Math.PI * 2); c.stroke();
    if (hero) {
      c.setLineDash([2, 10]); c.globalAlpha = .35; c.strokeStyle = k.text;
      c.save(); c.translate(cx, cy); c.rotate(spin); c.beginPath(); c.arc(0, 0, r0 + reach * 1.12, 0, Math.PI * 2); c.stroke(); c.restore(); c.setLineDash([]);
    }
    c.globalAlpha = 1;
  };
}

export function Spectrum({ feed, bars = 48, variant = "panel" }: { feed: AudioFeed; bars?: number; variant?: "panel" | "mini" }) {
  const make = useMemo(() => () => spectrumPainter(bars, variant), [bars, variant]);
  return <CanvasView feed={feed} make={make} className={`viz-canvas viz-spectrum-canvas viz-variant-${variant}`} label="Frequency spectrum analyzer" dark={variant === "panel"} />;
}
export function Scope({ feed }: { feed: AudioFeed }) {
  return <CanvasView feed={feed} make={scopePainter} className="viz-canvas viz-scope-canvas" label="Oscilloscope waveform" dark />;
}
export function Halo({ feed }: { feed: AudioFeed }) {
  const make = useMemo(() => () => ringPainter("dock"), []);
  return <CanvasView feed={feed} make={make} className="viz-canvas viz-halo" label="Playback level ring" />;
}
function Stage({ feed }: { feed: AudioFeed }) {
  const make = useMemo(() => () => ringPainter("hero"), []);
  return <CanvasView feed={feed} make={make} className="viz-canvas viz-stage" label="Radial audio visualizer" />;
}

interface OverlayProps {
  feed: AudioFeed; track: MusicTrack | null; playing: boolean; position: number; duration: number;
  onSeek: (seconds: number) => void; onToggle: () => void; onPrevious: () => void; onNext: () => void; onClose: () => void;
}
export function VisualizerOverlay({ feed, track, playing, position, duration, onSeek, onToggle, onPrevious, onNext, onClose }: OverlayProps) {
  const root = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const node = root.current; if (!node) return;
    let closed = false;
    const leave = () => { if (!closed) { closed = true; close.current(); } };
    const fullscreenChanged = () => { if (!document.fullscreenElement) leave(); };
    document.addEventListener("fullscreenchange", fullscreenChanged);
    const keys = (event: KeyboardEvent) => { if (event.key === "Escape") leave(); };
    window.addEventListener("keydown", keys);
    void node.requestFullscreen?.().catch(() => undefined);
    return () => {
      document.removeEventListener("fullscreenchange", fullscreenChanged); window.removeEventListener("keydown", keys);
      if (document.fullscreenElement === node) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    let timer = 0;
    const wake = () => { setIdle(false); clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 3200); };
    wake(); window.addEventListener("pointermove", wake); window.addEventListener("keydown", wake);
    return () => { clearTimeout(timer); window.removeEventListener("pointermove", wake); window.removeEventListener("keydown", wake); };
  }, []);
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  const remaining = Math.max(0, duration - position), progress = duration ? Math.min(100, (position / duration) * 100) : 0;
  const chips = track ? [track.codec.toUpperCase(), track.bitrate ? `${track.bitrate} kbps` : "", track.sample_rate ? `${track.sample_rate / 1000} kHz` : "", track.bit_depth ? `${track.bit_depth}-bit` : "", track.channels ? `${track.channels} ch` : ""].filter(Boolean) : [];
  return createPortal(<div className="music-root">
    <div ref={root} className={`viz-overlay${idle ? " is-idle" : ""}${playing ? " is-playing" : ""}`} role="dialog" aria-modal="true" aria-label="Full-screen audio visualizer" title="Double-click to exit" onDoubleClick={onClose}>
      <Stage feed={feed} />
      <header className="viz-top">
        <section className="music-scope-panel viz-side" onDoubleClick={stop}><span>Spectrum · 30 Hz – 16 kHz</span><Spectrum feed={feed} bars={40} /></section>
        <section className="music-scope-panel viz-side" onDoubleClick={stop}><span>Oscilloscope · {playing ? "live" : "idle"}</span><Scope feed={feed} /></section>
      </header>
      <div className="viz-center">
        <div className="viz-info">
          <span className="viz-eyebrow"><i /> {playing ? "Now playing" : "Paused"}</span>
          <h2>{track ? track.title : "Nothing playing"}</h2>
          <p>{track ? [track.artist, track.album].filter(Boolean).join(" · ") : ""}</p>
          <div className="viz-chips">{chips.map((chip) => <span key={chip}>{chip}</span>)}</div>
        </div>
        <div className="viz-clock" aria-hidden="true"><strong>{formatDuration(position)}</strong><small>−{formatDuration(remaining)}</small></div>
      </div>
      <footer className="viz-controls" onDoubleClick={stop}>
        <label className="viz-seek"><span>{formatDuration(position)}</span>
          <input aria-label="Seek music" type="range" min={0} max={duration || 1} step={.1} value={Math.min(position, duration || 1)} style={{ "--progress": `${progress}%` } as CSSProperties} onChange={(event) => onSeek(Number(event.target.value))} />
          <span>{formatDuration(duration)}</span></label>
        <div className="viz-buttons">
          <button type="button" aria-label="Previous track" onClick={onPrevious}><SkipBack size={20} /></button>
          <button type="button" className="viz-play" aria-label={playing ? "Pause music" : "Play music"} onClick={onToggle}>{playing ? <Pause size={24} /> : <Play size={24} />}</button>
          <button type="button" aria-label="Next track" onClick={onNext}><SkipForward size={20} /></button>
          <button type="button" className="viz-exit" aria-label="Exit visualizer" title="Exit (Esc)" onClick={onClose}><Minimize2 size={18} /></button>
        </div>
        <small className="viz-hint">{track ? trackLabel(track) : ""} · double-click anywhere or press Esc to exit</small>
      </footer>
    </div>
  </div>, document.body);
}
