// Optional configuration fields must not inherit policy from the host prototype.
export function getOwn<T extends object, K extends keyof T>(
  record: T | undefined,
  key: K
): T[K] | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}
