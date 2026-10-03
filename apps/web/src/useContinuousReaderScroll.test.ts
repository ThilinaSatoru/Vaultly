import { afterEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ cleanup: undefined as undefined | (() => void) }));
const preferences = vi.hoisted(() => new Map<string, number>());
vi.mock("react", () => ({
  useLayoutEffect: (effect: () => () => void) => { lifecycle.cleanup?.(); lifecycle.cleanup = effect(); },
}));
vi.mock("./preferences", () => ({
  readNumberPreference: (key: string, fallback: number) => preferences.get(key) ?? fallback,
  matchesShortcut: (event: KeyboardEvent, action: string) =>
    event.code === (action === "reader.scrollUp" ? "ArrowUp" : "ArrowDown"),
}));
import { useContinuousReaderScroll } from "./useContinuousReaderScroll";

function setup() {
  let now = 0;
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const events = new EventTarget();
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("Node", EventTarget);
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: (frame: number) => frames.delete(frame),
  });
  const element = {
    scrollTop: 0, scrollLeft: 0, clientHeight: 800, clientWidth: 600, scrollHeight: 10000,
    contains: (node: unknown) => node === events,
    scrollTo({ top }: ScrollToOptions) { this.scrollTop = top ?? this.scrollTop; },
    scrollBy({ top = 0, left = 0 }: ScrollToOptions) { this.scrollTop += top; this.scrollLeft += left; },
  };
  const ref = { current: element as unknown as HTMLElement };
  useContinuousReaderScroll(ref, true, 1);
  const key = (type: string, repeat = false, code = "ArrowDown") => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code, repeat });
    events.dispatchEvent(event);
  };
  const advance = (count: number) => {
    for (let i = 0; i < count; i++) {
      now += 16;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    }
  };
  const wheel = (deltaY: number, deltaMode = 0, ctrlKey = false) => {
    const event = new Event("wheel", { cancelable: true });
    Object.assign(event, { deltaY, deltaX: 0, deltaMode, ctrlKey });
    events.dispatchEvent(event);
    return event;
  };
  return { element, ref, key, advance, wheel };
}

afterEach(() => { lifecycle.cleanup?.(); lifecycle.cleanup = undefined; preferences.clear(); vi.unstubAllGlobals(); });

describe("reader keyboard scrolling", () => {
  it("finishes a quick tap at half the viewport height", () => {
    const { element, key, advance } = setup();
    key("keydown"); key("keyup"); advance(80);
    expect(element.scrollTop).toBe(400);
  });

  it("scrolls steadily when held and stops immediately on release", () => {
    const { element, key, advance } = setup();
    key("keydown"); advance(10); key("keydown", true);
    const start = element.scrollTop;
    advance(10);
    expect(element.scrollTop - start).toBeCloseTo(256);
    key("keyup");
    const released = element.scrollTop;
    advance(20);
    expect(element.scrollTop).toBe(released);
  });

  it("cancels old-page scrolling when the page changes", () => {
    const { element, ref, key, advance } = setup();
    key("keydown"); key("keydown", true); advance(10);
    useContinuousReaderScroll(ref, true, 2);
    element.scrollTo({ top: 0, behavior: "instant" });
    advance(20);
    expect(element.scrollTop).toBe(0);
  });

  it("applies key sensitivity to taps and held speed", () => {
    preferences.set("vaultly.reader.keySensitivity", 200);
    const { element, key, advance } = setup();
    key("keydown"); key("keyup"); advance(80);
    expect(element.scrollTop).toBe(800);
    key("keydown"); key("keydown", true);
    const start = element.scrollTop;
    advance(10);
    expect(element.scrollTop - start).toBeCloseTo(512);
  });

  it("scales wheel pixels, lines, and pages using the saved sensitivity", () => {
    const { element, wheel } = setup();
    preferences.set("vaultly.reader.scrollSensitivity", 200);
    expect(wheel(100).defaultPrevented).toBe(true);
    expect(element.scrollTop).toBe(200);
    wheel(3, 1);
    expect(element.scrollTop).toBe(296);
    wheel(1, 2);
    expect(element.scrollTop).toBe(1896);
    preferences.set("vaultly.reader.scrollSensitivity", 50);
    wheel(-100);
    expect(element.scrollTop).toBe(1846);
  });

  it("preserves native wheel behavior at 100% and browser pinch zoom", () => {
    const { element, wheel } = setup();
    expect(wheel(100).defaultPrevented).toBe(false);
    preferences.set("vaultly.reader.scrollSensitivity", 200);
    expect(wheel(100, 0, true).defaultPrevented).toBe(false);
    expect(element.scrollTop).toBe(0);
  });
});
