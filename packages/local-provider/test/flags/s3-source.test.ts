import { S3 } from "@aws-sdk/client-s3";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createFileSnapshotStore,
  createSnapshotVerifier,
  signFlagSnapshot
} from "../../src/index.js";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  createS3SnapshotSource,
  createSnapshotRefresher,
  createReloadableLocalProvider,
  type S3SnapshotClient,
  type S3SnapshotSourceOptions
} from "../../src/index.js";

let endpoint: string;
let handle: (request: IncomingMessage, response: ServerResponse) => void;
const server = createServer((request, response) => handle(request, response));
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture address");
  endpoint = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function source(client: S3SnapshotClient, options: Partial<S3SnapshotSourceOptions> = {}) {
  return createS3SnapshotSource({
    client,
    bucket: "snapshot-bucket",
    key: "flags/한국어.json",
    maxAttempts: 1,
    ...options
  });
}
function sdk() {
  // Explicit anonymous public-object auth: no fabricated credentials or cloud calls.
  return new S3({
    endpoint,
    region: "auto",
    forcePathStyle: true,
    maxAttempts: 1,
    httpAuthSchemeProvider: () => [{ schemeId: "smithy.api#noAuth" }],
    httpAuthSchemes: [
      {
        schemeId: "smithy.api#noAuth",
        identityProvider: () => async () => ({}),
        signer: { sign: async (request) => request }
      }
    ]
  });
}

it("uses the actual AWS SDK protocol and conditional exception without credentials", async () => {
  const client = sdk();
  const requests: IncomingMessage[] = [];
  handle = (request, response) => {
    requests.push(request);
    if (request.headers["if-none-match"]) response.writeHead(304).end();
    else response.writeHead(200, { etag: '"opaque"', "content-length": 2 }).end("{}");
  };
  try {
    const adapter = source(client);
    const first = await adapter.fetch();
    expect(first).toEqual({ status: "content", content: Buffer.from("{}"), etag: '"opaque"' });
    expect(await adapter.fetch({ etag: '"opaque"' })).toEqual({ status: "notModified" });
    expect(decodeURIComponent(requests[0]?.url ?? "")).toContain(
      "/snapshot-bucket/flags/한국어.json"
    );
    expect(requests[1]?.headers["if-none-match"]).toBe('"opaque"');
    expect(requests.every((request) => request.headers.authorization === undefined)).toBe(true);
  } finally {
    client.destroy();
  }
});

it.each(['"one"', undefined])(
  "captures SDK response ETag %j before consuming its body",
  async (etag) => {
    const snapshot = (variant: "on" | "off") => ({
      schemaVersion: 1 as const,
      flags: {
        feature: {
          type: "boolean" as const,
          defaultVariant: variant,
          variants: { off: false, on: true }
        }
      }
    });
    const bytes = Buffer.from(JSON.stringify(snapshot("on")));
    async function* body() {
      yield bytes.subarray(0, 10);
      await new Promise<void>((resolve) => setImmediate(resolve));
      response.ETag = '"two"';
      yield bytes.subarray(10);
    }
    const response = { ETag: etag, ContentLength: bytes.length, Body: body() };
    const getObject = vi
      .fn<S3SnapshotClient["getObject"]>()
      .mockResolvedValueOnce(response)
      .mockImplementation(async (input) =>
        input.IfNoneMatch === '"two"'
          ? { $metadata: { httpStatusCode: 304 } }
          : { ETag: '"two"', Body: Readable.from([Buffer.from(JSON.stringify(snapshot("off")))]) }
      );
    const provider = createReloadableLocalProvider({ snapshot: snapshot("off"), env: {} });
    const refresher = createSnapshotRefresher({ provider, source: source({ getObject }) });
    try {
      await refresher.refresh();
      expect(provider.getSnapshot()).toEqual(snapshot("on"));
      await refresher.refresh();
      expect(provider.getSnapshot()).toEqual(snapshot("off"));
      expect(getObject.mock.calls[1]?.[0].IfNoneMatch).toBe(etag);
    } finally {
      refresher.close();
      await provider.onClose?.();
    }
  }
);

it("streams web, Blob and Node bytes, copies buffers and rejects invalid or oversized bodies", async () => {
  const reused = Buffer.alloc(1);
  async function* tinyChunks() {
    for (let i = 0; i < 2048; i++) {
      reused[0] = i % 2 ? 98 : 97;
      yield reused;
    }
  }
  const copied = await source({
    async getObject() {
      return { Body: tinyChunks() };
    }
  }).fetch();
  expect(copied.status === "content" && Buffer.from(copied.content).toString()).toBe(
    "ab".repeat(1024)
  );
  for (const body of [
    Readable.from([Buffer.from("ok")]),
    new Blob(["ok"]),
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([111, 107]));
        controller.close();
      }
    })
  ]) {
    expect(
      await source({
        async getObject() {
          return { Body: body, ContentLength: 2 };
        }
      }).fetch()
    ).toEqual({ status: "content", content: Buffer.from("ok") });
  }
  for (const response of [
    { Body: Readable.from([Buffer.from("123")]), ContentLength: 3 },
    { Body: Readable.from([Buffer.from("123")]) },
    { Body: Readable.from([Buffer.from("1")]), ContentLength: 2 },
    { Body: Readable.from(["text"]) },
    { ContentLength: 0 },
    { Body: Readable.from([]), ContentLength: -1 },
    { Body: Readable.from([]), ContentEncoding: "gzip" },
    { Body: Readable.from([]), $metadata: { httpStatusCode: 206 } }
  ])
    await expect(
      source(
        {
          async getObject() {
            return response;
          }
        },
        { maxBytes: 2 }
      ).fetch()
    ).rejects.toThrow();
  await expect(
    source({
      async getObject() {
        return { $metadata: { httpStatusCode: 304 } };
      }
    }).fetch()
  ).rejects.toThrow("Unexpected");
});

it("lets event-loop work run while consuming immediately resolved empty chunks", async () => {
  let eventLoopRan = false,
    chunks = 0;
  const scheduled = setImmediate(() => {
    eventLoopRan = true;
  });
  async function* body() {
    while (!eventLoopRan && chunks < 10000) {
      chunks++;
      yield new Uint8Array();
    }
    yield Buffer.from("ok");
  }
  try {
    await expect(
      source({
        async getObject() {
          return { Body: body() };
        }
      }).fetch()
    ).resolves.toEqual({ status: "content", content: Buffer.from("ok") });
    expect(eventLoopRan).toBe(true);
    expect(chunks).toBeLessThan(10000);
  } finally {
    clearImmediate(scheduled);
  }
});

it.each(["abort", "timeout"])(
  "interrupts an empty-chunk burst on %s without retrying or draining it",
  async (mode) => {
    let chunks = 0,
      closed = false;
    const controller = new AbortController();
    const getObject = vi.fn(async () => ({
      Body: (async function* () {
        try {
          while (chunks < 1000000) {
            chunks++;
            yield new Uint8Array();
          }
        } finally {
          closed = true;
        }
      })()
    }));
    const scheduled = mode === "abort" ? setImmediate(() => controller.abort()) : undefined;
    try {
      await expect(
        source({ getObject }, { timeoutMs: mode === "timeout" ? 1 : 1000 }).fetch({
          signal: controller.signal
        })
      ).rejects.toThrow(mode === "timeout" ? "timed out" : "cancelled");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(chunks).toBeLessThan(1000000);
      expect(closed).toBe(true);
      expect(getObject).toHaveBeenCalledOnce();
    } finally {
      if (scheduled !== undefined) clearImmediate(scheduled);
    }
  }
);

it("caps stalled SDK waiting at the total deadline without starting another attempt", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const getObject = vi.fn<S3SnapshotClient["getObject"]>(() => new Promise(() => {}));
  const waiting = source(
    { getObject },
    { timeoutMs: 1000, totalTimeoutMs: 25, maxAttempts: 3 }
  ).fetch();
  const rejected = expect(waiting).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(25);
  await rejected;
  expect(getObject).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds ignored transport and iterator aborts and closes late bodies", async () => {
  let resolve!: (response: { Body: Readable }) => void;
  const pending = new Promise<{ Body: Readable }>((done) => {
    resolve = done;
  });
  await expect(source({ getObject: () => pending }, { timeoutMs: 15 }).fetch()).rejects.toThrow(
    "timed out"
  );
  const body = Readable.from([Buffer.from("late")]);
  resolve({ Body: body });
  await new Promise((done) => setImmediate(done));
  expect(body.destroyed).toBe(true);
  const returned = vi.fn(() => new Promise<IteratorResult<Uint8Array>>(() => {}));
  const stalled = {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}), return: returned };
    }
  };
  await expect(
    source(
      {
        async getObject() {
          return { Body: stalled };
        }
      },
      { timeoutMs: 15 }
    ).fetch()
  ).rejects.toThrow("timed out");
  expect(returned).toHaveBeenCalled();
  const controller = new AbortController();
  const operation = source({ getObject: () => new Promise(() => {}) }, { timeoutMs: 1000 }).fetch({
    signal: controller.signal
  });
  controller.abort();
  await expect(operation).rejects.toThrow("cancelled");
});

it("retries only bounded transient failures and cancels retry backoff", async () => {
  const getObject = vi
    .fn<S3SnapshotClient["getObject"]>()
    .mockRejectedValue({ $metadata: { httpStatusCode: 503 } });
  await expect(source({ getObject }, { maxAttempts: 3, retryDelayMs: 0 }).fetch()).rejects.toThrow(
    "failed"
  );
  expect(getObject).toHaveBeenCalledTimes(3);
  getObject.mockClear().mockRejectedValue({
    $metadata: { httpStatusCode: 403 },
    message: "private endpoint and credentials"
  });
  await expect(source({ getObject }, { maxAttempts: 3 }).fetch()).rejects.toThrow(
    /^S3 snapshot request failed\.$/
  );
  expect(getObject).toHaveBeenCalledOnce();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const controller = new AbortController();
  getObject.mockClear().mockImplementation(async () => {
    setTimeout(() => controller.abort(), 5);
    throw { $metadata: { httpStatusCode: 503 } };
  });
  await expect(
    source({ getObject }, { retryDelayMs: 1000, maxAttempts: 3 }).fetch({
      signal: controller.signal
    })
  ).rejects.toThrow("cancelled");
  expect(getObject).toHaveBeenCalledOnce();
});

it("rejects SDK errors through the actual protocol and preserves the last good snapshot offline", async () => {
  const client = sdk();
  const snapshot = {
    schemaVersion: 1 as const,
    flags: {
      feature: {
        type: "boolean" as const,
        defaultVariant: "off",
        variants: { off: false, on: true }
      }
    }
  };
  const provider = createReloadableLocalProvider({ snapshot, env: {} });
  let count = 0;
  let fail = false;
  handle = (_request, response) => {
    count++;
    if (fail)
      response
        .writeHead(403, { "content-type": "application/xml" })
        .end("<Error><Code>AccessDenied</Code></Error>");
    else
      response.writeHead(200, { etag: '"v1"' }).end(
        JSON.stringify({
          ...snapshot,
          flags: { feature: { ...snapshot.flags.feature, defaultVariant: "on" } }
        })
      );
  };
  try {
    const refresher = createSnapshotRefresher({ provider, source: source(client) });
    await refresher.refresh();
    expect(provider.getSnapshot().flags.feature?.defaultVariant).toBe("on");
    fail = true;
    await expect(refresher.refresh()).rejects.toThrow("could not be refreshed");
    expect(provider.getSnapshot().flags.feature?.defaultVariant).toBe("on");
    const before = count;
    for (let i = 0; i < 20; i++)
      expect(
        (
          await provider.resolveBooleanEvaluation(
            "feature",
            false,
            {},
            { debug() {}, info() {}, warn() {}, error() {} }
          )
        ).value
      ).toBe(true);
    expect(count).toBe(before);
  } finally {
    client.destroy();
  }
});

it("validates bounded trusted input before work", async () => {
  const getObject = vi.fn<S3SnapshotClient["getObject"]>();
  for (const options of [
    { bucket: "" },
    { key: "\ud800" },
    { key: "a".repeat(1025) },
    { maxBytes: 0 },
    { timeoutMs: 0 },
    { maxAttempts: 6 }
  ])
    expect(() => source({ getObject }, options)).toThrow();
  await expect(source({ getObject }).fetch({ etag: "unsafe\r\n" })).rejects.toThrow(TypeError);
  expect(getObject).not.toHaveBeenCalled();
});

it("commits only verified SDK bytes and recovers the signed snapshot without network", async () => {
  const directory = await mkdtemp(join(tmpdir(), "of-s3-source-"));
  const client = sdk();
  const keys = generateKeyPairSync("ed25519");
  const verification = { trustedKeys: { origin: keys.publicKey }, audience: "s3-source-test" };
  const snapshot = {
    schemaVersion: 1 as const,
    flags: { feature: { type: "boolean" as const, defaultVariant: "on", variants: { on: true } } }
  };
  const artifact = signFlagSnapshot({
    snapshot,
    privateKey: keys.privateKey,
    keyId: "origin",
    audience: verification.audience,
    sequence: 1,
    issuedAt: Date.now() - 1000,
    expiresAt: Date.now() + 60000
  });
  const seen: Array<string | undefined> = [];
  let corrupt = false;
  handle = (request, response) => {
    seen.push(request.headers["if-none-match"] as string | undefined);
    response
      .writeHead(200, { etag: corrupt ? '"corrupt"' : '"signed"' })
      .end(corrupt ? "invalid envelope" : artifact);
  };
  try {
    const path = join(directory, "state.json");
    const store = createFileSnapshotStore({ path, verification });
    const provider = createReloadableLocalProvider({ snapshot, env: {} });
    const refresher = createSnapshotRefresher({
      provider,
      source: source(client),
      verifier: createSnapshotVerifier(verification),
      store
    });
    await refresher.refresh();
    corrupt = true;
    await expect(refresher.refresh()).rejects.toThrow();
    await expect(refresher.refresh()).rejects.toThrow();
    expect(seen).toEqual([undefined, '"signed"', '"signed"']);
    const recovered = await createFileSnapshotStore({ path, verification }).load();
    expect(recovered?.current?.provenance.sequence).toBe(1);
    expect(recovered?.current?.snapshot.flags.feature?.defaultVariant).toBe("on");
    expect(provider.getStatus().provenance?.artifactHash).toBe(
      recovered?.current?.provenance.artifactHash
    );
    refresher.close();
  } finally {
    client.destroy();
    expect(resolve(directory).startsWith(join(resolve(tmpdir()), "of-s3-source-"))).toBe(true);
    await rm(directory, { recursive: true, force: true });
  }
});
