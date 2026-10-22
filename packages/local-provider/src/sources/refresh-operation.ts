import { LocalProviderError } from "../errors/local-provider-error.js";
import type { RefreshFailureKind } from "../public-types.js";
import { waitForSnapshotOperation } from "./abortable.js";

// Caller waiting is bounded; ownership survives uncooperative I/O and ambiguous writes.
export class RefreshOperation {
  private readonly controller = new AbortController();
  private pendingReads = 0;
  private finished = false;
  private release: () => void = () => {};
  private persisting = false;
  timeoutError: LocalProviderError | undefined;
  failureReported = false;

  constructor(
    readonly timeoutMs: number,
    public stage: RefreshFailureKind
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(): void {
    this.controller.abort();
  }

  assertNotTimedOut(): void {
    if (this.timeoutError !== undefined) throw this.timeoutError;
  }

  read<T>(operation: () => Promise<T>): Promise<T> {
    return waitForSnapshotOperation(
      () => {
        const task = Promise.resolve(operation());
        this.pendingReads++;
        const settled = () => {
          this.pendingReads--;
          this.releaseIfIdle();
        };
        void task.then(settled, settled);
        return task;
      },
      this.signal,
      "Snapshot operation was cancelled."
    );
  }

  async persist<T>(operation: () => Promise<T>): Promise<T> {
    this.assertNotTimedOut();
    this.stage = "persist";
    this.persisting = true;
    try {
      return await operation();
    } finally {
      this.persisting = false;
    }
  }

  run<T>(
    work: () => Promise<T>,
    onTimeout: (error: LocalProviderError) => void,
    onIdle: () => void
  ): Promise<T> {
    this.release = onIdle;
    let rejectDeadline!: (error: LocalProviderError) => void;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(() => {
      this.timeoutError = new LocalProviderError(
        "PROVIDER_NOT_READY",
        this.persisting
          ? "Snapshot refresh timed out; persistence outcome is unknown."
          : "Snapshot refresh timed out."
      );
      rejectDeadline(this.timeoutError);
      this.controller.abort(this.timeoutError);
      try {
        onTimeout(this.timeoutError);
      } catch {
        /* Diagnostic failure cannot escape a timer. */
      }
    }, this.timeoutMs);
    const worker = Promise.resolve()
      .then(work)
      .finally(() => {
        clearTimeout(timer);
        this.finished = true;
        this.releaseIfIdle();
      });
    return Promise.race([worker, deadline]);
  }

  private releaseIfIdle(): void {
    if (this.finished && this.pendingReads === 0) this.release();
  }
}
