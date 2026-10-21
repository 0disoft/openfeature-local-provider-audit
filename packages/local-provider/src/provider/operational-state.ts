import type {
  AuditSink,
  FileAuditSinkStats,
  ProviderStatus,
  RefreshFailureKind,
  SignedSnapshotMetadata
} from "../public-types.js";

const FAILURE_KINDS = new Set<RefreshFailureKind>([
  "load",
  "fetch",
  "validation",
  "signature",
  "persist"
]);

export class OperationalState {
  private lastSuccessfulRefreshAt = Date.now();
  private lastChangedAt = this.lastSuccessfulRefreshAt;
  private successfulRefreshes = 1;
  private failedRefreshes = 0;
  private consecutiveRefreshFailures = 0;
  private lastRefreshFailureAt: number | undefined;
  private lastRefreshFailure: RefreshFailureKind | undefined;
  private attemptedWrites = 0;
  private resolvedWrites = 0;
  private failedWrites = 0;
  private timedOutWrites = 0;
  private pendingWrites = 0;
  private lastAuditFailureAt: number | undefined;

  constructor(private readonly staleAfterMs: number | undefined) {
    if (staleAfterMs !== undefined && (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0)) {
      throw new RangeError("staleAfterMs must be a positive safe integer.");
    }
  }

  refreshed(changed: boolean): void {
    this.successfulRefreshes++;
    this.consecutiveRefreshFailures = 0;
    this.lastSuccessfulRefreshAt = Date.now();
    if (changed) this.lastChangedAt = this.lastSuccessfulRefreshAt;
  }

  refreshFailed(kind: RefreshFailureKind): void {
    if (!FAILURE_KINDS.has(kind)) {
      throw new RangeError("Unknown snapshot refresh failure kind.");
    }
    this.failedRefreshes++;
    this.consecutiveRefreshFailures++;
    this.lastRefreshFailureAt = Date.now();
    this.lastRefreshFailure = kind;
  }

  auditStarted(): void {
    this.attemptedWrites++;
    this.pendingWrites++;
  }

  auditFinished(failed: boolean): void {
    this.pendingWrites--;
    if (failed) {
      this.failedWrites++;
      this.lastAuditFailureAt = Date.now();
    } else {
      this.resolvedWrites++;
    }
  }

  auditTimedOut(): void {
    this.timedOutWrites++;
  }

  read(
    snapshotHash: string,
    closed: boolean,
    sink: AuditSink | undefined,
    provenance?: SignedSnapshotMetadata
  ): ProviderStatus {
    const sinkStats = readSinkStats(sink);
    return Object.freeze({
      snapshotHash,
      ...(provenance !== undefined ? { provenance } : {}),
      closed,
      lastSuccessfulRefreshAt: this.lastSuccessfulRefreshAt,
      lastChangedAt: this.lastChangedAt,
      successfulRefreshes: this.successfulRefreshes,
      failedRefreshes: this.failedRefreshes,
      consecutiveRefreshFailures: this.consecutiveRefreshFailures,
      ...(this.lastRefreshFailureAt !== undefined
        ? { lastRefreshFailureAt: this.lastRefreshFailureAt }
        : {}),
      ...(this.lastRefreshFailure !== undefined
        ? { lastRefreshFailure: this.lastRefreshFailure }
        : {}),
      stale:
        this.staleAfterMs !== undefined &&
        Date.now() - this.lastSuccessfulRefreshAt >= this.staleAfterMs,
      audit: Object.freeze({
        enabled: sink !== undefined,
        attemptedWrites: this.attemptedWrites,
        resolvedWrites: this.resolvedWrites,
        failedWrites: this.failedWrites,
        timedOutWrites: this.timedOutWrites,
        pendingWrites: this.pendingWrites,
        ...(this.lastAuditFailureAt !== undefined
          ? { lastFailureAt: this.lastAuditFailureAt }
          : {}),
        ...(sinkStats !== undefined ? { sinkStats } : {})
      })
    });
  }
}

function readSinkStats(sink: AuditSink | undefined): FileAuditSinkStats | undefined {
  try {
    const stats = sink?.getStats?.();
    if (stats === undefined) return undefined;
    const { pendingWrites, droppedWrites, rejectedWrites, maxQueueSize } = stats;
    if (
      ![pendingWrites, droppedWrites, rejectedWrites].every(
        (value) => Number.isSafeInteger(value) && value >= 0
      ) ||
      (maxQueueSize !== null && (!Number.isSafeInteger(maxQueueSize) || maxQueueSize <= 0))
    )
      return undefined;
    // Copy only documented fields: custom sinks can carry sensitive extra metadata.
    return Object.freeze({
      pendingWrites,
      droppedWrites,
      rejectedWrites,
      maxQueueSize
    });
  } catch {
    // Optional diagnostics must not break health checks or flag evaluations.
    return undefined;
  }
}
