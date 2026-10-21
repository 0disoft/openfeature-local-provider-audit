# Core rollout preview

This private, self-contained consumer uses the public `/core` import and starts no
server, timer, SDK provider or network request. It previews the same stable cohort
before launch, at 25% and at 100%, checks internal targeting, then proves emergency
disable wins over targeting and explicit overrides. Only aggregate counts/reasons
are printed. The cohort is synthetic non-personal example data.

From the repository root:

```sh
pnpm run smoke:core-example
```

`index.mjs` can also be copied unchanged beside a consuming application's package
manifest after installing the local v2 tarball; run `node index.mjs`. The package's
current npm `latest=1.0.0` has no `/core`; do not run this example against v1.
`pnpm run contract` runs this exact file in a temporary consumer installed from
the real tarball, in addition to the existing root/core ESM/CJS/type checks.

The fixed times make results repeatable. Applications supply a trusted clock,
stable targeting keys and already-loaded configuration. Schedule percentages
describe cohort eligibility, not an exact count in every small population.
Changing the seed changes assignments. Backwards time re-evaluates that stage;
the library owns no monotonic clock, scheduler or timer. These flags do not enforce
authorization. Keep private rules/credentials on the server instead of shipping
them to public clients. Full provider/audit/delivery examples remain in node-basic.

This is a maintainer-owned example, not an independent adopter or production claim.
See [the adoption guide](../../docs/sdk/adoption-guide.md) for stable versus preview
installation, operational recipes, reproduction commands and evidence boundaries.
