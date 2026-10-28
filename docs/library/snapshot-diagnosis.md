# Read-only snapshot recovery diagnosis

```sh
openfeature-local-provider snapshot-diagnose state.json
openfeature-local-provider snapshot-diagnose state.json --verification public-verification.json
```

This Node-only operator command never creates a missing journal/directory, takes or
removes a lock, repairs, deletes temporary files, commits or activates history. It
does not invoke store load/recovery. Structure parsing shares the store's actual
schema/count validation. No SDK/root/core export or evaluation I/O is added.

Optional verification JSON accepts the existing SnapshotVerificationOptions fields:
audience, trustedKeys, minSequence, maxAgeMs, maxLifetimeMs, clockSkewMs and maxBytes.
trustedKeys maps key IDs to PEM **Ed25519 PUBLIC KEY** strings, never paths or private
keys. Obtain real public keys from the deployment's trusted source; do not copy
signing secrets. Unknown fields and invalid settings are usage errors. Settings are
captured once from a regular owned file with a 256 KiB bound. Later trust changes
are outside this observation; a locally supplied key is not independent trust.

## Result and exit status

One redacted JSON object reports status, lockPresent, journalPresent, artifacts,
temporaryFiles, headAuthenticated, activationEligible, authenticatedArtifacts and
bounded issues with optional zero-based artifactIndex. No path, raw token, flag
value/key, key ID, audience, claims or original exception is printed.

- `valid`: supplied verification policy authenticated observed head/history and
  permitted the head at the final verification boundary; exit 0.
- `structureOnly`: journal structure accepted without verifying tokens; exit 0.
  Authentication/activation are null. **Not safe-to-activate proof.**
- `missing`: file absent in an existing trusted parent; exit 0. Applications
  requiring prior state must reject absence; this does not authorize bootstrap.
- `busy` / `changed`: observed writer marker or file/directory mutation; exit 1.
  Issues, authentication/activation verdicts and authenticated counts are withheld.
- `issues`: stable observed read/shape/authentication/order/activation/limit issue;
  exit 1. An expired floor or retired older key is not necessarily corruption.
- Invalid arguments/public settings: static redacted stderr and exit 2.

Historical verification uses existing signature, audience, schema, issuance and
lifetime policy without current age/expiry/minimum-sequence admission rules.
HEAD_UNVERIFIABLE never promotes history. HISTORY_UNVERIFIABLE identifies older
entries that normal recovery skips, such as retired keys; the head can remain
activatable. HISTORY_ORDER_INVALID blocks activation for nondecreasing sequence or
increasing issuance among authenticated entries. HEAD_NOT_ACTIVATABLE retains an
authenticated floor but fails current admission policy. The verifier deliberately
does not expose raw cryptographic failure reasons. Fresh verification follows all
historical work and asynchronous filesystem observations; no activation occurs.

TEMPORARY_FILES reports interrupted-writer siblings without opening/deleting them.
READ_FAILED includes invalid UTF-8 and handle cleanup errors; JOURNAL_INVALID covers
JSON/shape/count errors. UNSAFE_DIRECTORY/UNSAFE_FILE, BYTE_LIMIT and ENTRY_LIMIT
identify ownership/type/input policy failures.

## Bounds and observation limits

Default --max-bytes is 16 MiB (1..100 MiB); --max-entries is 512 (1..10,000).
Schema permits 1..32 artifacts. Signature maxBytes retains separate verifier bounds.
Directory entries stream with iterator cleanup; unrelated siblings count toward scan
limits without being named. File reads use O_RDONLY/NOFOLLOW/NONBLOCK where supported,
exact bigint identity/size/mtime/ctime checks, one observed-size-plus-one input buffer,
64 KiB reads and strict UTF-8. Symlinks, nonregular/multiply linked files and foreign
POSIX owners are rejected. Finally-bound cleanup drains handles on read failure or
cooperative internal cancellation. OS calls and synchronous JSON/crypto are not
preemptible. Input bounds are not total heap/RSS limits. Reading may update atime.

Ancestors, filesystem permissions/Windows ACLs and verification settings remain
trusted configuration. Stop writers before inspection. No writer lock is taken:
consistentSnapshot is always false; checks detect observed races, not all change/ABA.
A valid result cannot authorize later activation. rollbackProtected is always false:
a valid older journal does not prove it is the newest floor. Use an external trusted
minimum/checkpoint and the normal verifier/store/activation path. Never delete a lock
or restore old storage based only on this report. See `snapshot-recovery.md`.
