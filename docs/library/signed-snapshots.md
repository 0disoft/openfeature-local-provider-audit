# Signed snapshot delivery

Status: implemented locally in the 2.0 prerelease; see `snapshot-recovery.md` for standalone durable storage.

```ts
// Publisher: supply an Ed25519 private KeyObject from caller-owned secure key handling.
const artifact = signFlagSnapshot({
  snapshot, privateKey, keyId: "release-2026",
  audience: "checkout/production", sequence: 42,
  issuedAt: Date.now(), expiresAt: Date.now() + 86_400_000
});
// Consumer: public keys only; no private key, discovery URL or signing credentials.
const verifier = createSnapshotVerifier({
  trustedKeys: { "release-2026": publicKey },
  audience: "checkout/production",
  minSequence: 42
});
const refresher = createSnapshotRefresher({ provider, source, verifier });
const result = await refresher.refresh();
const provenance = refresher.getProvenance();
```

## Authenticated format

The artifact is compact JWS using native Node crypto Ed25519:
`base64url(protected-header).base64url(payload).base64url(signature)`.
The protected header must contain exactly `alg: "Ed25519"`, `kid` and
`typ: "openfeature-local-snapshot+jws"`. No algorithm negotiation, remote JWK
discovery, `crit`, unprotected header, embedded key or detached payload is supported.
Only configured Ed25519 public keys can verify it. This is a restricted JWS profile,
not a general-purpose JOSE/JWT API.
The fully-specified algorithm identifier follows RFC 9864; the deprecated
polymorphic `EdDSA` identifier is rejected.

The payload has exactly `schemaVersion: 1`, `audience`, `sequence`, `issuedAt`,
`expiresAt`, `snapshot`. Payload bytes are signature-checked before payload JSON
or flag schema parsing. The nested snapshot retains schema v1/v2 compatibility.
Claim timestamps are **epoch milliseconds**, not JWT NumericDate/seconds.
The signature covers the exact protected-header and payload segments.
Base64url must be canonical and unpadded; surrounding transport whitespace is
ignored. JSON follows ECMAScript last-member parsing; the publisher helper emits
unique members. Signatures still bind every original encoded byte.

`signFlagSnapshot` accepts only an Ed25519 private KeyObject, never reads a key
file/environment variable or stores the key. Native crypto owns signing/verification;
no cryptographic primitive is implemented here. Key IDs accept 1..128 ASCII
letters/digits/dot/underscore/hyphen; audiences additionally accept slash/colon.
Use stable non-personal environment IDs. Signing validates the flag snapshot,
nonnegative safe-integer sequence and valid lifetime bounds
(`0 <= issuedAt < expiresAt`). Verification applies the deployment's freshness policy.

JWS authenticates content; it does not encrypt flag values. Protect artifact
distribution and storage. Never publish a private signing key with the artifact.
The runtime only needs pinned public keys, supplied as public KeyObjects or SPKI
`BEGIN PUBLIC KEY` PEM strings (at most 4,096 characters). Private keys, certificates,
other key algorithms and empty/oversized keyrings are rejected.

## Freshness and replay policy

| Verification option | Default | Bound |
| --- | --- | --- |
| `trustedKeys` | Required | 1..32 pinned named Ed25519 public keys |
| `audience` | Required | Exact expected environment identity |
| `minSequence` | 0 | Nonnegative safe integer, inclusive bootstrap floor |
| `maxAgeMs` | 7 days | 1 ms..366 days |
| `maxLifetimeMs` | 7 days | 1 ms..366 days |
| `clockSkewMs` | 30,000 ms | 0..300,000 ms, future issuance tolerance only |
| `maxBytes` | 10 MiB | 1..100 MiB, entire incoming artifact before decoding |

The clock must return a nonnegative safe-integer timestamp. Issuance cannot be
more than the allowed skew in the future; age and lifetime must fit the policy.
Expiry is strict (`now >= expiresAt` rejects), with no expiry grace.
The wall clock and configured public keyring/floor are trusted; a rolled-back
clock or compromised publisher key is outside these guarantees.

`verifier.verify(bytes, previous?)` returns frozen `{ snapshot, provenance }`.
It is stateless: callers outside a refresher must supply their last trusted
provenance to enforce continuity. With previous provenance, lower sequence or
earlier issuance is rejected. Reusing a sequence requires the identical normalized
signed artifact, even if a changed artifact would evaluate to the same flags.
This rejects same-sequence equivocation, including key/expiry/payload changes.
A normal conditional refresh can revalidate identical content while it is fresh.

The refresher retains its last committed provenance as the replay floor, including
after external unsigned provider updates. Signature/freshness failure never falls
back to unsigned parsing. YAML format is incompatible with a verifier. On 304 the
cached signed artifact is verified again, so ETag caching cannot extend expiry.
Without storage, rejected application or reentrant configuration replacement commits
neither new provenance, ETag nor replay state. With `store`, durable acceptance is
irreversible before activation/callbacks; reentrant replacement cannot lower that
floor, while ETag/source provenance still require matching active state. See
`snapshot-recovery.md`. Updates remain serialized/coalesced.

After a failed or expired refresh, the already active last good snapshot continues
evaluating locally. Failure status records `signature` once and does not renew
freshness. This API does not turn feature flags into authorization or automatically
disable already active flags at expiry. The application owns stricter runtime policy.

## Rotation, rollback and evidence

The verifier captures its keyring; mutating the original map does not change trust.
For rotation, configure old and new public key IDs out of band, issue a higher
sequence signed by the new key, then retire the old key in a new verifier.
When recreating a refresher without persisted provenance, provision a trusted
minimum sequence strictly above the last accepted sequence. The inclusive floor
alone does not detect different artifacts at that floor if prior identity was lost.
No artifact can authorize its own new key or lower the configured floor.

An authorized rollback is a **new higher sequence** with a current issuance/expiry
and the desired older flag contents. Replaying an older signed release is not rollback.
The optional file store retains authenticated replay floors, supports restart
recovery and history selection; see `snapshot-recovery.md`. Optional `store`
coordination persists accepted content before atomic provider activation; a refresher without storage remains process-local.

## Evaluation audit linkage

Provenance contains key ID, audience, sequence, issuance/expiry, semantic
`snapshotHash` and SHA-256 `artifactHash` of the normalized compact token.
It contains no key material or evaluation context. Signed refresh applies the snapshot
and its provenance together. `ProviderStatus.provenance` and each evaluation's
`AuditEvent.provenance` identify the exact signed artifact, even when two releases
have identical flag contents. Pending asynchronous audit writes retain the origin
captured when evaluation began. Hashes do not retain the artifact or snapshot.

`LocalProviderOptions.provenance`, `updateSnapshot(snapshot, provenance?)` and
`CreateAuditEventOptions.provenance` accept caller-asserted metadata. They validate
own data fields, identifiers, safe-integer times/sequence and matching snapshot hash,
then copy/freeze only the seven documented fields. They do **not** verify signatures:
pass the result of a trusted verifier. In-process callers already control the snapshot.
Do not treat arbitrary metadata as cryptographic proof; verify retained artifacts.
Unsigned updates clear provenance, including updates with identical contents.
Provenance-only changes renew freshness without emitting configuration-change events.
No extra metrics labels, network calls or per-evaluation signature checks are added.

A signed refresher seeds continuity from initial provider provenance and retains its
private accepted floor across unsigned updates. An active higher sequence also sets
the verification floor. Changes to active artifact identity during fetch or application
reject the refresh, including equal-hash replacement. `getProvenance()` and ETag reuse
require both active snapshot and artifact identity to match the controller's commit.
Provenance describes historical acceptance, not current freshness or durable restart
protection. A newly constructed controller cannot recover a floor that was never
persisted or supplied. The file store and `previous` refresh option support
explicit restart recovery. Optional `store` coordinates durable acceptance before
activation; see `snapshot-recovery.md` for close, callbacks and ambiguous failure.

Verification errors are generic `LocalProviderError(SCHEMA_ERROR)` without a raw
token, key, claim value or nested cause. The publisher helper may throw input
validation errors before signing. Tests generate real ephemeral keys, verify
independently constructed JWS with native crypto and cover TLS download/application.

The framing/algorithm follow [JWS](https://www.rfc-editor.org/rfc/rfc7515.html),
[fully-specified JOSE algorithms](https://www.rfc-editor.org/rfc/rfc9864.html), and the
[Node crypto API](https://github.com/nodejs/node/blob/v22.x/doc/api/crypto.md);
the bounded claims/freshness profile above belongs to this package.
