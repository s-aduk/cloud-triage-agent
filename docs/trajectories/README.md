# Agent trajectories

This folder holds representative execution trajectories for both workflows,
per the hackathon's "Agent trajectories" deliverable — each one traces from
the agent's instructions through tool/retrieval responses to the final
result, including retries or overrides where they happen.

## Status

- `ILLUSTRATIVE-case-010-*.md` — **mocked, not a real Bedrock run.** Generated
  from scripted responses (the same technique as
  `services/triage-api/src/services/__tests__/triageServiceLLM.test.ts`) to
  demonstrate the trajectory format and, specifically, the classify → retrieve
  → verify → **override** mechanism described in `docs/changelog.md`. Kept
  because it's a clear illustration of the design decision that mattered most
  in this project, but it is not evidence of real model behavior.
- Real trajectories are pending Bedrock account access (see
  `docs/changelog.md`'s LLM iteration section for status). Once available,
  run:

  ```bash
  npm run trajectories
  ```

  which captures real trajectories for `case-003` (a clean agent win) and
  `case-010` (the regression case) by default, or a specific set via:

  ```bash
  EVAL_CASE_IDS=case-001,case-005 npm run trajectories
  ```

  Real captures are written as `<case-id>-baseline.md` and `<case-id>-agent.md`
  (no `ILLUSTRATIVE-` prefix) — once those exist for case-010, the illustrative
  version should be deleted rather than kept alongside it, so there's no
  ambiguity about which one is real.
