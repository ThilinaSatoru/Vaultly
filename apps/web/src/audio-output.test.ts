import { afterEach, beforeEach, expect, test, vi } from "vitest";
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("./vault-session", () => ({ vaultStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } }));
const nodes: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } }> = [];
let sources = 0;
const sink = vi.fn(async (_id: string) => {}), resume = vi.fn(async () => {});
function node() { const value = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1, setTargetAtTime: vi.fn() } }; nodes.push(value); return value; }
class FakeContext {
  state = "suspended"; currentTime = 12; destination = {};
  setSinkId = sink; resume = resume;
  createGain = node; createAnalyser = node;
  createChannelSplitter = node;
  createMediaElementSource() { sources++; return node(); }
}
class Media extends EventTarget { paused = true; ended = false; }
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); storage.clear(); nodes.length = 0; sources = 0; vi.stubGlobal("AudioContext", FakeContext); vi.stubGlobal("document", new EventTarget()); });
afterEach(() => vi.unstubAllGlobals());

test("master gain controls every local route and sends the same effective level to embeds", async () => {
  const audio = await import("./audio-output");
  const stop = audio.connectMediaOutput(new Media() as unknown as HTMLMediaElement);
  const remote = vi.fn(), unsubscribe = audio.registerExternalVolume(remote);
  audio.setMasterVolume(.35);
  expect(nodes[0]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(.35, 12, .015);
  expect(remote).toHaveBeenLastCalledWith(.35);
  audio.setMasterMuted(true);
  expect(nodes[0]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 12, .015);
  expect(remote).toHaveBeenLastCalledWith(0);
  audio.setMasterMuted(false);
  expect(remote).toHaveBeenLastCalledWith(.35);
  expect(storage.get("vaultly.audio.masterVolume")).toBe("0.35");
  expect(nodes[0]!.connect).toHaveBeenCalledWith(audio.getMasterAnalyser());
  unsubscribe(); stop();
});
test("reattaching an element reuses its source and releasing it clears playback activity", async () => {
  const audio = await import("./audio-output"), media = new Media(), element = media as unknown as HTMLMediaElement;
  const first = audio.connectMediaOutput(element); first();
  const second = audio.connectMediaOutput(element), third = audio.connectMediaOutput(element);
  expect(sources).toBe(1);
  media.paused = false; media.dispatchEvent(new Event("play"));
  expect(audio.masterAudioState().active).toBe(true); expect(resume).toHaveBeenCalled();
  second(); expect(audio.masterAudioState().active).toBe(true);
  third(); expect(audio.masterAudioState().active).toBe(false);
});
test("stereo metering splits the post-master signal into independent left and right analysers", async () => {
  const audio = await import("./audio-output");
  const stop = audio.connectMediaOutput(new Media() as unknown as HTMLMediaElement);
  const channels = audio.getStereoAnalysers()!;
  expect(channels).toHaveLength(2); expect(channels[0]).not.toBe(channels[1]);
  const splitter = nodes[2]!;
  expect(nodes[0]!.connect).toHaveBeenCalledWith(splitter);
  expect(splitter.connect).toHaveBeenCalledWith(channels[0], 0);
  expect(splitter.connect).toHaveBeenCalledWith(channels[1], 1);
  expect(nodes[3]!.gain.value).toBe(0);
  stop();
});
test("failed output changes retain the working device and invalid volume is bounded", async () => {
  const audio = await import("./audio-output");
  const stop = audio.connectMediaOutput(new Media() as unknown as HTMLMediaElement);
  await audio.setOutputDevice("speakers");
  expect(sink).toHaveBeenCalledWith("speakers");
  sink.mockRejectedValueOnce(new Error("Device unavailable"));
  await expect(audio.setOutputDevice("gone")).rejects.toThrow("Device unavailable");
  expect(audio.masterAudioState().deviceId).toBe("speakers");
  audio.setMasterVolume(5); expect(audio.masterAudioState().volume).toBe(1);
  audio.setMasterVolume(-1); expect(audio.masterAudioState().volume).toBe(0);
  stop();
});
