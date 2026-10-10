import { expect, test, vi } from "vitest";
const { element, effects } = vi.hoisted(() => ({ element: { scrollTop: 0, scrollHeight: 400 }, effects: [] as Array<() => unknown> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: () => ({ current: element }),
  useLayoutEffect: (effect: () => unknown) => effects.push(effect),
}));
import { LogView } from "./LogView";

test("fixed-container logs scroll to the newest content when updated", () => {
  effects.length = 0;
  const view = LogView({ children: "First entry", revision: 1 });
  expect(view.props.className).toBe("process-log");
  expect(view.props.role).toBe("log");
  effects.pop()!();
  expect(element.scrollTop).toBe(400);
  element.scrollHeight = 800;
  LogView({ children: "Next entry", revision: 2 });
  effects.pop()!();
  expect(element.scrollTop).toBe(800);
});
