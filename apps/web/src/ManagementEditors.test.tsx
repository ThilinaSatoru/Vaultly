import { beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value; }];
  },
}));
import { TagsView } from "./TagsView";
import { CategoriesView } from "./CategoriesView";
import { PeopleView } from "./PeopleView";
import { AttributePatternButton, AttributePatterns } from "./AttributePatterns";

function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (isValidElement<any>(node)) return predicate(node) ? node : find((node.props as { children?: ReactNode }).children, predicate);
  if (Array.isArray(node)) {
    for (const child of node) { const match = find(child, predicate); if (match) return match; }
  }
}
const render = (component: () => ReactNode) => { hooks.cursor = 0; return component(); };
beforeEach(() => { hooks.states = []; hooks.cursor = 0; });

test.each(["tags", "categories", "people"] as const)("%s pattern editor survives its row disappearing during a background refresh", (kind) => {
  let entries = [{ id: 7, name: "Editing this", item_count: 0 }];
  const onChanged = vi.fn();
  const component = () => kind === "tags" ? TagsView({ tags: entries, onChanged })
    : kind === "categories" ? CategoriesView({ categories: entries, onChanged })
      : PeopleView({ people: entries, onChanged });
  let node = render(component);
  find(node, (element) => element.type === AttributePatternButton)!.props.onClick();
  node = render(component);
  expect(find(node, (element) => element.type === AttributePatterns)?.props.attribute.id).toBe(7);
  // A scan, profile update, or usage filter can remove a row while its editor is open.
  entries = [];
  node = render(component);
  const editor = find(node, (element) => element.type === AttributePatterns)!;
  expect(editor.props.attribute).toMatchObject({ id: 7, name: "Editing this" });
  expect(find(node, (element) => element.type === AttributePatternButton)).toBeUndefined();
  editor.props.onClose();
  expect(find(render(component), (element) => element.type === AttributePatterns)).toBeUndefined();
});

test.each(["tags", "categories", "people"] as const)("%s renders at most 100 of 12k attributes and resets pagination on search", (kind) => {
  const entries = Array.from({ length: 12000 }, (_, id) => ({ id: id + 1, name: `Person ${id}`, item_count: 0 }));
  const onChanged = vi.fn();
  const component = () => kind === "tags" ? TagsView({ tags: entries, onChanged })
    : kind === "categories" ? CategoriesView({ categories: entries, onChanged })
      : PeopleView({ people: entries, onChanged });
  const collect = (node: ReactNode): ReactElement<any>[] => {
    if (isValidElement<any>(node)) return [node, ...collect(node.props.children)];
    if (Array.isArray(node)) return node.flatMap(collect);
    return [];
  };
  let node = render(component);
  const rows = () => collect(node).filter((element) => element.props.className === (kind === "people" ? "person-profile-card" : "category-row"));
  expect(rows()).toHaveLength(100);
  find(node, (element) => element.type === "button" && element.props.children === "Next")!.props.onClick();
  node = render(component);
  expect(rows()).toHaveLength(100);
  expect(find(node, (element) => element.type === "button" && element.props.children === "Previous")!.props.disabled).toBe(false);
  find(node, (element) => element.props["aria-label"] === "Search attributes")!.props.onChange({ target: { value: "11999" } });
  node = render(component);
  expect(rows()).toHaveLength(1);
  expect(find(node, (element) => element.props["aria-label"] === "Attribute pages")).toBeUndefined();
});
