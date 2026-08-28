# Changelog

All numbers below come from `npm run eval:local`, which builds the real Lambda
handlers with `tsc` and runs them in-process against the 10 cases in
`data/evaluation-cases.json` — no AWS deployment required. Raw output is in
`output/baseline-results.json`, `output/agent-results.json`, and
`output/score.json`.

**Note on scope:** both workflows below are rule-based (keyword matching +
Jaccard-similarity retrieval), not LLM-backed yet. This entry documents the
rule-based baseline vs. rule-based "agent" comparison as the starting point.
LLM integration is the next iteration, not yet included in these numbers.

## Bugs found while getting the eval to actually run

Before any accuracy numbers could be trusted, three defects had to be fixed —
all silent failures that a real deployment would have hit:

1. **`services/triage-api/tsconfig.json`** had `strictFunctionType` (not a
   real compiler option — typo for `strictFunctionTypes`), so `tsc` failed
   outright. The project had never actually been built.
2. **`services/triage-api/package.json`** pinned `middy@^0.36.0` and
   `@middy/core@^0.36.0` together. `@middy/core` never published a `0.x`
   version — that version number belongs only to the old unscoped `middy`
   package — so `npm install` failed from a clean checkout. Neither package
   is imported anywhere in `src/`, so both were removed.
3. **`data/knowledge-base.json`** had a malformed `resolution_actions` array
   (missing opening bracket) for `kb-008`, breaking `JSON.parse`. Combined
   with a path bug in `loadKnowledgeBase()` (resolved 3 directories up
   instead of 4, landing on a nonexistent `services/data/` folder), the
   agent's retrieval step silently failed in *every* environment and always
   fell back to "no context found" — meaning the retrieval/verification
   step advertised in the README had never actually run successfully.

With both fixed, retrieval works: a correctly-loaded KB entry now raises
confidence from 0.3 to 0.8 on cases with a matching entry.

## Baseline vs. rule-based agent (current)

| Metric | Simple baseline | Rule-based agent | Change |
|---|---|---|---|
| Correct triage (type + severity) | 5/10 (50.00%) | 7/10 (70.00%) | +2 cases (+20.00 pp) |

**What the agent gets right that the baseline doesn't:** cases 3, 4, and 8
(RDS connection exhaustion, Lambda throttling, network connectivity) all
have symptoms split across multiple weak keywords that no single baseline
`if` branch covers. The agent's KB retrieval step picks these up because it
scores similarity across the whole description rather than matching a fixed
keyword list.

**Challenging case — a real regression (case-010, Cost Anomaly):** the
baseline gets this one right; the agent doesn't. The description ("AWS Cost
Explorer shows **Lambda** costs increased 300%...") contains the word
"lambda," which the agent's first-pass keyword classifier weighs equally
with "cost" — and on a tie, it picks whichever category appears first in an
internal list (`throttling` comes before `cost-anomaly`), regardless of
which signal is actually stronger. The retrieval step then *does* find the
correct "Unexpected Cost Increases" KB entry, but the verification step only
adjusts confidence and next-action text — it never lets a correctly
retrieved KB entry override a wrong initial classification. So a genuinely
useful retrieval result gets discarded.

**Hot take:** a verification step that can *lower confidence* but can't
*change the answer* isn't really verification — it's a confidence display.
The failure here wasn't retrieval (which worked correctly); it was that the
pipeline had no path from "retrieval disagrees with initial guess" back to
"reconsider the initial guess." That's the specific thing an LLM-backed
verifier needs to do differently: treat retrieved evidence as a vote that
can overturn the first guess, not just a modifier on how confident to be in it.

Case-007 (data pipeline failure) is a softer miss: the agent labels it
`data-pipeline` where the expected label is `resource-exhaustion`. The
underlying cause (OOM in a Glue job from data volume growth) is described
correctly in the agent's own output — this is a taxonomy overlap between two
categories that describe the same incident from different angles, not a
comprehension failure. Worth tightening the label taxonomy before the next
iteration.

## Next iteration (planned)

Replace both keyword classifiers with an LLM call, keeping the same
classify → retrieve → verify → summarize shape, but making verification
capable of overturning the initial classification when retrieved evidence
disagrees — directly targeting the case-010 failure mode above.
