import {
  createManagedLocalProvider,
  createHttpsSnapshotSource,
  loadFlagSnapshotFile,
  signFlagSnapshot,
  type AuditSink,
  type FlagSnapshot,
  type SignedSnapshotStore,
  type SignFlagSnapshotOptions,
  type SnapshotVerificationOptions
} from "@0disoft/openfeature-local-provider";

export type ReleaseSigning = Omit<SignFlagSnapshotOptions, "snapshot">;

// The publisher supplies a real private KeyObject; this example never loads a secret.
export async function createSignedRelease(
  configurationPath: string | URL,
  signing: ReleaseSigning
): Promise<string> {
  const snapshot = await loadFlagSnapshotFile(configurationPath);
  return signFlagSnapshot({ ...signing, snapshot });
}

export interface GitOpsConsumerOptions {
  readonly url: string | URL;
  readonly recoveryPath: string | URL;
  readonly verification: SnapshotVerificationOptions;
  readonly safeBootstrap: FlagSnapshot;
  readonly allowFirstStart?: boolean;
  readonly ca?: string;
  readonly auditSink?: AuditSink;
}

export async function createGitOpsConsumer(options: GitOpsConsumerOptions) {
  return createManagedLocalProvider({
    source: createHttpsSnapshotSource({
      url: options.url,
      ...(options.ca !== undefined ? { ca: options.ca } : {})
    }),
    verification: options.verification,
    recovery: { path: options.recoveryPath, createDirectory: true },
    bootstrap: options.safeBootstrap,
    ...(options.allowFirstStart !== undefined ? { allowFirstStart: options.allowFirstStart } : {}),
    provider: {
      ...(options.auditSink !== undefined ? { auditSink: options.auditSink } : {})
    }
  });
}

export async function createRollbackRelease(
  store: SignedSnapshotStore,
  restoreSequence: number,
  signing: ReleaseSigning
): Promise<string> {
  const recovery = await store.load();
  if (recovery === undefined) throw new Error("No authenticated release history is available.");
  const selected = recovery.history.find((entry) => entry.provenance.sequence === restoreSequence);
  if (selected === undefined)
    throw new Error("The selected release is not in authenticated history.");
  if (
    signing.audience !== recovery.floor.audience ||
    signing.sequence <= recovery.floor.sequence ||
    signing.issuedAt < recovery.floor.issuedAt
  ) {
    throw new Error("Rollback requires the same audience, a higher sequence and current issuance.");
  }
  return signFlagSnapshot({ ...signing, snapshot: selected.snapshot });
}
