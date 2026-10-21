import {
  createFileSnapshotStore,
  createHttpsSnapshotSource,
  createReloadableLocalProvider,
  createSnapshotRefresher,
  createSnapshotVerifier,
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
  const verifier = createSnapshotVerifier(options.verification);
  const source = createHttpsSnapshotSource({
    url: options.url,
    ...(options.ca !== undefined ? { ca: options.ca } : {})
  });
  const store = createFileSnapshotStore({
    path: options.recoveryPath,
    verification: options.verification,
    createDirectory: true
  });
  const recovered = await store.load();
  if (recovered === undefined && options.allowFirstStart !== true) {
    throw new Error("Recovery state is missing; authorize first startup explicitly.");
  }
  const provider = createReloadableLocalProvider({
    snapshot: recovered?.current?.snapshot ?? options.safeBootstrap,
    ...(recovered?.current !== undefined ? { provenance: recovered.current.provenance } : {}),
    // This recipe uses only signed configuration, with no ambient env override.
    env: {},
    ...(options.auditSink !== undefined ? { auditSink: options.auditSink } : {}),
    auditRedaction: { contextKeys: "none" }
  });
  const refresher = createSnapshotRefresher({
    provider,
    source,
    store,
    verifier,
    ...(recovered !== undefined ? { previous: recovered.floor } : {})
  });
  return { provider, store, refresher };
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
