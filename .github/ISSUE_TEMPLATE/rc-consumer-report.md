---
name: Release Candidate Consumer Report
about: Record a separate-repository normal-registry integration result for a published release candidate.
---

## Repository separation

- Consumer repository or project:
- Consumer commit or immutable revision:
- Consumer CI run:
- Relationship to the package maintainer (`independent` or `same-maintainer`):

## Package and install path

- Package version:
- Registry channel or exact package spec:
- Package manager and version:
- Install command, with credentials and private registry details removed:
- Clean install without a workspace link or local tarball: yes/no

## Environment

- Operating system and architecture:
- Node.js version:
- `@openfeature/server-sdk` version:
- TypeScript version and build tool:

## Integration exercised

- [ ] ESM
- [ ] CJS
- [ ] TypeScript declarations
- [ ] CLI validation
- [ ] JSON or YAML flag loading
- [ ] Environment overrides
- [ ] File watcher and configuration-change events
- [ ] Audit or replay
- Other:

## Result

- Outcome:
- Package behavior relied on:
- Compatibility problems:
- Workarounds:

## Reproduction and evidence

- Minimal reproduction or public code link:
- Relevant logs or errors, with sensitive data removed:
- Validation commands and results:

## Confirmation

- Sensitive or private details were removed: yes/no
- Separate repository from this package: yes/no
- Maintainer relationship is disclosed accurately: yes/no
