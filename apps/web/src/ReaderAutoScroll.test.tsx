import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const hooks = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[], effects: [] as Array<{ dependencies?: unknown[]; cleanup?: () => void }>, effectCursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value; }];
  },
  useEffect: (effect: () => (() => void) | undefined, dependencies: unknown[]) => {
    const index = hooks.effectCursor++;
    const previous = hooks.effects[index];
    if (previous && dependencies.every((value, i) => value === previous.dependencies?.[i])) return;
    previous?.cleanup?.(); hooks.effects[index] = { dependencies, cleanup: effect() };
  },
}));
vi.mock("./preferences", () => ({ readNumberPreference: () => 1, matchesShortcut: (event: KeyboardEvent) => event.code === "Space" && !event.ctrlKey }));
vi.mock("./vault-session", () => ({ vaultStorage: { setItem: vi.fn() } }));
import { ReaderAutoScroll } from "./ReaderAutoScroll";

function findButton(node: ReactNode): ReactElement<any> {
  if (isValidElement<any>(node)) {
    if (node.type === "button") return node;
    return findButton(node.props.children);
  }
  if (Array.isArray(node)) for (const child of node) { try { return findButton(child); } catch { /* Next child. */ } }
  throw new Error("Missing control");
}
let now = 0, frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const windowEvents = new EventTarget(), documentEvents = new EventTarget();
const element = Object.assign(new EventTarget(), { scrollTop: 0, scrollHeight: 1100, clientHeight: 100, scrollTo: ({ top }: { top: number }) => { element.scrollTop = Math.floor(top); } });
const scrollRef = { current: element as unknown as HTMLElement };
function render(contentKey = 1, enabled = true) {
  hooks.cursor = 0; hooks.effectCursor = 0;
  return ReaderAutoScroll({ scrollRef, contentKey, enabled });
}
function advance(count: number) {
  for (let index = 0; index < count; index++) {
    now += 16;
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(now));
  }
}
beforeEach(() => {
  hooks.states = []; hooks.effects = []; now = 0; frameId = 0; frames.clear(); element.scrollTop = 0; element.scrollHeight = 1100;
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("window", windowEvents); vi.stubGlobal("document", Object.assign(documentEvents, { hidden: false }));
});
afterEach(() => { hooks.effects.forEach((effect) => effect.cleanup?.()); vi.unstubAllGlobals(); });
test("auto-scroll is off by default and accumulates fractional movement at one pixel per second", () => {
  expect(findButton(render()).props["aria-pressed"]).toBe(false); expect(frames.size).toBe(0);
  findButton(render()).props.onClick(); render(); advance(100);
  expect(element.scrollTop).toBe(1);
  expect(findButton(render()).props["aria-pressed"]).toBe(true);
  element.dispatchEvent(new Event("wheel"));
  expect(findButton(render()).props["aria-pressed"]).toBe(false);
  const paused = element.scrollTop; advance(100); expect(element.scrollTop).toBe(paused);
});
test("scroll stops at the end and on changing books or hiding the window", () => {
  element.scrollHeight = 101;
  findButton(render()).props.onClick(); render(); advance(100);
  expect(element.scrollTop).toBe(1); expect(findButton(render()).props["aria-pressed"]).toBe(false);
  element.scrollHeight = 1100;
  findButton(render()).props.onClick(); render();
  render(2); expect(findButton(render(2)).props["aria-pressed"]).toBe(false); expect(frames.size).toBe(0);
  findButton(render(2)).props.onClick(); render(2); windowEvents.dispatchEvent(new Event("blur"));
  expect(findButton(render(2)).props["aria-pressed"]).toBe(false);
});


test("holding the mouse pauses movement and releasing outside the reader resumes without a jump", () => {
  findButton(render()).props.onClick(); render(); advance(100);
  element.dispatchEvent(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 7 }));
  const held = element.scrollTop; advance(100);
  expect(element.scrollTop).toBe(held); expect(findButton(render()).props["aria-pressed"]).toBe(true);
  windowEvents.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 7 }));
  advance(100); expect(element.scrollTop).toBe(held + 1);
});

test("Space toggles auto-scroll, ignores repeats and stays disabled in paginated views", () => {
  const key = (repeat = false) => Object.assign(new Event("keydown", { cancelable: true }), { code: "Space", repeat });
  render(); const start = key(); windowEvents.dispatchEvent(start); render();
  expect(start.defaultPrevented).toBe(true); expect(findButton(render()).props["aria-pressed"]).toBe(true);
  windowEvents.dispatchEvent(key(true)); expect(findButton(render()).props["aria-pressed"]).toBe(true);
  advance(100); expect(element.scrollTop).toBe(1);
  windowEvents.dispatchEvent(key()); expect(findButton(render()).props["aria-pressed"]).toBe(false);
  render(1, false); windowEvents.dispatchEvent(key()); expect(findButton(render(1, false)).props["aria-pressed"]).toBe(false);
});
