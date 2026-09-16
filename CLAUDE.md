@AGENTS.md

## Claude-specific notes

- The skills in `skills/` are the same content this repository publishes for
  users. When changing library behaviour, check whether a skill documents the
  thing you changed — `skills/passkify-debugging/references/error-codes.md`
  is generated, but the prose around it is not.
- `npx passkify doctor` runs the same checks a reviewer would ask about. If you
  scaffolded or edited an integration, run it and paste the output.
- Prefer `npm run verify` over running the pieces individually; it is the same
  set CI runs and it is fast.
