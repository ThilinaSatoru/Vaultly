import { vaultStorage } from "./vault-session";

export interface MasterAudioState { volume: number; muted: boolean; deviceId: string; active: boolean; error: string }
let snapshot: MasterAudioState | null = null;
const listeners = new Set<() => void>();
const external = new Set<(volume: number) => void>();
let context: AudioContext | null = null, masterGain: GainNode | null = null, analyser: AnalyserNode | null = null;
let stereoAnalysers: [AnalyserNode, AnalyserNode] | null = null;
interface Route { source: MediaElementAudioSourceNode; analyser: AnalyserNode; users: number; element: HTMLMediaElement; playing: boolean; release?: () => void }
const routes = new WeakMap<HTMLMediaElement, Route>(), connected = new Set<Route>();

export function masterAudioState(): MasterAudioState {
  if (!snapshot) {
    const value = Number(vaultStorage.getItem("vaultly.audio.masterVolume") ?? "1");
    snapshot = { volume: Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1, muted: vaultStorage.getItem("vaultly.audio.masterMuted") === "true",
      deviceId: vaultStorage.getItem("vaultly.audio.outputDevice") ?? "", active: false, error: "" };
  }
  return snapshot;
}
export const subscribeMasterAudio = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(value: Partial<MasterAudioState>) { snapshot = { ...masterAudioState(), ...value }; listeners.forEach((listener) => listener()); }
export const effectiveMasterVolume = () => { const state = masterAudioState(); return state.muted ? 0 : state.volume; };
function applyVolume() {
  if (context && masterGain) masterGain.gain.setTargetAtTime(effectiveMasterVolume(), context.currentTime, .015);
  external.forEach((listener) => listener(effectiveMasterVolume()));
}
export function setMasterVolume(volume: number) {
  const value = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  vaultStorage.setItem("vaultly.audio.masterVolume", String(value)); update({ volume: value }); applyVolume();
}
export function setMasterMuted(muted: boolean) { vaultStorage.setItem("vaultly.audio.masterMuted", String(muted)); update({ muted }); applyVolume(); }
export function registerExternalVolume(listener: (volume: number) => void) { external.add(listener); listener(effectiveMasterVolume()); return () => { external.delete(listener); }; }
export const getMasterAnalyser = () => analyser;
export const getStereoAnalysers = () => stereoAnalysers;
export async function setOutputDevice(deviceId: string) {
  if (context) {
    const output = context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!output.setSinkId && deviceId) throw new Error("This browser cannot switch local audio outputs. Use the system sound settings.");
    await output.setSinkId?.(deviceId);
  }
  vaultStorage.setItem("vaultly.audio.outputDevice", deviceId); update({ deviceId, error: "" });
}
function ensureContext() {
  if (context) return context;
  context = new AudioContext();
  masterGain = context.createGain(); masterGain.gain.value = effectiveMasterVolume();
  masterGain.channelCount = 2; masterGain.channelCountMode = "explicit"; masterGain.channelInterpretation = "speakers";
  analyser = context.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .6;
  masterGain.connect(analyser); analyser.connect(context.destination);
  const splitter = context.createChannelSplitter(2), silent = context.createGain();
  silent.gain.value = 0; silent.connect(context.destination);
  stereoAnalysers = [context.createAnalyser(), context.createAnalyser()];
  masterGain.connect(splitter);
  stereoAnalysers.forEach((channel, index) => { channel.fftSize = 512; splitter.connect(channel, index); channel.connect(silent); });
  const sink = masterAudioState().deviceId;
  if (sink) void setOutputDevice(sink).catch(() => { void setOutputDevice("").catch(() => undefined); update({ error: "Saved output device is unavailable. Using the system default." }); });
  return context;
}
export async function resumeMasterAudio() { if (context?.state === "suspended") await context.resume(); }
export function mediaAnalyser(element: HTMLMediaElement) { return routes.get(element)?.analyser ?? null; }
export function connectMediaOutput(element: HTMLMediaElement) {
  let route = routes.get(element);
  try {
    if (!route) {
      const audioContext = ensureContext();
      const source = audioContext.createMediaElementSource(element), node = audioContext.createAnalyser();
      node.fftSize = 2048; node.smoothingTimeConstant = .78; source.connect(node);
      route = { source, analyser: node, users: 0, element, playing: !element.paused }; routes.set(element, route);
    }
    route.users++;
    if (route.users === 1) {
      route.analyser.connect(masterGain!); connected.add(route);
      const state = () => { route!.playing = !element.paused && !element.ended; update({ active: [...connected].some((entry) => entry.playing) }); };
      const play = () => { state(); void resumeMasterAudio().catch(() => update({ error: "Click Play to enable local audio." })); };
      element.addEventListener("play", play); element.addEventListener("pause", state); element.addEventListener("ended", state);
      const unlock = () => { void resumeMasterAudio().catch(() => undefined); };
      document.addEventListener("pointerdown", unlock);
      route.release = () => { element.removeEventListener("play", play); element.removeEventListener("pause", state); element.removeEventListener("ended", state); document.removeEventListener("pointerdown", unlock); };
      if (!element.paused) play();
    }
  } catch (error) { update({ error: `Audio controls unavailable: ${error instanceof Error ? error.message : String(error)}` }); return () => undefined; }
  const registered = route;
  return () => {
    registered.users--;
    if (!registered.users) { registered.release?.(); registered.analyser.disconnect(); connected.delete(registered); update({ active: [...connected].some((entry) => entry.playing) }); }
  };
}
