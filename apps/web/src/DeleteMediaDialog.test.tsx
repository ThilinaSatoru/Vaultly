import { beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === "function" ? value(hooks.states[index]) : value; }];
  },
}));
vi.mock("./media", () => ({ api: vi.fn() }));
import { api } from "./media";
import { DeleteMediaDialog } from "./DeleteMediaDialog";
import { BulkActionDialog } from "./BulkActionDialog";

const props = { itemIds: [1, 2], onDeleted: vi.fn(), onClose: vi.fn() };
function render(extra = {}) { hooks.cursor = 0; return DeleteMediaDialog({ ...props, ...extra }); }
function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (isValidElement<any>(node)) return predicate(node) ? node : find(node.props.children, predicate);
  if (Array.isArray(node)) for (const child of node) { const result = find(child, predicate); if (result) return result; }
}
const confirm = (node: ReactNode) => find(node, (element) => element.type === "button" && element.props.className === "danger-button")!;
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { hooks.states = []; vi.clearAllMocks(); });

test("waits for confirmation and lets the user cancel without deleting", () => {
  const node = render();
  expect(api).not.toHaveBeenCalled();
  find(node, (element) => element.type === "button" && element.props.children === "Cancel")!.props.onClick();
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(api).not.toHaveBeenCalled();
});

test("deletes a single item through DELETE and reports completion", async () => {
  vi.mocked(api).mockResolvedValue({ deletedIds: [9], failures: [] });
  confirm(render({ itemIds: [9], title: "A movie" })).props.onClick();
  await settle();
  expect(api).toHaveBeenCalledWith("/api/items/9", { method: "DELETE" });
  expect(props.onDeleted).toHaveBeenCalledWith([9]);
  expect(props.onClose).toHaveBeenCalledOnce();
});

test("bulk deletion keeps failed IDs for retry and reports successes immediately", async () => {
  vi.mocked(api).mockResolvedValueOnce({ deletedIds: [1], failures: [{ id: 2, message: "File is locked" }] });
  confirm(render()).props.onClick();
  await settle();
  expect(api).toHaveBeenCalledWith("/api/items/bulk-delete", { method: "POST", body: JSON.stringify({ itemIds: [1, 2] }) });
  expect(props.onDeleted).toHaveBeenCalledWith([1]);
  expect(props.onClose).not.toHaveBeenCalled();
  const node = render();
  expect(find(node, (element) => element.props.role === "alert")!.props.children).toContain("File is locked");
  vi.mocked(api).mockResolvedValueOnce({ deletedIds: [2], failures: [] });
  confirm(node).props.onClick();
  await settle();
  expect(api).toHaveBeenLastCalledWith("/api/items/2", { method: "DELETE" });
  expect(props.onClose).toHaveBeenCalledOnce();
});

test("disables confirmation and dismissal while a delete request is running", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api).mockReturnValue(new Promise((done) => { resolve = done; }));
  confirm(render()).props.onClick();
  const node = render();
  expect(confirm(node).props.disabled).toBe(true);
  node.props.onMouseDown();
  expect(props.onClose).not.toHaveBeenCalled();
  resolve({ deletedIds: [1, 2], failures: [] });
  await settle();
});

test("request errors leave the selection available to retry", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Disconnected"));
  confirm(render()).props.onClick(); await settle();
  const node = render();
  expect(find(node, (element) => element.props.role === "alert")!.props.children).toBe("Disconnected");
  expect(confirm(node).props.disabled).toBe(false);
  expect(props.onDeleted).not.toHaveBeenCalled();
});

test("bulk actions opens the same permanent deletion confirmation", () => {
  const bulkProps = { ...props, tags: [], categories: [], people: [], series: [], onTagCreated: vi.fn(), onCategoryCreated: vi.fn(), onPersonCreated: vi.fn(), onSeriesCreated: vi.fn(), onDone: vi.fn() };
  const renderBulk = () => { hooks.cursor = 0; return BulkActionDialog(bulkProps); };
  confirm(renderBulk()).props.onClick();
  const node = renderBulk();
  expect(node.type).toBe(DeleteMediaDialog);
  expect(node.props.itemIds).toEqual([1, 2]);
  expect(api).not.toHaveBeenCalled();
});
