import { expect, it } from "vitest";
import { createFileAuditSink } from "../../src/audit/audit-sink.js";

const options = { path: "unused-numeric-audit.jsonl", maxBytes: 1, lock: true };
const fields = ["maxBytes", "maxFiles", "lockTimeoutMs"] as const;

it.each(fields)("rejects unsafe active %s before any write is queued", (field) => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, 2 ** 54, Number.MAX_VALUE]) {
    expect(() => createFileAuditSink({ ...options, [field]: value })).toThrow(RangeError);
  }
});

it.each(fields)("accepts the safe-integer upper boundary for %s", (field) => {
  expect(() => createFileAuditSink({ ...options, [field]: Number.MAX_SAFE_INTEGER })).not.toThrow();
});

it("preserves zero retained files and an immediate lock acquisition deadline", () => {
  expect(() => createFileAuditSink({ ...options, maxFiles: 0, lockTimeoutMs: 0 })).not.toThrow();
});

it("keeps inactive rotation and lock settings ignored", () => {
  expect(() => createFileAuditSink({ path: options.path, maxFiles: 2 ** 54 })).not.toThrow();
  expect(() => createFileAuditSink({ path: options.path, lockTimeoutMs: 2 ** 54 })).not.toThrow();
});
