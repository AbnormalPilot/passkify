## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem it solves. For a behaviour change, say what was wrong before. -->

## Checklist

- [ ] `npm run typecheck && npm test && npm run verify` passes
- [ ] Tests cover the new behaviour — for a verification change, including the
      case that should now be **rejected**
- [ ] Public API changes are documented in the same commit (the docs site
      compiles against `src/`, so drift fails the build)
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`
- [ ] No new runtime dependencies (`packages/passkify` must stay at zero)

## Security impact

<!-- Does this touch verification, parsing, or the store contract? If not, say
     "none". If it does, say what an attacker could do before and after. -->
