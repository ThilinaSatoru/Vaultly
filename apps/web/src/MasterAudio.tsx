import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Headphones, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { getStereoAnalysers, masterAudioState, setMasterMuted, setMasterVolume, setOutputDevice, subscribeMasterAudio } from "./audio-output";

function VuMeter({ active }: { active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current, context = node?.getContext("2d");
    if (!node || !context) return;
    const data = [new Float32Array(512), new Float32Array(512)], levels = [0, 0], peaks = [0, 0];
    node.width = 20; node.height = 28;
    const draw = () => {
      const channels = getStereoAnalysers();
      const styles = getComputedStyle(node);
      context.clearRect(0, 0, 20, 28);
      for (let channel = 0; channel < 2; channel++) {
        let rms = 0;
        if (active && channels && !document.hidden) { channels[channel]!.getFloatTimeDomainData(data[channel]!); rms = Math.sqrt(data[channel]!.reduce((sum, value) => sum + value * value, 0) / data[channel]!.length); }
        const measured = rms ? Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60)) : 0;
        levels[channel] = Math.max(measured, levels[channel]! * .8); peaks[channel] = Math.max(levels[channel]!, peaks[channel]! - .025);
        for (let i = 0; i < 12; i++) { context.fillStyle = styles.getPropertyValue(i > 10 ? "--danger" : i > 8 ? "--warning" : "--acid"); context.globalAlpha = i / 12 < levels[channel]! ? 1 : .15; context.fillRect(1 + channel * 10, 23 - i * 2, 7, 1.5); }
        context.globalAlpha = 1; context.fillStyle = styles.getPropertyValue("--text"); if (peaks[channel]! > 0) context.fillRect(1 + channel * 10, 23 - peaks[channel]! * 22, 7, 1);
      }
    };
    draw(); if (!active) return;
    const timer = window.setInterval(draw, 50); return () => clearInterval(timer);
  }, [active]);
  return <canvas className="audio-vu" ref={canvas} role="img" aria-label="Stereo local audio VU meter, left and right" title="Left / right local audio level after master volume, dBFS" />;
}
export function MasterAudio() {
  const state = useSyncExternalStore(subscribeMasterAudio, masterAudioState, masterAudioState);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [error, setError] = useState("");
  const refresh = async () => {
    try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audiooutput" && device.deviceId && device.deviceId !== "default")); setError(""); }
    catch { setError("Output devices are unavailable in this browser."); }
  };
  useEffect(() => {
    const changed = () => { void refresh(); };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", changed);
  }, []);
  const choose = async () => {
    const media = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
    try { if (media?.selectAudioOutput) { const device = await media.selectAudioOutput(); await setOutputDevice(device.deviceId); } await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not select output."); }
  };
  return <div className="master-audio-controls" aria-label="Master audio controls">
    <button className="icon-button" type="button" aria-label={state.muted ? "Unmute master audio" : "Mute master audio"} aria-pressed={state.muted} onClick={() => setMasterMuted(!state.muted)}>{state.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
    <label><span className="master-volume-label">Master</span><input aria-label="Master volume" type="range" min={0} max={1} step={.01} value={state.volume} onChange={(event) => setMasterVolume(Number(event.target.value))} /><output>{Math.round(state.volume * 100)}%</output></label>
    <div className="stereo-vu"><VuMeter active={state.active} /><span aria-hidden="true">L R</span></div>
    <details className="audio-device-menu" onToggle={(event) => { if (event.currentTarget.open) void refresh(); }}><summary aria-label="Audio output" title="Audio output"><Headphones size={15} /></summary><div>
      <label>Local playback device<select aria-label="Audio output device" value={state.deviceId} onChange={(event) => { void setOutputDevice(event.target.value).catch((reason) => setError(String(reason))); }}><option value="">System default</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Output ${index + 1}`}</option>)}</select></label>
      <button className="secondary-button" type="button" onClick={() => void choose()}><Headphones size={14} /> Choose output</button><button className="icon-button" type="button" aria-label="Refresh audio devices" onClick={() => void refresh()}><RefreshCw size={14} /></button>
      <small>YouTube uses the system output. VU metering measures local playback. Device choices depend on browser support and permissions.</small>
      {(error || state.error) && <p className="form-error" role="status">{error || state.error}</p>}
    </div></details>
  </div>;
}
