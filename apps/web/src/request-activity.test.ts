import { expect, test, vi } from "vitest";
import { beginRequestActivity, getRequestActivity, subscribeRequestActivity } from "./request-activity";

test("concurrent operations finish independently and cleanup is idempotent", () => {
  const changed = vi.fn();
  const unsubscribe = subscribeRequestActivity(changed);
  const first = beginRequestActivity("Upload", "Reading JSON", "people");
  const second = beginRequestActivity("Save", "Updating database");
  try {
    expect(getRequestActivity()).toHaveLength(2);
    first(); first();
    expect(getRequestActivity().map((task) => task.label)).toEqual(["Save"]);
    expect(changed).toHaveBeenCalledTimes(3);
  } finally { first(); second(); unsubscribe(); }
  expect(getRequestActivity()).toEqual([]);
});

test("upload progress updates the same activity and cannot revive a finished task", () => {
  const finish = beginRequestActivity("Uploading people", "Reading JSON", "people");
  const id = getRequestActivity()[0].id;
  finish.update("Importing attributes", 10000, 25000);
  expect(getRequestActivity()).toEqual([{ id, label: "Uploading people", detail: "Importing attributes", processed: 10000, total: 25000, target: "people" }]);
  finish();
  finish.update("Importing attributes", 25000, 25000);
  expect(getRequestActivity()).toEqual([]);
});
