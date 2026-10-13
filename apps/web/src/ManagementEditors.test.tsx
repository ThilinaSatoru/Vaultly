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
import { Select } from "./Select";

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

test("people credit filters combine with exact-first search and reset when reopened in another library", () => {
  const people = [
    { id: 1, name: "Alice extended", cast_count: 1, artist_count: 0 },
    { id: 2, name: "Alice", cast_count: 1, artist_count: 0 },
    { id: 3, name: "Painter", cast_count: 0, artist_count: 2 },
    { id: 4, name: "Unused", cast_count: 0, artist_count: 0 },
  ];
  let creditFilterRequest = { filter: "cast" as "cast" | "artist", revision: 1 };
  const component = () => PeopleView({ people, onChanged: vi.fn(), creditFilterRequest });
  const collect = (node: ReactNode): ReactElement<any>[] => isValidElement<any>(node)
    ? [node, ...collect(node.props.children)] : Array.isArray(node) ? node.flatMap(collect) : [];
  const names = (node: ReactNode) => collect(node).filter((element) => element.props.className === "person-profile-name")
    .map((element) => element.props.children.props.name);
  let node = render(component);
  expect(names(node)).toEqual(["Alice", "Alice extended"]);
  find(node, (element) => element.props["aria-label"] === "Search attributes")!.props.onChange({ target: { value: "Alice" } });
  node = render(component);
  expect(names(node)[0]).toBe("Alice");
  find(node, (element) => element.type === Select && element.props["aria-label"] === "Filter people by credits")!.props.onChange({ target: { value: "all" } });
  node = render(component);
  find(node, (element) => element.props["aria-label"] === "Search attributes")!.props.onChange({ target: { value: "" } });
  node = render(component);
  expect(names(node)).toHaveLength(4);
  creditFilterRequest = { filter: "artist", revision: 2 };
  render(component); // React retries a render after applying a new opening context.
  node = render(component);
  expect(names(node)).toEqual(["Painter"]);
});

test("an exact attribute match reaches the first page even after 150 partial matches", () => {
  const tags = [...Array.from({ length: 150 }, (_, id) => ({ id: id + 1, name: `A sample ${id}` })), { id: 200, name: "Sample" }];
  const component = () => TagsView({ tags, onChanged: vi.fn() });
  let node = render(component);
  find(node, (element) => element.props["aria-label"] === "Search attributes")!.props.onChange({ target: { value: "sample" } });
  node = render(component);
  const row = find(node, (element) => element.props.className === "category-row")!;
  const name = find(row, (element) => element.props.name === "Sample");
  expect(name).toBeDefined();
});
