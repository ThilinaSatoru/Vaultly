import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BackgroundStatusView, type BackgroundTask } from "./BackgroundStatus";

const task: BackgroundTask = { id: "source-1", label: "My library", detail: "Categorizing media", processed: 5, total: 20, target: "sources" };
test("shows simultaneous tasks with their own progress", () => {
  const html = renderToStaticMarkup(<BackgroundStatusView available tasks={[task, { ...task, id: "profile-1", label: "Profile photos", processed: 10, total: 20, target: "people" }]} onOpen={vi.fn()} />);
  expect(html).toContain("2 running");
  expect(html).toContain("My library");
  expect(html).toContain("Profile photos");
  expect(html).toContain('aria-valuenow="25"');
  expect(html).toContain('aria-valuenow="50"');
  expect(html).toContain("5 / 20");
});
test("unknown totals show activity without inventing a percentage", () => {
  const html = renderToStaticMarkup(<BackgroundStatusView available tasks={[{ ...task, detail: "Reading folders", processed: null, total: null }]} onOpen={vi.fn()} />);
  expect(html).toContain("indeterminate");
  expect(html).not.toContain("aria-valuenow");
});
test("distinguishes idle from an unavailable status endpoint", () => {
  expect(renderToStaticMarkup(<BackgroundStatusView available tasks={[]} onOpen={vi.fn()} />)).toContain("No tasks running");
  expect(renderToStaticMarkup(<BackgroundStatusView available={false} tasks={[]} onOpen={vi.fn()} />)).toContain("Status unavailable");
});
