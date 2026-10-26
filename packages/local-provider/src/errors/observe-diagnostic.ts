// Void callbacks may still return a Promise at runtime. Observe it without
// awaiting optional diagnostics or allocating for normal synchronous callbacks.
export function observeDiagnosticResult(result: unknown): void {
  if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
}
