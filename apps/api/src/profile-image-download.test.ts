import { expect, test, vi } from "vitest";
import { downloadProfileImage } from "./profile-images.js";

test("image downloads send image headers and the source page without conditional cache headers or cookies", async () => {
  const transport = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  const image = "https://babesource.com/media/galleries/69906ac745cce/01019.jpg";
  const page = "https://babesource.com/galleries/alana-rose-ftv-girls-4-203940.html";
  expect(await downloadProfileImage(image, page, transport)).toEqual(Buffer.from([1, 2, 3]));
  expect(transport).toHaveBeenCalledWith(image, expect.objectContaining({
    credentials: "omit", referrer: page,
    headers: expect.objectContaining({ Referer: page, Accept: expect.stringContaining("image/"), "User-Agent": expect.stringContaining("Mozilla/") }),
  }));
  const headers = transport.mock.calls[0]![1].headers;
  expect(headers).not.toHaveProperty("if-none-match");
  expect(headers).not.toHaveProperty("if-modified-since");
  const defaultTransport = vi.fn().mockResolvedValue(new Response("image"));
  await downloadProfileImage(image, undefined, defaultTransport);
  expect(defaultTransport.mock.calls[0]![1].headers.Referer).toBe("https://babesource.com/");
});

test("connection failures and host refusals explain how to recover", async () => {
  const timeout = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }));
  await expect(downloadProfileImage("https://example.com/image.jpg", undefined, timeout)).rejects.toThrow("Connection to example.com timed out");
  const denied = vi.fn().mockResolvedValue(new Response("denied", { status: 403 }));
  await expect(downloadProfileImage("https://example.com/image.jpg", undefined, denied)).rejects.toThrow("HTTP 403");
  const invalidReferrer = vi.fn();
  await expect(downloadProfileImage("https://example.com/image.jpg", "file:///private", invalidReferrer)).rejects.toThrow("HTTP or HTTPS source page");
  expect(invalidReferrer).not.toHaveBeenCalled();
});

test("declared and streamed oversized images are rejected", async () => {
  const declared = vi.fn().mockResolvedValue(new Response("image", { headers: { "Content-Length": String(11 * 1024 * 1024) } }));
  await expect(downloadProfileImage("https://example.com/image.jpg", undefined, declared)).rejects.toThrow("10 MB");
  const streamed = vi.fn().mockResolvedValue(new Response(new Uint8Array(11 * 1024 * 1024)));
  await expect(downloadProfileImage("https://example.com/image.jpg", undefined, streamed)).rejects.toThrow("10 MB");
});
