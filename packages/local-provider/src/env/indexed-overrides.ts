import type { CreateEnvOverridesOptions, FlagDefinition, FlagSnapshot } from "../public-types.js";
import { createEnvOverrides } from "./env-overrides.js";

interface Binding {
  readonly key: string;
  readonly flag: FlagDefinition;
  readonly order: number;
}

// Caller-owned per-inspection index; mutable public inputs keep their ordinary lookup path.
export function createIndexedEnvOverrides(snapshot: FlagSnapshot) {
  let index: Map<string, Binding[]> | undefined;
  return (options: CreateEnvOverridesOptions = {}) => {
    if (index === undefined) {
      if (
        !Object.isFrozen(snapshot) ||
        !Object.isFrozen(snapshot.flags) ||
        !Object.values(snapshot.flags).every(Object.isFrozen)
      )
        return createEnvOverrides(snapshot, options);
      index = new Map();
      let order = 0;
      for (const [key, flag] of Object.entries(snapshot.flags)) {
        if (flag.envVar !== undefined) {
          const bindings = index.get(flag.envVar) ?? [];
          bindings.push({ key, flag, order });
          index.set(flag.envVar, bindings);
        }
        order++;
      }
    }
    const bindings: Binding[] = [];
    const visited = new Set<string>();
    // Preserve ordinary property lookup, including inherited/nonenumerable env names.
    for (
      let env: object | null = options.env ?? {};
      env !== null;
      env = Object.getPrototypeOf(env)
    ) {
      for (const name of Object.getOwnPropertyNames(env)) {
        if (visited.has(name)) continue;
        visited.add(name);
        const matches = index.get(name);
        if (matches !== undefined) bindings.push(...matches);
      }
    }
    bindings.sort((left, right) => left.order - right.order);
    const flags: Record<string, FlagDefinition> = Object.create(null);
    for (const binding of bindings) flags[binding.key] = binding.flag;
    return createEnvOverrides({ ...snapshot, flags }, options);
  };
}
