# Selected bounded targeting and migration scope

Owner: 0disoft. Selected 2026-10-28 from inspected alpha.109 code and the alpha.102
review, under the existing local-main/no-push work order. Independent adoption is
excluded. Per-run 20-minute/no-new-unit-after-10-minute limits still apply.

## Ranked candidates and decisions

1. Literal startsWith/endsWith targeting: tenant/environment namespace prefixes and
   hostname/service suffixes cannot be expressed with existing eq/in/numeric/SemVer
   leaves without enumerating every value. Deliver bounded literal operations,
   preserving own-data access, first-match priority, v1 and privacy. No regex engine,
   coercion, normalization, context cache or networking. Implemented in alpha.110;
   see `../library/flag-file-schema-v2.md` for exact length/empty-input rules.
2. flagd static JSON import: selected first external format because it is directly
   adjacent to existing OpenFeature users. Only explicit ENABLED, homogeneous
   variants and a named existing defaultVariant can preserve static value selection.
   Reject targeting/shared evaluators, metadata, DISABLED, missing/null defaults,
   unsupported root/flag fields and ambiguous types. No partial conversions and no
   claim to preserve other products' bucketing, audit identity, signatures or metadata.
   Implemented in alpha.111; see `../library/import-flagd.md`.
   Default report must be redacted; emitting complete sensitive configuration must
   require an explicit flag. No deployment, automatic update or source modification.
3. Presence/negation: delivered in alpha.112. Boolean exists distinguishes safe
   own defined data (including null) from absence and invalid access. Guarded not
   propagates invalidity through its entire subtree rather than complementing
   invalid input into a match. See `../library/presence-and-negation.md`.
4. Reusable conditions: offline-only compilation delivered in alpha.113 under
   ADR0016, with explicit authoring input, cycle/unused-definition checks and budgets
   counting every reference hop/occurrence. Current v1 examples do not demonstrate
   production duplication; no runtime registry or adoption claim is added. See
   `../library/reusable-conditions.md`. Alpha.114 adds the generated, packaged offline
   authoring-v1 editor schema; compilation still owns semantic limits.
   Runtime references and general foreign
   JsonLogic remain deferred pending actual need and proven equivalence.

The official flagd [definition reference](https://flagd.dev/reference/flag-definitions/)
requires state and homogeneous variants; disabled and absent/null-default behavior
uses code defaults. Targeting is JsonLogic. These semantics were checked on the
selection date; this is a deliberately narrow importer, not full schema compatibility.
Ordinary local v1 files remain supported: do not rewrite them solely to upgrade the
package. Existing v1/v2 evaluation/replay and rollout semantics remain the baseline.
