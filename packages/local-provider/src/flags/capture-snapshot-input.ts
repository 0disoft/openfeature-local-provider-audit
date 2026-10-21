import { LocalProviderError } from "../errors/local-provider-error.js";

// Capture only own data before schema validators can read properties or call array methods.
// Allow undefined for explicitly supplied optional schema fields. Variant validation is stricter.
export function captureSnapshotInput(input: unknown): unknown {
  const active = new WeakSet<object>();
  let nodes = 0;
  function capture(value: unknown, depth: number): unknown {
    if (++nodes > 100_000 || depth > 136) throw invalid();
    if (
      value === undefined ||
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return value;
    if (typeof value !== "object" || active.has(value)) throw invalid();
    active.add(value);
    const array = Array.isArray(value);
    const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    const keys = Reflect.ownKeys(value);
    if (keys.length + nodes > 100_001) throw invalid();
    const length = array ? Object.getOwnPropertyDescriptor(value, "length")?.value : undefined;
    if (array && (!Number.isSafeInteger(length) || keys.length !== length + 1)) throw invalid();
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length))
      )
        throw invalid();
      Object.defineProperty(result, key, {
        value: capture(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    active.delete(value);
    return result;
  }
  try {
    return capture(input, 0);
  } catch {
    throw invalid();
  }
}

function invalid(): LocalProviderError {
  return new LocalProviderError(
    "SCHEMA_ERROR",
    "Snapshot must contain bounded own data properties."
  );
}
