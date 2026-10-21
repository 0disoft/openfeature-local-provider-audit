# Opt-in HMAC audit pseudonyms

Status: implemented locally in unpublished 2.0.0-alpha.15 under ADR 0015.

`createHmacAuditPseudonymizer({ key, keyId, scope })` returns a frozen
`AuditPseudonymizer`. Its `pseudonymize(subject)` produces a frozen
`{ schemaVersion: 1, keyId, scope, hash }` or undefined for an empty string.
`AuditPseudonym`, `AuditPseudonymizer` and `HmacAuditPseudonymizerOptions` are root
types. The implementation uses native
[Node HMAC](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatehmacalgorithm-key-options),
with no new dependency or network access.

## Explicit disclosure and inputs

Opt in with `createLocalProvider({ auditSink, auditPseudonymizer })`, the equivalent
reloadable-provider option, or `createAuditEvent({ pseudonymizer, ... })`.
The event contains optional `pseudonym` only when a nonempty explicit
`request.targetingKey` exists. Direct event creation does not infer subjects from
context fields. Providers extract the SDK context's own data-valued targetingKey
as before. No pseudonymizer, missing targeting key or empty key leaves the field
absent. Context name/count disclosure remains separately controlled by redaction.

The secret must be a caller-supplied Uint8Array of 32..128 bytes. It is copied into
a native secret key at construction; later caller mutation does not change results.
Use real cryptographically random secret material from the application's existing
secret provisioning. No key file loader, embedded default, password derivation or
secret serialization is provided. The library does not promise heap zeroization.

keyId and scope accept 1..128 ASCII letters/digits/dot/underscore/colon/slash/hyphen.
They appear in the log and must be nonpersonal labels. Scope should distinguish
deployments/tenants that must not correlate. Subjects are well-formed Unicode with
at most 8,192 UTF-8 bytes; lone surrogates and larger/nonstring inputs reject.
No case folding, whitespace trimming or Unicode normalization is performed.

## Stable digest and rotation

The lowercase hex digest is HMAC-SHA-256 using the captured key over UTF-8 bytes:

```text
"openfeature-local-audit-subject/v1\u0000" + JSON.stringify([keyId, scope, subject])
```

JSON array framing separates fields unambiguously. Equal key/ID/scope/subject gives
equal output. Changing key, ID or scope changes the pseudonym. Rotate by supplying
a new secret and a new keyId. Logs can contain both IDs during deployment overlap;
no old-to-new subject mapping or dual-secret retention is installed. The caller
owns key entropy, distribution, retention and scope isolation. Removing the option
stops new correlation fields without changing flag decisions or old logs.

Pseudonyms enable correlation and remain sensitive data; they are not anonymization,
encryption or authorization. A party with the secret can test guessed identifiers.
Protect log access, secret access and retention separately. Known identities and
reused secrets/scopes can enable linking. Do not put identities in keyId/scope.

## Audit and integrity behavior

Invalid subject generation fails the audit write before sink delivery. Existing
bestEffort keeps the evaluated value and observes a failed write; returnDefault
returns the caller's safe default and visible SDK error. No raw subject is included
in helper errors. Custom pseudonymizers are trusted caller code: they own their
secret behavior and exceptions, but their returned metadata is copied and validated
against exactly the four fields without invoking accessors/toJSON. An undefined
custom result omits the field. Shape validation does not prove a custom digest is HMAC.

Plain serialization preserves the optional metadata. Chain capture freezes it,
rejects extra/raw fields and includes it in the existing canonical event hash.
Tampering fails verification. Existing records without pseudonym retain the same
canonical bytes, snapshot hashes, evaluation, replay and redaction defaults.
Older alpha chain verifiers reject the new field: upgrade the verifier with the
writer when enabling this opt-in. HMAC subject correlation does not authenticate
whole-log history; independent trusted checkpoints remain necessary.

No user/subject/key/scope labels are added to metrics or operational status.
The default evaluation path performs no HMAC computation. Configured audit writes
perform one bounded synchronous HMAC; storage backpressure/failure policies remain
separate. Broad throughput claims require workload-specific measurement.
