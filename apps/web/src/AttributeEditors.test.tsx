import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, effectCursor: 0,
  effects: [] as Array<{ deps: unknown[]; cleanup?: () => void }>, jobs: [] as Array<() => void>,
  dialog: null as unknown,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value; }];
  },
  useRef: () => ({ current: hooks.dialog }),
  useId: () => "editor-title",
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.effectCursor++;
    const previous = hooks.effects[index];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects[index] = { deps, cleanup: effect() }; });
  },
}));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("./media", () => ({ api: vi.fn() }));
import { api } from "./media";
import { AttributePatterns } from "./AttributePatterns";
import { AttributeEditorDialog } from "./AttributeEditorDialog";
import { RenameAttributeDialog } from "./RenameAttributeDialog";

function render(component: () => ReactNode) {
  hooks.cursor = 0; hooks.effectCursor = 0;
  const node = component();
  hooks.jobs.splice(0).forEach((job) => job());
  return node;
}
// Inspect the public controls returned by these components without adding a DOM dependency.
function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> {
  if (isValidElement<any>(node)) {
    if (predicate(node)) return node;
    return find((node.props as { children?: ReactNode }).children, predicate);
  }
  if (Array.isArray(node)) {
    for (const child of node) { try { return find(child, predicate); } catch { /* Try the next sibling. */ } }
  }
  throw new Error("Control not found");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const attribute = { id: 7, name: "Travel" };

beforeEach(() => { hooks.states = []; hooks.cursor = 0; hooks.effectCursor = 0; hooks.effects = []; hooks.jobs = []; vi.mocked(api).mockReset(); });
afterEach(() => { hooks.effects.forEach((effect) => effect.cleanup?.()); vi.unstubAllGlobals(); });

describe("attribute editors", () => {
  it("recovers an uneditable pattern field after a failed load", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("Load failed")).mockResolvedValueOnce({ patterns: ["Holiday"] });
    const component = () => AttributePatterns({ kind: "tags", attribute, onChanged: vi.fn() });
    let node = render(component);
    find(node, (element) => element.type === "button").props.onClick();
    render(component); await settle(); node = render(component);
    expect(find(node, (element) => element.type === "textarea").props.disabled).toBe(true);
    find(node, (element) => element.props.children === "Retry loading patterns").props.onClick();
    render(component); await settle(); node = render(component);
    const input = find(node, (element) => element.type === "textarea");
    expect(input.props.disabled).toBe(false);
    expect(input.props.value).toBe("Holiday");
    expect(find(node, (element) => element.type === AttributeEditorDialog).props.focusReady).toBe(true);
  });

  it("ignores a stale pattern response after closing and reopening the editor", async () => {
    const oldLoad = deferred<{ patterns: string[] }>();
    vi.mocked(api).mockReturnValueOnce(oldLoad.promise).mockResolvedValueOnce({ patterns: ["Current"] });
    const component = () => AttributePatterns({ kind: "tags", attribute, onChanged: vi.fn() });
    let node = render(component);
    find(node, (element) => element.type === "button").props.onClick(); node = render(component);
    find(node, (element) => element.type === AttributeEditorDialog).props.onClose(); node = render(component);
    find(node, (element) => element.type === "button").props.onClick(); render(component); await settle();
    oldLoad.resolve({ patterns: ["Stale"] }); await settle(); node = render(component);
    expect(find(node, (element) => element.type === "textarea").props.value).toBe("Current");
  });

  it("allows editing another tag immediately after saving a pattern", async () => {
    vi.mocked(api).mockResolvedValueOnce({ patterns: ["Holiday"] }).mockResolvedValueOnce({ patterns: ["Holiday"] }).mockResolvedValueOnce({ patterns: ["Second phrase"] });
    let currentAttribute = attribute;
    const onChanged = vi.fn();
    const component = () => AttributePatterns({ kind: "tags", attribute: currentAttribute, onChanged });
    let node = render(component);
    find(node, (element) => element.type === "button").props.onClick(); render(component); await settle(); node = render(component);
    await find(node, (element) => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
    expect(onChanged).toHaveBeenCalledOnce();
    currentAttribute = { id: 8, name: "Second tag" }; node = render(component);
    find(node, (element) => element.type === "button").props.onClick(); render(component); await settle(); node = render(component);
    expect(find(node, (element) => element.type === "textarea").props).toMatchObject({ value: "Second phrase", disabled: false });
    expect(api).toHaveBeenLastCalledWith("/api/attributes/tags/8/patterns", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("saves a tag name through an in-app form and keeps failed edits editable", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("That tag already exists.")).mockResolvedValueOnce({ id: 7, name: "Trips" });
    const onSaved = vi.fn(), onClose = vi.fn();
    const component = () => RenameAttributeDialog({ kind: "tags", attribute, onSaved, onClose });
    let node = render(component);
    find(node, (element) => element.type === "input").props.onChange({ target: { value: "Trips" } }); node = render(component);
    await find(node, (element) => element.type === "form").props.onSubmit({ preventDefault: vi.fn() }); node = render(component);
    expect(onClose).not.toHaveBeenCalled();
    expect(find(node, (element) => element.type === "input").props).toMatchObject({ value: "Trips", disabled: false });
    expect(find(node, (element) => element.props.role === "alert").props.children).toBe("That tag already exists.");
    await find(node, (element) => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
    expect(api).toHaveBeenLastCalledWith("/api/tags/7", { method: "PATCH", body: '{"name":"Trips"}' });
    expect(onSaved).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
  });

  it("focuses the input when loading finishes and restores focus when closed", () => {
    const input = { focus: vi.fn() }, previous = { focus: vi.fn(), isConnected: true };
    class FakeElement {}
    Object.setPrototypeOf(previous, FakeElement.prototype);
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("document", { body: { style: { overflow: "auto" } }, activeElement: previous });
    hooks.dialog = { focus: vi.fn(), querySelector: () => input };
    const onClose = vi.fn();
    render(() => AttributeEditorDialog({ title: "Patterns", children: null, onClose, focusReady: false }));
    expect(input.focus).not.toHaveBeenCalled();
    render(() => AttributeEditorDialog({ title: "Patterns", children: null, onClose, focusReady: true }));
    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
    hooks.effects[0].cleanup?.();
    expect(previous.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.body.style.overflow).toBe("auto");
  });
});
