interface PendingWrite {
  readonly operation: () => Promise<void>;
  readonly signal: AbortSignal | undefined;
  readonly cancel: () => void;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  previous: PendingWrite | undefined;
  next: PendingWrite | undefined;
}

interface WriteQueue {
  first: PendingWrite | undefined;
  last: PendingWrite | undefined;
  running: boolean;
}

const queues = new Map<string, WriteQueue>();

export async function serializeProcessWrite(
  path: string,
  operation: () => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  // Windows case aliases share ownership; actual I/O paths remain unchanged.
  const key = process.platform === "win32" ? path.toLowerCase() : path;
  let queue = queues.get(key);
  if (queue === undefined) {
    queue = { first: undefined, last: undefined, running: false };
    queues.set(key, queue);
  }
  const owner = queue;
  await new Promise<void>((resolve, reject) => {
    const entry: PendingWrite = {
      operation,
      signal,
      resolve,
      reject,
      previous: owner.last,
      next: undefined,
      cancel: () => {
        // Detach immediately: a stalled active writer must not retain cancelled
        // closures or later spend one promise continuation per cancelled request.
        unlink(owner, entry);
        reject(signal?.reason);
      }
    };
    if (owner.last === undefined) owner.first = entry;
    else owner.last.next = entry;
    owner.last = entry;
    signal?.addEventListener("abort", entry.cancel, { once: true });
    if (!owner.running) {
      owner.running = true;
      queueMicrotask(() => void drain(key, owner));
    }
  });
}

function unlink(queue: WriteQueue, entry: PendingWrite): void {
  if (entry.previous === undefined) queue.first = entry.next;
  else entry.previous.next = entry.next;
  if (entry.next === undefined) queue.last = entry.previous;
  else entry.next.previous = entry.previous;
  entry.previous = undefined;
  entry.next = undefined;
}

async function drain(key: string, queue: WriteQueue): Promise<void> {
  while (queue.first !== undefined) {
    const entry = queue.first;
    unlink(queue, entry);
    // Admission transfers cancellation/cleanup ownership to the operation. The
    // queue remains occupied until actual work settles, even after caller abort.
    entry.signal?.removeEventListener("abort", entry.cancel);
    try {
      entry.signal?.throwIfAborted();
      await entry.operation();
      entry.resolve();
    } catch (error) {
      entry.reject(error);
    }
  }
  queue.running = false;
  if (queues.get(key) === queue) queues.delete(key);
}
