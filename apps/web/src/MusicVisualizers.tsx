import { useEffect, useRef } from "react";

export function MusicVisualizer({ analyser, mode, active }: { analyser: AnalyserNode | null; mode: "spectrum" | "scope"; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    let frame = 0;
    const frequency = new Uint8Array(analyser?.frequencyBinCount ?? 1024);
    const waveform = new Uint8Array(analyser?.fftSize ?? 2048);
    const draw = () => {
      const width = element.clientWidth, height = element.clientHeight, ratio = window.devicePixelRatio || 1;
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) { element.width = Math.round(width * ratio); element.height = Math.round(height * ratio); }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const color = getComputedStyle(element).color;
      context.strokeStyle = color;
      context.globalAlpha = .13;
      context.lineWidth = 1;
      for (let x = 0; x < width; x += width / 8) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
      for (let y = 0; y < height; y += height / 4) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
      context.globalAlpha = 1;
      if (mode === "spectrum") {
        if (analyser && active) analyser.getByteFrequencyData(frequency); else frequency.fill(0);
        const bars = 48, gap = 2, barWidth = width / bars;
        const gradient = context.createLinearGradient(0, height, 0, 0); gradient.addColorStop(0, color); gradient.addColorStop(1, "#c4e8ff");
        context.fillStyle = gradient;
        for (let i = 0; i < bars; i++) {
          const index = Math.floor(Math.pow(i / bars, 2) * frequency.length * .85);
          const value = Math.max(1, (frequency[index] ?? 0) / 255 * (height - 6));
          context.fillRect(i * barWidth, height - value, Math.max(1, barWidth - gap), value);
        }
      } else {
        if (analyser && active) analyser.getByteTimeDomainData(waveform); else waveform.fill(128);
        context.lineWidth = 1.5;
        context.beginPath();
        for (let i = 0; i < waveform.length; i++) {
          const x = i / (waveform.length - 1) * width, y = (waveform[i] ?? 128) / 255 * height;
          if (!i) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
      }
      if (active && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const restart = () => { cancelAnimationFrame(frame); draw(); };
    const observer = new ResizeObserver(restart); observer.observe(element);
    document.addEventListener("visibilitychange", restart);
    draw();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", restart); };
  }, [analyser, mode, active]);
  return <section className="music-visualizer"><header>{mode === "spectrum" ? "Spectrum analyzer" : "Oscilloscope"}<small>{active ? "LIVE" : "IDLE"}</small></header><canvas ref={canvas} role="img" aria-label={mode === "spectrum" ? "Live audio frequency spectrum" : "Live audio waveform"} /><footer>{mode === "spectrum" ? "20 Hz · · · 1 kHz · · · 20 kHz" : "Amplitude / time"}</footer></section>;
}
