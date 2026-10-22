// Raw causes stay private: public errors/status may be serialized by consumers.
const causes = new WeakMap<object, unknown>();

export function retainFailureCause<T extends Error>(error: T, cause: unknown): T {
  if (cause !== undefined) causes.set(error, failureCause(cause));
  return error;
}

export function failureCause(error: unknown): unknown {
  return error !== null && typeof error === "object" && causes.has(error)
    ? causes.get(error)
    : error;
}
