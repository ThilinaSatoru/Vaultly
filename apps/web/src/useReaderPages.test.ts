import { afterEach, expect, test, vi } from "vitest";

const hooks = vi.hoisted(() => ({ refs: [] as Array<{ current: any }>, refIndex: 0, effects: [] as Array<{ deps: unknown[]; cleanup?: () => void }>, effectIndex: 0 }));
vi.mock("react", () => ({
  useRef: (value: unknown) => hooks.refs[hooks.refIndex++] ?? (hooks.refs[hooks.refIndex - 1] = { current: value }),
  useCallback: (callback: unknown) => callback,
  useLayoutEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.effectIndex++, previous = hooks.effects[index];
    if (previous && deps.every((value, i) => value === previous.deps[i])) return;
    previous?.cleanup?.(); hooks.effects[index] = { deps, cleanup: effect() };
  },
}));
import { readerPageAt, useReaderPages } from "./useReaderPages";

afterEach(() => {
  hooks.effects.forEach((effect) => effect.cleanup?.());
  hooks.refs = []; hooks.effects = []; vi.unstubAllGlobals();
});

test("continuous scrolling updates the counter without forcing another scroll; navigation always reaches the first page", () => {
  let page = 0, frame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const scrollTo = vi.fn(({ top }: { top: number }) => { container.scrollTop = top; });
  const elements = [0, 1000, 2000].map((offset) => ({ getBoundingClientRect: () => ({ top: 100 + offset - container.scrollTop }) }));
  const container = Object.assign(new EventTarget(), { scrollTop: 0, clientTop: 0, clientHeight: 600, scrollHeight: 3000,
    getBoundingClientRect: () => ({ top: 100 }), scrollTo, querySelectorAll: () => elements });
  const ref = { current: container as unknown as HTMLElement }, setPage = (next: number) => { page = next; };
  const render = (continuous = true) => {
    hooks.refIndex = 0; hooks.effectIndex = 0;
    return useReaderPages(ref, "[data-page]", continuous, page, 3, setPage, "book");
  };
  render(); scrollTo.mockClear();
  container.scrollTop = 1050; container.dispatchEvent(new Event("scroll"));
  for (const callback of frames.values()) callback(16); frames.clear();
  expect(page).toBe(1); render(); expect(scrollTo).not.toHaveBeenCalled();
  const navigate = render(); navigate(0); expect(page).toBe(0); expect(container.scrollTop).toBe(0);
  container.scrollTop = 80; navigate(0); expect(container.scrollTop).toBe(0);
  navigate(2); expect(container.scrollTop).toBe(2000);
  render(false); expect(page).toBe(2); expect(container.scrollTop).toBe(0);
  render(true); expect(page).toBe(2); expect(container.scrollTop).toBe(2000);
});

test("page lookup handles large variable-height pages and empty content", () => {
  const positions = [0, 1300, 1500, 4000].map((top) => ({ getBoundingClientRect: () => ({ top }) as DOMRect }));
  expect(readerPageAt(positions, 100)).toBe(0);
  expect(readerPageAt(positions, 1499)).toBe(1);
  expect(readerPageAt(positions, 1500)).toBe(2);
  expect(readerPageAt(positions, 9000)).toBe(3);
  expect(readerPageAt([], 0)).toBe(0);
});
