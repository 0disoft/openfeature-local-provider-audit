# Presence and guarded negation (v2, alpha.112)

```json
{ "attribute": ["tenant", "id"], "op": "exists", "value": false }
```

```json
{ "not": { "attribute": ["tenant"], "op": "eq", "value": "blocked" } }
```

`exists` requires a boolean operand. Presence means safely reached own data with a
defined supported value, not truthiness. `null`, false, zero, empty strings, objects
and arrays are present. Objects are inspected only along the named path; endpoints
and unrelated cyclic data are not recursively validated or traversed.

| Observed path | exists true | exists false | not exists true | not exists false |
| --- | --- | --- | --- | --- |
| No context, absent property, own undefined, missing/undefined ancestor | false | true | true | false |
| Own null/false/0/empty string/object/array endpoint | true | false | false | true |
| Inherited property, accessor, forbidden segment, throwing proxy trap | false | false | false | false |
| Null/primitive intermediate, invalid context container | false | false | false | false |
| Non-finite number, string over 4096 units, function/symbol/bigint endpoint | false | false | false | false |

Reading uses own data descriptors; inherited/accessor values are denied rather than
classified as absent. No getters are invoked. Proxy descriptor/has traps may execute
user code; their exceptions become invalid observations, not matches. Arbitrary host
code/proxy side effects remain outside the safety guarantee. Explicit own defined
string `targetingKey` retains precedence over the context field, including empty
strings. Undefined explicit keys fall back; inherited/accessor/non-string explicit
keys are invalid for these predicates. Contexts are read afresh on every evaluation.

`not` accepts exactly one condition. Internally its subtree distinguishes true,
false and invalid; invalid never becomes true, even through double negation.
Missing/undefined comparisons are invalid. `eq` requires the same scalar type;
`in` requires a bounded scalar whose type appears among its candidates. Numeric
operators require finite numbers, literal operations require bounded strings and
SemVer requires valid strict versions. Thus `not(eq "blocked")` does not match a
missing/null/numeric attribute. `not(eq null)` also does not select other scalar
types; this is guarded typed negation, not a total JavaScript complement.

Inside `not`, all/any inspect siblings until an invalid result is found or all are
checked. Invalid dominates the subtree regardless of sibling order, even if an
earlier false/all or true/any already determines its ordinary boolean result.
This prevents `not(all(false, malformed))` from matching. Outside `not`, existing
positive all/any short-circuit and matching behavior stay unchanged. Explanation
traces expose ordinary matched booleans only; no raw attribute values are added.

The new node participates in existing 8-level/100-node per-rule budgets; groups
still allow 1..20 children. A guarded subtree visits at most its existing 100 nodes,
with at most 8 path segments per leaf and bounded membership/string/SemVer work.
No I/O, timers or accumulating context cache are introduced. Existing snapshots,
hashing, rollout buckets, priority, override/kill-switch precedence, audit redaction
and replay semantics remain unchanged. v1 rejects all rules; old packages reject
new expressions. Upgrade evaluators and replay tools before delivering these forms.

Alpha.116 extends the private index for validator-owned `in` arrays of 16..100
candidates with their at-most-four scalar types. Guarded type eligibility and value
membership use expected constant-time set lookups instead of a per-evaluation type
scan. The index is constructed once in O(N); small and unvalidated arrays keep live
linear lookup. Null remains a distinct supported value, wrong types remain invalid,
and order/duplicates/hash/traces and invalid-dominates-group behavior are unchanged.

These expressions are not authorization or tenant-isolation controls. Reusable
segment references and foreign JsonLogic conversion remain separate, unsupported
contracts; the static flagd importer still rejects any targeting expression.
