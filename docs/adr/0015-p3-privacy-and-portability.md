# ADR 0015: P3 privacy, delivery and portability

Status: Implemented locally; acceptance amended 2026-10-22 KST. Owner: 0disoft.

The user authorized prioritized P3 implementation after P2 acceptance. The scope
and evidence boundaries are `docs/product/08-privacy-and-portability.md`. Prioritize
HMAC pseudonyms, scheduled rollout, object storage delivery and runtime portability,
then reproducible usage/performance/compatibility material. All work remains
sequential on local main. The owner explicitly excluded actual independent
adoption evidence and recording from P3 acceptance on 2026-10-22. That condition
is no longer a blocker; independent adoption remains unverified. This amendment
does not change the separate historical v1 registry-consumer release gate or
authorize outreach, publishing, push or deployment.

HMAC correlation is explicit and off by default. Use native HMAC-SHA-256 with a
copied caller-owned key of 32..128 bytes, a nonpersonal key ID and scope, and a
bounded well-formed Unicode targeting key. Domain separation includes key ID and
scope. Audit output holds only version, key ID, scope and digest. Missing/empty
keys do not produce a pseudonym. Invalid configured inputs fail audit generation;
the provider's existing failure policy decides the evaluation response. No implicit
selection from arbitrary context fields, plain identifier hashing or key loading.

Additive opt-in audit fields remain absent from default events. Existing chains
without these fields retain their canonical bytes; new chain verification captures
only the strict documented pseudonym shape. Pseudonyms are linkable personal data,
not anonymization, authorization or encryption. Rotation needs a new key ID and
secret; callers own secret entropy, distribution, retention and scope isolation.

Subsequent schedule, source and runtime slices require detailed contracts before
their code. Existing default evaluation and Node support remain intact. Broader
runtime support requires real runtime evidence and an explicit update of ADR 0004;
this ADR does not claim that every deferred runtime already works. No hosted
service, control plane, user database, automatic worker or external publication is
authorized. Independent adoption cannot be manufactured by local tests.
