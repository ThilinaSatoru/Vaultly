import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as Array<{ current: any }>, cursor: 0, refCursor: 0, jobs: [] as Array<() => void> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useContext: () => null,
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refCursor++] ??= { current: initial },
  useMemo: (compute: () => unknown) => compute(),
  useEffect: (effect: () => void) => { hooks.jobs.push(effect); },
  useLayoutEffect: vi.fn(),
}));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
import { TagCombobox } from "./TagCombobox";

function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (isValidElement<any>(node)) return predicate(node) ? node : find(node.props.children, predicate);
  if (Array.isArray(node)) for (const child of node) { const match = find(child, predicate); if (match) return match; }
}
const props = { label: "Tags", tags: [], selectedIds: [], attributeKind: "tag" as const, onChange: vi.fn() };
function render(extra = {}) {
  hooks.cursor = 0; hooks.refCursor = 0;
  const node = TagCombobox({ ...props, ...extra });
  hooks.jobs.splice(0).forEach((job) => job());
  return node;
}
beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.jobs = [];
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

test("clicking the still-focused input reopens options after dismissing them", () => {
  let node = render();
  const input = find(node, (element) => element.type === "input")!;
  input.props.ref.current = { focus: vi.fn() };
  input.props.onFocus();
  node = render();
  find(node, (element) => element.type === "input")!.props.onKeyDown({ key: "Tab" });
  node = render();
  expect(find(node, (element) => element.type === "input")!.props["aria-expanded"]).toBe(false);
  find(node, (element) => element.props.className === "tag-combobox-control")!.props.onClick();
  node = render();
  expect(find(node, (element) => element.type === "input")!.props["aria-expanded"]).toBe(true);
});

test("creation restores focus only after both creation and assignment finish", async () => {
  const onCreate = vi.fn().mockResolvedValue({ id: 1, name: "Travel" });
  let node = render({ onCreate });
  const focus = vi.fn();
  find(node, (element) => element.type === "input")!.props.ref.current = { focus };
  find(node, (element) => element.type === "input")!.props.onChange({ target: { value: "Travel" } });
  node = render({ onCreate });
  find(node, (element) => element.type === "input")!.props.onKeyDown({ key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() });
  render({ onCreate });
  await Promise.resolve();
  node = render({ onCreate, disabled: true });
  expect(focus).not.toHaveBeenCalled();
  expect(find(node, (element) => element.type === "input")!.props.disabled).toBe(true);
  node = render({ onCreate, disabled: false });
  expect(focus).toHaveBeenCalledOnce();
  expect(find(node, (element) => element.type === "input")!.props.disabled).toBe(false);
});
