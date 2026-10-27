# Optional active signed snapshot expiry

`LocalProviderOptions.snapshotExpiryPolicy` is `"continue"` by default. It keeps
last-good behavior after a refresh failure or signed artifact expiry. Set
`"returnDefault"` to stop using an active signed artifact when the trusted provider
clock reaches its captured `provenance.expiresAt`.

```ts
const verified = verifier.verify(signedBytes, previousProvenance);
const provider = createReloadableLocalProvider({
  ...verified,
  env: {},
  snapshotExpiryPolicy: "returnDefault"
});
// Managed providers accept the same policy in their `provider` options.
```

At `now >= expiresAt`, all four typed resolutions return that call's original
default, reason ERROR and OpenFeature PROVIDER_NOT_READY. Variant, rule and snapshot
flag metadata are omitted. The gate runs before core flag lookup and overrides;
expired content cannot supply even an emergency/override value. Choose safe caller
defaults: a default of true still returns true. This is evaluation policy, not
business authorization, key revocation or a global kill switch.

## Time and request boundaries

The existing optional `clock` (default Date.now) provides nonnegative safe-integer
epoch milliseconds. Signed expiry and a scheduled flag share one initial clock
capture; caller context cannot supply it. A throwing, fractional, negative,
non-finite or unsafe clock returns the same default error without exposing its
cause. An invalid clock can recover before expiry. Once expiry is observed, a
private guard latches it for that artifact, so a later clock rollback cannot revive
it. Identical provenance, including cloned input and same-content updates, retains
the latch while that guard remains active or captured by a request. A different
valid artifact starts a new guard. This is no historical/durable expiry blacklist:
replacement, an explicit unsigned update or restart can discard the old guard.

Without an expiry observation, a rolled-back or dishonest clock can still defer
wall-clock expiry; the clock remains trusted, as in signature verification. This
policy adds no monotonic TTL, clock-skew allowance, or active maxAgeMs check.
Signature verification's maxAgeMs/issuance/lifetime checks remain admission rules.

Evaluation captures one snapshot/provenance pair. After audit waiting or synchronous
sink work, a successful candidate is checked again against that same artifact
before final metrics/outcome reporting. Replacing the active snapshot while a
request waits does not substitute a new snapshot into the old request. Existing
error/default results, including audit-confirmation failures, keep their error
precedence. Diagnostic callbacks, SDK after/finally hooks and caller/business work
remain later, synchronous/non-preemptible boundaries; expiry does not guarantee
validity through those operations. Keep operator callbacks short.

The gate performs O(1) checks, retains one small guard per live captured artifact,
and starts no timer, watcher, I/O, background task or per-evaluation signature check.
Default/unsigned unscheduled paths add no clock reads. Enabled signed resolutions
read the clock initially and recheck successful candidates before final observations;
schedule evaluation still uses only the initial value.

## Updates, audit and recovery

Renewed signed provenance can resume same-content evaluation without a
ConfigurationChanged event, using the existing atomic update/transaction contract.
Cancellation or failed validation/persistence does not activate it. Successful
unchanged refresh counters and monotonic staleAfterMs status retain their meanings;
observing expiry neither increments refresh failures nor clears active provenance.
There is no automatic expiry event/status transition. Status exposes the original
provenance; resolution reports the policy.

Already-expired candidates produce the ordinary single error audit candidate.
When expiry occurs after that candidate was written, the record remains the original
candidate; no replacement/recursive audit is appended. Opt-in auditCorrelation
metadata and onAuditOutcome link its event ID to the final PROVIDER_NOT_READY
response. auditDefaultApplied stays false for expiry defaults because audit policy
did not cause them. Audit success is not business execution.

Unsigned bootstrap and explicit unsigned updates have no expiresAt and remain
outside this policy. An unsigned update clears signed provenance and its guard,
even for identical contents. Direct provenance is caller-asserted metadata, not
signature authentication; only the verifier authenticates it. Keep update APIs
trusted and apply the existing verifier/replay floor for signed refreshes. Replay
floors, persistence and recovery bootstrap selection are unchanged. See
`signed-snapshots.md` and `snapshot-recovery.md`.
