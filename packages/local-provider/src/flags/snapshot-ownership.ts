import type { FlagSnapshot } from "../core-types.js";

const validatedSnapshots = new WeakSet<FlagSnapshot>();

// Only the validator registers its captured, deeply frozen result. A caller's
// Object.freeze is insufficient: descendants or accessor results can still change.
export function registerValidatedSnapshot(snapshot: FlagSnapshot): FlagSnapshot {
  validatedSnapshots.add(snapshot);
  return snapshot;
}

export function isValidatedSnapshot(snapshot: FlagSnapshot): boolean {
  return validatedSnapshots.has(snapshot);
}
