import { EventEmitter } from "node:events";
import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createHttpsSnapshotSource } from "../../src/index.js";

vi.mock("node:https", async (original) => {
  const actual = await original<typeof import("node:https")>();
  return { ...actual, request: vi.fn() };
});
afterEach(() => vi.restoreAllMocks());

function responseFor(content: Buffer, chunkBytes: number) {
  const destroy = vi.fn();
  const response = {
    statusCode: 200,
    headers: { etag: '"body"' },
    destroy,
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index < content.length; index += chunkBytes)
        yield Buffer.from(content.subarray(index, index + chunkBytes));
    }
  };
  vi.mocked(httpsRequest).mockImplementation((...args: unknown[]) => {
    const listener = args.at(-1);
    const request = new EventEmitter() as ClientRequest;
    request.end = vi.fn(() => {
      queueMicrotask(() => {
        if (typeof listener !== "function") throw new Error("Missing response callback");
        listener(response as unknown as IncomingMessage);
      });
      return request;
    });
    return request;
  });
  return destroy;
}

it.each([
  [4096, 1],
  [131073, 33]
])(
  "bounds retained buffers independently of incoming fragmentation (%i bytes / %i per chunk)",
  async (size, chunkBytes) => {
    const expected = Buffer.from(Array.from({ length: size }, (_, index) => index % 251));
    const destroy = responseFor(expected, chunkBytes);
    const concat = vi.spyOn(Buffer, "concat");
    const result = await createHttpsSnapshotSource({
      url: "https://example.invalid/flags",
      maxAttempts: 1,
      maxBytes: size
    }).fetch();
    if (result.status !== "content") throw new Error("Missing body");
    expect(Buffer.from(result.content).equals(expected)).toBe(true);
    expect(concat.mock.calls.at(-1)?.[0]).toHaveLength(Math.ceil(size / (64 * 1024)));
    expect(result.etag).toBe('"body"');
    expect(destroy).toHaveBeenCalledOnce();
  }
);

it("rejects byte-limit overflow before concatenation and releases the response", async () => {
  const destroy = responseFor(Buffer.alloc(4097), 1);
  const concat = vi.spyOn(Buffer, "concat");
  await expect(
    createHttpsSnapshotSource({
      url: "https://example.invalid/flags",
      maxAttempts: 1,
      maxBytes: 4096
    }).fetch()
  ).rejects.toThrow("HTTPS snapshot exceeds maxBytes.");
  expect(concat).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalledOnce();
});
