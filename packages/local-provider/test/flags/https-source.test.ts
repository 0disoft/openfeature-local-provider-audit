import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderEvents } from "@openfeature/server-sdk";
import {
  createHttpsSnapshotSource,
  createReloadableLocalProvider,
  createSnapshotRefresher,
  createSnapshotVerifier,
  signFlagSnapshot,
  type FlagSnapshot,
  type HttpsSnapshotSourceOptions,
  type SnapshotSource,
  type SnapshotSourceResponse
} from "../../src/index.js";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
let server: ReturnType<typeof createServer>;
let directory: string;
let url: string;
let ca: string;
let handle: (request: IncomingMessage, response: ServerResponse) => void;
let requests: IncomingMessage[] = [];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openfeature-https-source-"));
  const windowsOpenSsl = join(
    process.env.ProgramFiles ?? "C:/Program Files",
    "Git/usr/bin/openssl.exe"
  );
  const openssl =
    process.platform === "win32" && existsSync(windowsOpenSsl) ? windowsOpenSsl : "openssl";
  // A real ephemeral key/certificate is generated for TLS, never checked in.
  execFileSync(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem")
    ],
    { stdio: "ignore" }
  );
  ca = await readFile(join(directory, "cert.pem"), "utf8");
  server = createServer(
    { key: await readFile(join(directory, "key.pem")), cert: ca },
    (request, response) => {
      requests.push(request);
      handle(request, response);
    }
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing TLS address");
  url = `https://127.0.0.1:${address.port}/flags?private-query`;
}, 15_000);

beforeEach(() => {
  requests = [];
  handle = (_request, response) => response.end(JSON.stringify(snapshot(true)));
});
afterEach(() => {
  server.closeAllConnections();
  vi.restoreAllMocks();
});
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

function source(options: Partial<HttpsSnapshotSourceOptions> = {}) {
  return createHttpsSnapshotSource({ url, ca, maxAttempts: 1, ...options });
}
function snapshot(enabled: boolean): FlagSnapshot {
  return {
    schemaVersion: 1,
    flags: {
      feature: {
        type: "boolean",
        variants: { on: true, off: false },
        defaultVariant: enabled ? "on" : "off"
      }
    }
  };
}
function content(enabled: boolean, etag = '"v1"'): SnapshotSourceResponse {
  return { status: "content", content: Buffer.from(JSON.stringify(snapshot(enabled))), etag };
}

describe("HTTPS source and local refresh", () => {
  it("verifies signed content downloaded over TLS before exposing it to evaluations", async () => {
    const signingKeys = generateKeyPairSync("ed25519");
    const token = signFlagSnapshot({
      snapshot: snapshot(true),
      privateKey: signingKeys.privateKey,
      keyId: "release",
      audience: "tls-test",
      sequence: 1,
      issuedAt: Date.now() - 1_000,
      expiresAt: Date.now() + 60_000
    });
    handle = (_request, response) => response.writeHead(200, { etag: '"signed"' }).end(token);
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    const refresh = createSnapshotRefresher({
      provider,
      source: source(),
      verifier: createSnapshotVerifier({
        audience: "tls-test",
        trustedKeys: { release: signingKeys.publicKey }
      })
    });
    const result = await refresh.refresh();
    expect(result.provenance?.snapshotHash).toBe(provider.getStatus().snapshotHash);
    expect(requests[0]?.headers.accept).toContain("application/jose");
    await expect(
      provider.resolveBooleanEvaluation("feature", false, {}, logger)
    ).resolves.toMatchObject({ value: true });
    handle = (_request, response) => response.end(token.slice(0, -2));
    await expect(refresh.refresh()).rejects.toThrow("Signed snapshot verification failed.");
    expect(provider.getSnapshot()).toEqual(snapshot(true));
    expect(refresh.getProvenance()?.sequence).toBe(1);
    refresh.close();
  });
  it("applies over verified TLS, revalidates with ETag and never fetches during evaluation", async () => {
    handle = (request, response) => {
      if (request.headers["if-none-match"] === '"v1"') response.writeHead(304).end();
      else response.writeHead(200, { etag: '"v1"' }).end(JSON.stringify(snapshot(true)));
    };
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    const refresh = createSnapshotRefresher({ provider, source: source() });
    const initial = provider.getStatus().snapshotHash;
    expect((await refresh.refresh()).status).toBe("updated");
    await expect(
      provider.resolveBooleanEvaluation("feature", false, {}, logger)
    ).resolves.toMatchObject({ value: true });
    expect(requests).toHaveLength(1);
    expect((await refresh.refresh()).status).toBe("unchanged");
    expect(requests[1]?.headers["if-none-match"]).toBe('"v1"');
    expect(provider.getStatus()).toMatchObject({ successfulRefreshes: 3, failedRefreshes: 0 });
    expect(provider.getStatus().snapshotHash).not.toBe(initial);
    refresh.close();
  });

  it("does not commit a rejected ETag and renews only the last applied snapshot on 304", async () => {
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    const refresh = createSnapshotRefresher({ provider, source: source() });
    handle = (_request, response) =>
      response.writeHead(200, { etag: '"v1"' }).end(JSON.stringify(snapshot(true)));
    await refresh.refresh();
    const good = provider.getStatus().snapshotHash;
    handle = (_request, response) => response.writeHead(200, { etag: '"bad"' }).end("private body");
    await expect(refresh.refresh()).rejects.toThrow("Snapshot source content is invalid.");
    expect(provider.getStatus()).toMatchObject({
      snapshotHash: good,
      failedRefreshes: 1,
      lastRefreshFailure: "validation"
    });
    handle = (_request, response) => response.writeHead(304).end();
    await refresh.refresh();
    expect(requests[2]?.headers["if-none-match"]).toBe('"v1"');
    expect(provider.getStatus().consecutiveRefreshFailures).toBe(0);
  });

  it("invalidates conditional caching after an external update", async () => {
    handle = (_request, response) =>
      response.writeHead(200, { etag: '"v1"' }).end(JSON.stringify(snapshot(true)));
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    const refresh = createSnapshotRefresher({ provider, source: source() });
    await refresh.refresh();
    provider.updateSnapshot(snapshot(false));
    await refresh.refresh();
    expect(requests[1]?.headers["if-none-match"]).toBeUndefined();
  });

  it("retries transient statuses within the configured attempt bound", async () => {
    handle = (_request, response) => {
      if (requests.length < 3) response.writeHead(503).end("private failure");
      else response.end(JSON.stringify(snapshot(true)));
    };
    await expect(source({ maxAttempts: 3, retryDelayMs: 1 }).fetch()).resolves.toMatchObject({
      status: "content"
    });
    expect(requests).toHaveLength(3);
    handle = (_request, response) => response.writeHead(503).end();
    await expect(source({ maxAttempts: 2, retryDelayMs: 0 }).fetch()).rejects.toThrow(
      "unsuccessful status"
    );
    expect(requests).toHaveLength(5);
  });

  it.each([301, 401, 404])("does not follow or retry status %s", async (status) => {
    handle = (_request, response) =>
      response.writeHead(status, { location: "https://example.test/private" }).end();
    await expect(source({ maxAttempts: 3 }).fetch()).rejects.toThrow("unsuccessful status");
    expect(requests).toHaveLength(1);
  });

  it("retries an interrupted socket without retaining the failed response", async () => {
    handle = (_request, response) => {
      if (requests.length === 1) response.destroy();
      else response.end(JSON.stringify(snapshot(true)));
    };
    await expect(source({ maxAttempts: 2, retryDelayMs: 0 }).fetch()).resolves.toMatchObject({
      status: "content"
    });
    expect(requests).toHaveLength(2);
  });

  it.each(["length", "chunked"])("bounds %s response bytes", async (mode) => {
    handle = (_request, response) => {
      if (mode === "length") response.setHeader("content-length", "100");
      response.write("x".repeat(100));
      response.end();
    };
    await expect(source({ maxBytes: 10 }).fetch()).rejects.toThrow("exceeds maxBytes");
  });

  it("rejects compressed bodies and unsolicited 304, and ignores unsafe response ETags", async () => {
    handle = (_request, response) =>
      response.writeHead(200, { "content-encoding": "gzip" }).end("compressed");
    await expect(source().fetch()).rejects.toThrow("encoding is unsupported");
    handle = (_request, response) => response.writeHead(304).end();
    await expect(source().fetch()).rejects.toThrow("Unexpected");
    handle = (_request, response) => response.writeHead(200, { etag: "unsafe-tag" }).end("{}");
    expect(await source().fetch()).not.toHaveProperty("etag");
    await expect(source().fetch({ etag: "private\r\nheader" })).rejects.toThrow("ETag is invalid");
    await expect(source().fetch({ etag: 'W/"safe"' })).resolves.toMatchObject({
      status: "content"
    });
  });

  it.each(["headers", "body"])("bounds stalled %s with a total attempt deadline", async (mode) => {
    handle = (_request, response) => {
      if (mode === "body") response.write("{");
    };
    await expect(source({ timeoutMs: 100 }).fetch()).rejects.toThrow("timed out");
  });

  it("cancels before a request and during an active body", async () => {
    const cancelled = AbortSignal.abort();
    await expect(source().fetch({ signal: cancelled })).rejects.toThrow("cancelled");
    expect(requests).toHaveLength(0);
    const abort = new AbortController();
    handle = (_request, response) => {
      response.write("{");
      abort.abort();
    };
    await expect(source().fetch({ signal: abort.signal })).rejects.toThrow("cancelled");
  });

  it("cancels retry backoff instead of starting another attempt", async () => {
    const abort = new AbortController();
    handle = (_request, response) => {
      response.writeHead(503).end();
      setTimeout(() => abort.abort(), 20);
    };
    await expect(
      source({ maxAttempts: 3, retryDelayMs: 1_000 }).fetch({ signal: abort.signal })
    ).rejects.toThrow("cancelled");
    expect(requests).toHaveLength(1);
  });

  it("verifies TLS trust and does not expose URL or response content in network errors", async () => {
    await expect(createHttpsSnapshotSource({ url, maxAttempts: 1 }).fetch()).rejects.toThrow(
      "HTTPS snapshot request failed."
    );
  });

  it("validates trusted configuration before network work", () => {
    for (const bad of [
      "bad",
      "http://localhost/flags",
      "https://user:pass@example.test",
      "https://example.test/#fragment"
    ]) {
      expect(() => source({ url: bad })).toThrow(TypeError);
    }
    for (const extra of [
      { maxBytes: 0 },
      { timeoutMs: 0 },
      { timeoutMs: 60_001 },
      { maxAttempts: 6 },
      { retryDelayMs: -1 },
      { maxBytes: Number.NaN }
    ]) {
      expect(() => source(extra)).toThrow(RangeError);
    }
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    expect(() =>
      createSnapshotRefresher({ provider, source: source(), format: "auto" as never })
    ).toThrow(TypeError);
    expect(() => createSnapshotRefresher({ provider, source: source(), maxBytes: 0 })).toThrow(
      RangeError
    );
  });

  it("coalesces refreshes and detects updates that race a source response", async () => {
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    let resolve!: (value: SnapshotSourceResponse) => void;
    const pending = new Promise<SnapshotSourceResponse>((done) => {
      resolve = done;
    });
    const fetch = vi.fn<SnapshotSource["fetch"]>(() => pending);
    const refresh = createSnapshotRefresher({ provider, source: { fetch } });
    const a = refresh.refresh();
    const b = refresh.refresh();
    expect(a).toBe(b);
    await Promise.resolve();
    provider.updateSnapshot({ ...snapshot(false), metadata: { manual: true } });
    resolve(content(true));
    await expect(a).rejects.toThrow("Snapshot changed during refresh");
    expect(fetch).toHaveBeenCalledOnce();
    expect(provider.getSnapshot().metadata).toEqual({ manual: true });
    expect(provider.getStatus().failedRefreshes).toBe(1);
  });

  it("keeps ETag unchanged when provider application rejects", async () => {
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValueOnce(content(true))
      .mockResolvedValueOnce(content(false, '"v2"'))
      .mockResolvedValueOnce({ status: "notModified" });
    const refresh = createSnapshotRefresher({ provider, source: { fetch } });
    await refresh.refresh();
    const update = provider.updateSnapshot.bind(provider);
    vi.spyOn(provider, "updateSnapshot").mockImplementationOnce(() =>
      update({ schemaVersion: 99 } as unknown as FlagSnapshot)
    );
    await expect(refresh.refresh()).rejects.toThrow();
    await refresh.refresh();
    expect(fetch.mock.calls[2]?.[0]?.etag).toBe('"v1"');
    expect(provider.getStatus().failedRefreshes).toBe(1);
  });

  it("does not associate a new ETag with a reentrant configuration-change replacement", async () => {
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValueOnce(content(false, '"original"'))
      .mockResolvedValueOnce(content(true, '"replacement"'))
      .mockResolvedValueOnce({ status: "notModified" });
    const refresh = createSnapshotRefresher({ provider, source: { fetch } });
    await refresh.refresh();
    let replaced = false;
    provider.events?.addHandler(ProviderEvents.ConfigurationChanged, () => {
      if (!replaced) {
        replaced = true;
        provider.updateSnapshot(snapshot(false));
      }
    });
    await expect(refresh.refresh()).rejects.toThrow("changed during application");
    await expect(refresh.refresh()).resolves.toMatchObject({ status: "unchanged" });
    expect(fetch.mock.calls[2]?.[0]?.etag).toBe('"original"');
    expect(provider.getStatus()).toMatchObject({ failedRefreshes: 1, lastRefreshFailure: "load" });
    expect(provider.getSnapshot()).toEqual(snapshot(false));
  });

  it("rejects invalid UTF-8, custom-source oversize and unexpected not-modified data", async () => {
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    for (const response of [
      { status: "content", content: Uint8Array.of(255) },
      { status: "content", content: Buffer.alloc(11) },
      { status: "notModified" },
      { status: "unknown" }
    ]) {
      const refresh = createSnapshotRefresher({
        provider,
        maxBytes: 10,
        source: { fetch: async () => response as SnapshotSourceResponse }
      });
      await expect(refresh.refresh()).rejects.toThrow("content is invalid");
    }
    expect(provider.getStatus().failedRefreshes).toBe(4);
  });

  it("supports explicit YAML and reports safe source failure status", async () => {
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    const fetch = vi
      .fn<SnapshotSource["fetch"]>()
      .mockResolvedValueOnce({
        status: "content",
        content: Buffer.from("schemaVersion: 1\nflags: {}\n")
      })
      .mockRejectedValueOnce(new Error("private URL and credentials"));
    const refresh = createSnapshotRefresher({ provider, source: { fetch }, format: "yaml" });
    await expect(refresh.refresh()).resolves.toMatchObject({ status: "updated" });
    await expect(refresh.refresh()).rejects.toThrow("Snapshot source could not be refreshed.");
    expect(provider.getStatus()).toMatchObject({ failedRefreshes: 1, lastRefreshFailure: "fetch" });
  });

  it("cancels a refresh on close without applying or counting an intentional failure", async () => {
    const provider = createReloadableLocalProvider({ snapshot: snapshot(false), env: {} });
    const fetch: SnapshotSource["fetch"] = async (request) =>
      new Promise((_resolve, reject) => {
        request?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true
        });
      });
    const refresh = createSnapshotRefresher({ provider, source: { fetch } });
    const pending = refresh.refresh();
    await Promise.resolve();
    refresh.close();
    await expect(pending).rejects.toThrow();
    await expect(refresh.refresh()).rejects.toThrow("closed");
    expect(provider.getStatus().failedRefreshes).toBe(0);
    const other = createSnapshotRefresher({ provider, source: source() });
    await provider.onClose?.();
    await expect(other.refresh()).rejects.toThrow("closed");
  });
});
