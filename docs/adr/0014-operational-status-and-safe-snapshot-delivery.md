# ADR 0014: Operational status and safe snapshot delivery

Status: Accepted for P2 implementation
Owner: 0disoft

## Context

The accepted P2 task requires operating and diagnosing an embedded provider,
delivering trusted snapshots, recovering the last good state after restart and
checking audit integrity. None requires a hosted management service.

## Decision

Implement the slices in `docs/product/07-operations-and-integrity.md`.
The provider remains a local evaluator. Status is an immutable privacy-safe
projection; refresh and audit counters are process-local observations.
Staleness is opt-in and does not change decisions.

Optional HTTPS delivery is a caller-triggered client with bounded requests,
serialized application, pinned trust keys and persistent recovery. No evaluation
performs a fetch, and no client installs a scheduler. Snapshot sources and local
storage belong to the caller. Optional metrics adapt a caller-owned meter without
installing a telemetry SDK or exporters.

Audit waiting and failure response are explicit opt-ins; the default remains
best effort. Do not equate successful enqueueing with durable delivery, or an
OpenFeature default response with enforcing a business operation's audit requirement.
Audit chains require explicit stream identity, concurrency boundaries and trusted
checkpoints; hashes alone do not authenticate a rewritten log.

## Compatibility and consequences

Keep v1 snapshots, bucketing, override priority, reasons and privacy defaults.
Expand the unpublished 2.0 prerelease API with migration and packaged-consumer
evidence for each public slice. Retain supported Node 22/24.
No control plane, database, background worker or runtime expansion is authorized.
Detailed source/signature/recovery/integrity contracts must accompany their code,
including failure and rollback behavior. This ADR does not claim those slices
already exist or that local tests constitute publication or hosted evidence.

The implemented signature profile is restricted compact JWS with the fully-specified
RFC 9864 `Ed25519` algorithm, a package-specific protected type and bounded
audience/sequence/millisecond lifetime claims. Trust keys are pinned out of band;
no dynamic discovery or algorithm negotiation. The detailed signing and
process-local continuity contract is `docs/library/signed-snapshots.md`.

The standalone signed recovery journal contract is in
`docs/library/snapshot-recovery.md`: atomic bounded artifact history, authenticated
historical floor separate from fresh activation, explicit store ownership and
crash recovery. Automatic persistence/application coordination remains pending.
