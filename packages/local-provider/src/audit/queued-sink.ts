import { createBatchWriter, type AuditBatchWriter } from "./batch-writer.js";
import type { AuditEvent, AuditSink, FileAuditSinkOptions } from "../public-types.js";
const DEFAULT_AUDIT_QUEUE_SIZE = 5_000;
const DEFAULT_AUDIT_QUEUE_BYTES = 64 * 1024 * 1024;
const MAX_RETAINED_FAILURE_CAUSES = 16;
export function createQueuedAuditSink(
  options: FileAuditSinkOptions,
  writer: (event: AuditEvent) => Promise<void>,
  batch?: AuditBatchWriter
): AuditSink {
  const queue = createQueueOptions(options);
  const dispatch = batch === undefined ? undefined : createBatchWriter(batch);
  const pendingWrites = new Set<Promise<void>>();
  const failureCauses: unknown[] = [];
  let unreportedFailureCount = 0;
  let queuedWrites = 0;
  let pendingBytes = 0;
  let droppedWrites = 0;
  let rejectedWrites = 0;
  let writeQueue = Promise.resolve();
  let flushQueue = Promise.resolve();

  async function enqueueWrite(event: AuditEvent, requireConfirmation: boolean): Promise<void> {
    // Count saturation keeps its existing precedence and avoids needless serialization.
    const countFull = queue.maxSize !== undefined && queuedWrites >= queue.maxSize;
    const bytes = countFull ? 0 : Buffer.byteLength(JSON.stringify(event), "utf8") + 1;
    const bytesFull = queue.maxBytes !== undefined && bytes > queue.maxBytes - pendingBytes;
    if (countFull || bytesFull) {
      if (queue.overflowPolicy === "dropNewest" && !requireConfirmation) {
        droppedWrites += 1;
        return;
      }

      rejectedWrites += 1;
      throw new Error(
        countFull
          ? `Audit write queue is full: maxQueueSize=${queue.maxSize}`
          : `Audit write queue is full: maxQueueBytes=${queue.maxBytes}`
      );
    }

    queuedWrites += 1;
    pendingBytes += bytes;
    const writeOperation =
      dispatch === undefined ? writeQueue.then(() => writer(event)) : dispatch(event, bytes);
    if (dispatch === undefined) writeQueue = writeOperation.catch(() => undefined);
    const trackedWrite = writeOperation
      .catch((error: unknown) => {
        unreportedFailureCount += 1;
        if (failureCauses.length < MAX_RETAINED_FAILURE_CAUSES) {
          failureCauses.push(error);
        }
        throw error;
      })
      .finally(() => {
        queuedWrites -= 1;
        pendingBytes -= bytes;
        pendingWrites.delete(trackedWrite);
      });

    pendingWrites.add(trackedWrite);

    await trackedWrite;
  }

  return {
    write(event) {
      return enqueueWrite(event, false);
    },
    writeConfirmed(event) {
      return enqueueWrite(event, true);
    },
    async flush(): Promise<void> {
      const flushOperation = flushQueue.then(async () => {
        while (pendingWrites.size > 0) {
          await Promise.allSettled(Array.from(pendingWrites));
        }

        const failureCount = unreportedFailureCount;
        const retainedCauses = failureCauses.splice(0);
        unreportedFailureCount = 0;
        if (failureCount === 1) {
          throw retainedCauses[0];
        }
        if (failureCount > 1) {
          throw new AggregateError(
            retainedCauses,
            `${failureCount} audit writes failed before flush; retained up to ${MAX_RETAINED_FAILURE_CAUSES} causes.`
          );
        }
      });
      flushQueue = flushOperation.catch(() => undefined);
      await flushOperation;
    },

    getStats() {
      return {
        pendingWrites: queuedWrites,
        droppedWrites,
        rejectedWrites,
        maxQueueSize: queue.maxSize ?? null,
        pendingBytes,
        maxQueueBytes: queue.maxBytes ?? null
      };
    }
  };
}

interface QueueOptions {
  readonly maxSize: number | undefined;
  readonly maxBytes: number | undefined;
  readonly overflowPolicy: NonNullable<FileAuditSinkOptions["queueOverflowPolicy"]>;
}

function createQueueOptions(options: FileAuditSinkOptions): QueueOptions {
  const maxBytes =
    options.maxQueueBytes === null
      ? undefined
      : (options.maxQueueBytes ?? DEFAULT_AUDIT_QUEUE_BYTES);
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0))
    throw new RangeError("maxQueueBytes must be a positive safe integer or null");
  if (
    options.queueOverflowPolicy !== undefined &&
    options.queueOverflowPolicy !== "reject" &&
    options.queueOverflowPolicy !== "dropNewest"
  ) {
    throw new TypeError("queueOverflowPolicy must be reject or dropNewest");
  }

  if (options.maxQueueSize === null) {
    return {
      maxSize: undefined,
      maxBytes,
      overflowPolicy: options.queueOverflowPolicy ?? "reject"
    };
  }

  const maxQueueSize = options.maxQueueSize ?? DEFAULT_AUDIT_QUEUE_SIZE;
  assertNonNegativeInteger(maxQueueSize, "maxQueueSize");
  if (maxQueueSize === 0) {
    throw new RangeError("maxQueueSize must be greater than 0");
  }

  return {
    maxSize: maxQueueSize,
    maxBytes,
    overflowPolicy: options.queueOverflowPolicy ?? "reject"
  };
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative integer`);
}
