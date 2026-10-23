import type { AuditEvent } from "../public-types.js";

export interface AuditBatchWriter {
  readonly maxSize: number;
  readonly maxBytes: number;
  write(events: readonly AuditEvent[]): Promise<void>;
}
interface Pending {
  readonly event: AuditEvent;
  readonly bytes: number;
  resolve(): void;
  reject(error: unknown): void;
}

// Coalesce already waiting writes, with no timer or overlapping storage operations.
export function createBatchWriter(batch: AuditBatchWriter) {
  let waiting: (Pending | undefined)[] = [];
  let next = 0;
  let running = false;
  async function drain(): Promise<void> {
    while (next < waiting.length) {
      const group: Pending[] = [];
      let bytes = 0;
      while (next < waiting.length && group.length < batch.maxSize) {
        const item = waiting[next];
        if (item === undefined) break;
        if (group.length > 0 && bytes + item.bytes > batch.maxBytes) break;
        waiting[next++] = undefined;
        bytes += item.bytes;
        group.push(item);
      }
      if (next === waiting.length) {
        waiting = [];
        next = 0;
      } else if (next >= 1024 && next >= waiting.length / 2) {
        waiting = waiting.slice(next);
        next = 0;
      }
      try {
        await batch.write(group.map((item) => item.event));
        for (const item of group) item.resolve();
      } catch (error) {
        for (const item of group) item.reject(error);
      }
    }
    running = false;
  }
  return (event: AuditEvent, bytes: number): Promise<void> =>
    new Promise((resolve, reject) => {
      waiting.push({ event, bytes, resolve, reject });
      if (!running) {
        running = true;
        queueMicrotask(() => void drain());
      }
    });
}
