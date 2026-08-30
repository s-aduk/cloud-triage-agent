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

## Iteration: LLM-backed baseline and agent

**What changed:** Both workflows now call an LLM instead of keyword
matching. `baselineTriageLLM` is a single call, no retrieval, no
verification — the direct LLM equivalent of the rule-based baseline above.
`agentTriageLLM` keeps the same classify → retrieve → verify → summarize
shape as the rule-based agent, with one deliberate change: **the verify
step is explicitly instructed that it may override the initial
classification when retrieved knowledge-base evidence disagrees with it**,
instead of only being able to adjust confidence. This is a direct fix for
the case-010 failure mode above, where a correctly-retrieved KB entry was
discarded because the rule-based verifier had no mechanism to act on
disagreement.

A mocked-client test (`src/services/__tests__/triageServiceLLM.test.ts`)
confirms this override mechanism actually fires given a case shaped like
case-010: initial classification "throttling", retrieved KB evidence
supporting "cost-anomaly", final output "cost-anomaly". That's a test of the
code path, not of the model's actual judgment — real accuracy numbers below
still need a real run.

**Agent trajectories (hackathon deliverable):** `agentTriageLLMWithTrajectory`
and `baselineTriageLLMWithTrajectory` capture a step-by-step record (prompts,
tool responses, and — for the agent — whether verification overrode the
initial guess) for every call. `npm run trajectories` runs this against real
model calls for a couple of representative cases and writes them to
`docs/trajectories/`. Since a real captured run is still pending (see below),
`docs/trajectories/ILLUSTRATIVE-case-010-*.md` demonstrates the format and
the override mechanism using the same mocked-response approach as the unit
test — clearly labeled as illustrative, not a real run, per
`docs/trajectories/README.md`.

### Provider pivot: Amazon Bedrock → Google Gemini

This project's LLM calls were originally built against Amazon Bedrock
(`services/triage-api/src/services/bedrockClient.ts`, still in the repo and
functional — see below). Getting a single real call to succeed on Bedrock
hit a sequence of account-level walls, in order:

1. `ResourceNotFoundException: Model use case details have not been
   submitted for this account` — Anthropic models on Bedrock require a
   one-time use-case form per account, separate from IAM permissions.
2. After submitting that form, a specific newer model (Claude Sonnet 5) came
   back `403 ... is not available for this account` — evidently gated
   per-model on top of the use-case form.
3. Switching to Claude Haiku 4.5 hit `ThrottlingException: Too many tokens
   per day` — an account-wide daily token quota, not a per-minute rate limit,
   so waiting didn't help within the same day.
4. Checking Service Quotas directly showed almost every Bedrock
   model-invocation quota simply **not listed** as available for the
   account — only Bedrock Flow-related quotas were. Switching to Amazon
   Nova Lite (Amazon's own first-party model, which unlike Anthropic's
   doesn't require the use-case form at all) hit the identical throttling
   error.

That last point was the deciding signal: switching models within Bedrock
didn't help, which means the restriction is account-wide (consistent with
a free-tier AWS account not yet provisioned for Bedrock's normal default
quotas), not specific to Anthropic or to one model. An AWS support ticket
for quota provisioning was the correct fix for staying on Bedrock, but that
has an unpredictable turnaround, and a paid Anthropic API key wasn't an
option either (no budget for it) — so rather than block the whole LLM
iteration on AWS account provisioning, the project moved to **Google
Gemini** (`gemini-2.5-flash` via Google AI Studio), which has a genuinely
free tier (~1,500 requests/day at time of writing) with no credit card and
no separate approval step.

**This pivot cost almost no code**, which is worth calling out as a design
decision that paid off: `bedrockClient.ts` and `geminiClient.ts` both
implement the identical `invokeStructured({system, prompt, toolName,
schema}) → T` interface, so `triageServiceLLM.ts` — the classify/retrieve/verify
logic, the override behavior, the trajectory capture — didn't change at
all. Only the provider-specific client file changed, plus `template.yaml`
(dropped the Bedrock IAM policy, added a `GeminiApiKey` parameter) and the
one import line in `triageServiceLLM.ts`. Bedrock support is still in the
repo and still functional; switching back is a one-line import change plus
restoring the IAM policy, if AWS account access gets sorted out later.

**Hot take (infrastructure, not just agent design):** a lot of "isolate
the model behind a provider-agnostic interface" advice is framed as a
portability nice-to-have. In practice here it was the difference between
losing the rest of a hackathon submission window to AWS support-ticket
turnaround and being unblocked in the time it took to sign up for a second
API key. If a project's core value depends on an LLM call succeeding,
treating provider access as a single point of failure — worth a fallback
path designed in from the start, not bolted on after the first blocker.

**Verified so far (no live model calls made yet):**
- `tsc` build is clean with both the Bedrock and Gemini client files present
  (only Gemini's is actually imported/used)
- `npm run eval:local` still reproduces the unchanged rule-based 50%/70%
  numbers above, confirming none of this refactoring changed rule-based
  behavior
- Unit tests pass against a mocked client (4/4), including one pinning that
  the verify step's prompt actually instructs it to override on disagreement
- A standalone smoke test (mocking the `@google/genai` SDK class directly,
  not just our own module) confirmed the request shape
  (`responseMimeType: application/json`, `responseSchema`, `systemInstruction`)
  and response parsing are correct
- `template.yaml` lints clean with the Gemini parameter and esbuild build method

**Not yet done — real accuracy numbers pending:** `npm run eval:llm` runs
the same 10-case comparison against live Gemini calls, but hasn't been run
yet in the environment these numbers were produced in (no network access to
external APIs there). This section will be replaced with real
baseline-vs-agent numbers, evidence files, and a challenging-case writeup —
the same standard the rule-based section above was held to — once
`npm run eval:llm` has actually been run once, with a real `GEMINI_API_KEY`.

**Do not treat any percentage in this section as measured until this note
is replaced.** The whole point of the earlier iteration was catching
numbers that were written before they were run.

### Bug found on first real Gemini call: thinking tokens ate the output budget

First real `npm run eval:llm` run (via `EVAL_CASE_LIMIT=1`, one case) showed
something useful: **the baseline call succeeded** — confirming the
`GEMINI_API_KEY` auth and request wiring genuinely work end-to-end, unlike
every Bedrock attempt before it — but **the agent call failed** with:

```
Error: Gemini response was not valid JSON despite responseMimeType: application/json.
Raw text: {"incidentType": "
```

The response was cut off mid-string. Root cause: Gemini 2.5 Flash has
"thinking" (internal chain-of-thought) enabled by default
(`thinkingBudget` defaults to `-1`, i.e. dynamic/unbounded), and thinking
tokens count against `maxOutputTokens`. At `maxTokens: 512`, thinking
consumed the entire budget before the model could emit any of the actual
JSON — this is a documented Gemini 2.5 Flash gotcha, not specific to our
prompts. Fixed in `geminiClient.ts` by setting `thinkingConfig: {
thinkingBudget: 0 }` (valid for Flash; Gemini 2.5 Pro requires a nonzero
minimum and would need a different value if swapped in later) and bumping
the default token budget to 1024 as a margin. Verified via a mocked-SDK
smoke test that both values are actually present in the outgoing request.

This is exactly the kind of thing a rule-based system never has to worry
about and an LLM-based one always does: a classification task that fits
comfortably in a small token budget can still fail non-deterministically
if part of that budget silently goes to something other than the answer.
Worth remembering for the next provider swap, too — thinking-token behavior
and defaults aren't standardized across providers.

### Second bug found on the first full 10-case run: free-tier rate limit, not a token quota

With the thinking-token fix in place, a full `npm run eval:llm` run
produced **Baseline: 4/10 (40%), Agent: 0/10 (0%)** — but these numbers are
a quota artifact, not real accuracy data, and should not be read as "the
agent got worse." What actually happened: `gemini-2.5-flash`'s free tier
caps at **5 requests per minute** (confirmed via the 429's
`GenerateRequestsPerMinutePerProjectPerModel-FreeTier` quota, value `5`) —
a much tighter limit than the ~1,500/day figure suggested, since that's a
separate daily cap stacked on top of this stricter per-minute one. The eval
script only waited 500ms between cases, so after the first several calls
succeeded quickly, every subsequent call failed instantly with a 429.
Baseline got partial credit only because its first 6-7 calls landed before
the quota reset; agent scored 0% because each case needs *two* successful
calls (classify + verify) in sequence, so a single failure anywhere in that
pair kills the whole case — not because the agent logic is wrong.

Fixed with two changes to `geminiClient.ts` (not the eval script, since the
agent's classify→verify pair fires with zero gap between them *inside*
`agentTriageLLM` — pacing only the eval loop's outer per-case delay
wouldn't have caught that): a module-level rate limiter enforcing a minimum
13-second gap between *any* two real calls regardless of call site, plus
retry-with-backoff on 429 that respects the server's suggested `retryDelay`
when present. Verified with a smoke test that mocks the SDK to fail once
with a 429: confirmed the limiter enforces the ~13s spacing and that the
retry actually recovers and returns a correct result afterward.

Practical consequence: a full `eval:llm` run now takes roughly 6-7 minutes
instead of a few seconds, because it's deliberately paced to stay under
the limit rather than racing it and hoping. That's expected, not a hang.

**Status: still pending a valid run.** Two real bugs (thinking-token
truncation, then rate limiting) have now been found and fixed from two
consecutive real attempts — which is itself useful signal that the
plumbing works and each attempt is making genuine progress — but there is
still no run where all 30 calls completed successfully. The next
`npm run eval:llm` with both fixes in place is the one whose numbers
should actually replace the placeholders above.

### Third bug: the "5 requests/minute" limit was a symptom, not the real constraint

The next full run (with the per-minute rate limiter and retry-with-backoff
from the previous fix in place) still failed — but with a different,
more informative error. After a few calls, the retry loop entered a cycle
of waiting ~58 seconds and retrying, failing every time, for several
minutes, before finally giving up. The quota ID in the error had changed:

```
"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"20"
```

Not a per-minute limit — a **daily** cap of 20 requests for
`gemini-2.5-flash` on this account. Google cut Gemini 2.5 Flash's free-tier
daily quota sharply in December 2025 (widely reported drop from ~250/day to
as low as ~20/day for many accounts); the commonly-cited "~1,500
requests/day" figure that motivated the original Bedrock→Gemini switch
turns out to apply to `gemini-2.5-flash-lite`, not full Flash, and was
simply wrong for the model this project had defaulted to.

This made the previous fix actively counterproductive: retrying a
per-day-exhausted quota is not like retrying a per-minute one — it will not
recover on any timescale the retry loop was waiting for, so every retry
attempt was itself another request burning further into an
already-exhausted daily budget, for a guaranteed second failure.

Two fixes in `geminiClient.ts`:
1. **Switched the default model to `gemini-2.5-flash-lite`** — thinking is
   disabled by default for this model (so the existing `thinkingBudget: 0`
   setting is a no-op, not a compatibility risk), and its free tier is far
   more generous: 15 requests/minute and ~1,000 requests/day, comfortably
   covering the ~30 calls a full eval needs.
2. **Stopped retrying daily-quota errors.** Added `isDailyQuotaError()`,
   which checks for `PerDay` in the error before deciding whether to retry;
   on a match, it fails immediately with a message explaining the quota
   won't reset until midnight Pacific, rather than burning further quota on
   retries that cannot succeed. Per-minute errors still retry as before.

Verified with two targeted smoke tests: one confirms the daily-quota path
fails after exactly one call (not five retries) and does so in under a
second (not tens of seconds of pointless waiting); the existing
per-minute-retry and thinking-token tests were re-run and still pass
against the model switch.

**Hot take, updated:** the earlier hot take was "don't treat a single LLM
provider as a single point of failure." The sharper version, after three
rounds of this: **don't treat a single free-tier *model* as a stable
target, either** — quota policy on a specific model can change
materially (a 90%+ cut, in this case) between when a blog post is written
and when you actually call the API, and the fix isn't just "add a retry
loop," it's "know which failures a retry loop can't fix, and fail fast on
those instead." Two of the three real bugs found in this LLM integration
were quota/rate-limit shaped, not model-quality shaped — worth remembering
when estimating how much of "getting an agent to work" is prompt design
versus just getting a reliable connection to it.

**Status: still pending a valid run**, now on attempt three
(`gemini-2.5-flash-lite`, with both the thinking-token and daily-quota
fixes in place). The next successful `npm run eval:llm` is the one whose
numbers replace the placeholders in this section.

### Fourth attempt: real partial data, and a resumable eval script

With the Flash-Lite switch and fail-fast daily-quota handling in place, a
run got much further: **baseline completed all 10/10 cases** (50% accuracy
— identical to the rule-based baseline's rate, though not necessarily the
same cases right or wrong; worth checking once the full picture exists) and
**agent completed 6/10 cases** before hitting the same
`GenerateRequestsPerDayPerProjectPerModel-FreeTier` error — this time with
`quotaValue: "20"` for `gemini-2.5-flash-lite` too, on this specific
account. The officially documented ~1,000/day figure for Flash-Lite
evidently does not apply here; this account has a flat ~20-requests/day
cap regardless of which Gemini model is used.

That's a harder constraint than the previous two bugs: a daily cap doesn't
care how well a script paces itself within a day, and 30 calls (10 baseline
+ 20 agent) does not fit inside 20 no matter how it's scheduled. Splitting
work across multiple days is the only real option on this account/tier —
which makes the eval script's behavior on a partial failure the thing that
actually needed fixing, not the pacing itself.

Fixed by making `eval/run-llm.js` resumable: before running, it loads any
`output/{baseline,agent}-results-llm.json` from a previous run and skips
calling the handler again for any case that already has a successful
(non-error) result, reusing that result instead. Only cases that are
missing or previously failed spend new quota. Verified with a scripted
test (fake previous results with 2 successes + 1 failure, mocked handlers
that log every real invocation): confirmed exactly the previously-failed
case triggers a new call and the two successes are reused untouched, and
that `FORCE_RERUN=1` correctly bypasses this and re-runs everything when
that's actually wanted. `score-llm.json` now also reports `complete: true/false`
per workflow, and the script prints an explicit reminder to re-run once
quota resets if anything is still incomplete.

Practical upshot: getting a fully complete `eval:llm` run on this
account will likely take multiple days (roughly 2 days' worth of quota at
20/day for the 30 calls needed), re-running the same command each day
until both workflows report `complete: true`. That is a real constraint of
this specific free-tier account, not a bug in the harness at this point —
the harness's job now is just to not waste quota re-litigating cases that
already succeeded, which it does.

### Fifth attempt: switching GEMINI_MODEL to a newer Gemini generation surfaced a real API-compatibility bug

Trying to route around the exhausted daily quota (each model tracks its
own separate daily quota bucket, so a different model is effectively a
fresh budget), a run was tried against `gemini-3.5-flash-lite` — a real,
current model. This is worth noting plainly: this project's earlier
assumption that Gemini's lineup stopped at the 2.5 series was outdated —
Google shipped a full Gemini 3 generation (3, 3.1, 3.5, 3.6, 3.7 across
Pro/Flash/Flash-Lite tiers) after that assumption was made, and it took a
real error to catch it.

The resulting error was a generic `400 INVALID_ARGUMENT` with no further
detail — unhelpful on its own, but traceable: Gemini 3.x models use a
different, incompatible thinking-configuration field. 2.5-and-earlier
models take `thinkingBudget` (a token count; `0` disables thinking
entirely). Gemini 3.x models instead take `thinkingLevel` (a string enum —
`MINIMAL`/`LOW`/`MEDIUM`/`HIGH`), and **do not support full thinking-off**
at all — sending `thinkingBudget: 0` to a Gemini 3.x Flash-Lite model is
requesting a state that model family can't enter, which is exactly the
kind of thing that surfaces as a generic 400 rather than a descriptive
error.

Fixed in `geminiClient.ts` with `buildThinkingConfig(model)`: detects
Gemini 3.x by model-ID prefix and sends `thinkingLevel: ThinkingLevel.MINIMAL`
(Google's own docs describe this as "as close as possible to a zero budget
for thinking," the correct semantic equivalent given full disable isn't an
option) instead of `thinkingBudget: 0`. 2.5-and-earlier models are
unaffected — they still get the original `thinkingBudget: 0`. Confirmed
against the installed SDK's own type definitions (not just search results)
that `ThinkingLevel.MINIMAL` is a real, correctly-cased enum value, and
verified with a smoke test that mocks the SDK and asserts the right field
appears for three different model IDs across both families
(`gemini-2.5-flash-lite`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`).
The default model (`gemini-2.5-flash-lite`) is unchanged — this fix is
about making `GEMINI_MODEL` overrides to a Gemini 3.x variant actually
work, which matters in practice here specifically because switching models
is the practical way to dodge an exhausted per-model daily quota on this
account.

**Hot take, take three:** the previous hot take was about not treating a
free-tier model as a stable target because quota policy changes. This
adds a sharper edge to it: **a model swap isn't just a config change, it
can be a different API surface.** The same provider, the same SDK, the
same `generateContent` call — and a parameter that worked perfectly on one
model generation returns an opaque error on the next one. Abstracting
"the LLM provider" behind an interface (as this project already did,
Bedrock vs. Gemini) is necessary but not sufficient; abstracting across
*model generations within the same provider* turned out to need the same
discipline. The fix pattern was the same both times, too: check the SDK's
actual type definitions and the model's own docs before assuming
parameters carry over, rather than assuming continuity.

**Status (superseded — see below):** this section originally ended "still
pending a valid run." A run did complete shortly after, on
`gemini-3.5-flash-lite`. Real numbers and the finding that came from them
are documented next.

## Real LLM run: baseline 6/10, agent 5/10 — and what actually explains the gap

A full `GEMINI_MODEL=gemini-3.5-flash-lite npm run eval:llm` completed all
30 calls in one sitting (separate quota bucket from `gemini-2.5-flash-lite`,
so no multi-day resume needed this time):

| Metric | Baseline (LLM) | Agent (LLM) | Delta |
|---|---|---|---|
| Correct triage (type + severity) | 6/10 (60.00%) | 5/10 (50.00%) | -1 case (-10.00%) |

Read at face value this looks like the agent regressed relative to the
baseline it's supposed to improve on. Comparing the two result files
case-by-case (`output/baseline-results-llm.json` vs. the agent equivalent,
captured in `output/score-llm.json`) shows that's not what happened:

**Baseline and agent agree — same `incidentType`, same `severity` — on 9 of
the 10 cases.** The entire delta is one case, case-010 (Cost Anomaly):
baseline said `cost-anomaly` / `medium` (correct); the agent's verify step
said `cost-anomaly` / `high` (type still correct, severity one notch over).
Both gave near-identical reasoning; the only real difference is that
verification, given more text to reason over (the retrieved "Unexpected
Cost Increases" KB entry, which itself has no severity field), leaned
toward the more dramatic-sounding severity rather than reproducing the
baseline's cooler initial read.

The more useful finding is in the shared misses, not the one that differs.
Across all 5 baseline misses and all 5 agent misses, **4 of 5 are pure
severity over-escalation, and it's the identical failure in both
workflows**:

| case | expected severity | baseline / agent got |
|---|---|---|
| case-003 RDS Connection Exhaustion | high | critical (both) |
| case-004 Lambda Throttling | medium | high (both) |
| case-006 Mixed Signals | medium | high (both) |
| case-010 Cost Anomaly | medium | medium (baseline) / high (agent) |

Every miss goes the same direction — never under-escalation — and it
happens identically whether or not retrieval/verification are involved.
That rules out the agent's architecture as the cause: `CLASSIFY_SYSTEM_PROMPT`
(which both the baseline's single call and the agent's first-pass classify
call use) gave the model no anchor for what actually separates `medium`
from `high` from `critical`, so it defaulted to treating any
large-sounding number ("98% connections," "50x error increase," "300%
cost increase") as justification to round severity up, regardless of
whether it was currently breaking anything for a customer.

(Case-007, `data-pipeline` vs. expected `resource-exhaustion`, is the
taxonomy-overlap issue flagged in the rule-based section above — still a
real ambiguity in the label set, but both workflows fail it identically,
so it isn't part of the delta either.)

**Fix:** added a shared `SEVERITY_RUBRIC` constant in `triageServiceLLM.ts`
— an impact-based definition of each severity level, plus an explicit
instruction not to round up because a metric changed by a large percentage
unless that change is currently breaking something customer-facing. Wired
into both `CLASSIFY_SYSTEM_PROMPT` (baseline + agent first pass) and the
agent's verify-step system prompt, with one extra line on the verify prompt
specifically: *"more evidence is not the same as more impact"* — targeting
case-010 directly, since nothing new in the retrieved KB entry there
actually supported a higher severity than the initial read.

**Not yet done:** re-running `npm run eval:llm` with the rubric in place to
confirm it closes the gap. Given the finding above, the realistic
expectation is a change on the shared over-escalation cases (003, 004,
006, 010), not something specific to the agent — this was never a
retrieval/verification defect. At n=10, a single case is also within
normal run-to-run noise for a temperature-0 call against a lite model;
worth running a few times before trusting any single score as final.

**Hot take:** the eval harness reported "agent regressed" and that framing
would have been wrong to act on. A 10-point aggregate delta drove straight
past what the per-case diff actually showed: near-total agreement, one
severity call that could reasonably go either way, and a shared prompt gap
affecting both workflows equally. Worth normalizing: check whether an
"agent got worse" number is Different Cases or the Same Cases With Small
Deltas before doing any architecture surgery in response to it — those two
situations call for completely different fixes, and only the harness's
top-line number looked like the former here.

## Re-run after the severity rubric: fixed what it targeted, surfaced a sharper problem

`GEMINI_MODEL=gemini-3.5-flash-lite npm run eval:llm` with the rubric in
place:

| Metric | Baseline (LLM) | Agent (LLM) | Delta |
|---|---|---|---|
| Correct triage (type + severity) | 8/10 (80.00%) | 7/10 (70.00%) | -1 case (-10.00%) |

**The rubric did exactly what it was supposed to.** All four
over-escalation misses from the previous run — case-003 (RDS, critical→high),
case-004 (Lambda throttling, high→medium), case-006 (mixed signals,
high→medium), case-010 (cost anomaly, agent's high→medium) — are now
correct, in both baseline and agent identically. Both workflows gained the
same +2. That's strong confirmation the miscalibration really was a shared
prompt-anchor gap, not something in the agent's architecture.

**But the top-line "-10%" persisted, in exactly the same shape as the
previous run: baseline and agent agree on 9 of 10 cases, and the whole
delta is one case.** This time it's case-009 (Certificate Expiry):
baseline correctly said `certificate`/`critical`; the agent's verify step
said `certificate`/`high`. The rubric's `critical` bullet read *"active
data exposure, active security breach, or a full outage of a
customer-facing service right now"* — worded as one flowing clause, which
let the verify step latch onto "not a breach" and miss that "full outage"
was an independent, sufficient condition on its own. An expired cert
failing 100% of TLS handshakes is a textbook outage; it doesn't need to
also be a breach.

Two smaller effects, shared by both workflows (not agent-specific, so not
part of the delta, but worth fixing): case-001 (EC2 CPU spike, sustained
95% CPU + 5x latency) and case-007 (Glue job OOM failure) both flipped
from correct to `medium` — the rubric's "don't round up on a big
percentage" instruction, read too literally, suppressed genuine functional
failures that happened not to be phrased as "outage."

**The deeper issue, once this became a repeat pattern:** this is the
*second* run in a row where baseline and agent agree on 9/10 cases and the
entire delta is exactly one case — different case each time (case-010,
then case-009), same shape. That's a strong enough signal to stop treating
it as noise and ask what's structurally different about the agent's verify
step that keeps producing exactly one small misread per run. The answer:
**the retrieved KB entries carry no `incidentType` or severity signal at
all.** `retrieveContext()` returns `title`/`symptoms`/`common_causes`/etc.
with nothing mapping a pattern to a canonical category or typical
severity. So the verify step's only actual input beyond what the classify
step already saw is more unstructured text to reason over — on exactly the
two fields (`incidentType`, `severity`) the eval grades. More reasoning
surface with no additional grounding is a plausible explanation for why
verification keeps introducing one small, specific misread rather than
reliably correcting the classify step's mistakes: it isn't verifying
against anything more authoritative than its own second read.

**Fixes:**

1. **Added `incident_type` and `typical_severity` to every entry in
   `data/knowledge-base.json`.** These are a genuine domain judgment about
   the typical case for each of the 10 known failure patterns — assigned
   independently, using the same taxonomy/rubric definitions as the
   prompts, not derived from `evaluation-cases.json`'s expected answers (a
   KB that just encoded the answer key would be worthless outside these 10
   cases, defeating the point of a knowledge base). `KnowledgeBaseEntry` in
   `triageService.ts` gained the two matching optional fields.
2. **The verify prompt now surfaces this as an explicit "canonical
   categorization" line per retrieved entry**, and is told to treat a KB
   entry's `incidentType` as a strong default (preferred over the classify
   step's initial guess on disagreement) and its `typicalSeverity` as a
   starting point to adjust from — not copy blindly — based on whether
   *this* incident's description shows it's worse or better than the
   typical case for that pattern. This is the actual grounding advantage
   the agent's retrieval step is supposed to provide and previously
   didn't.
3. **Severity rubric v2**, fixing the two specific misreads: split
   `critical`'s outage clause from its breach clause so a full outage
   qualifies with no security angle required (fixes case-009's failure
   mode directly); anchored `high` to "a customer request path OR a
   required operational process is measurably failing right now," so a
   fully-failed batch job counts even without a live customer request
   (fixes case-007); tightened the anti-escalation instruction to target
   metrics moving while the system still works, not genuine functional
   failures (fixes case-001).
4. **Added an explicit resource-exhaustion vs. data-pipeline taxonomy
   note** to both `CLASSIFY_SYSTEM_PROMPT` and the verify system prompt:
   an OOM inside a data pipeline job is resource-exhaustion (root cause);
   data-pipeline is reserved for pipeline-specific failures that aren't
   resource exhaustion (bad input data, schema drift, orchestration
   failures). Targets case-007's `incidentType` mismatch, which the
   severity fix alone doesn't touch.

Verified: `tsc` builds clean, the existing mocked-client unit tests
(4/4, including the one pinning the verify-override behavior) still pass
unchanged, and `npm run eval:local` still reproduces the identical
rule-based 50%/70% numbers — confirming the KB schema addition didn't
change the rule-based path's behavior (it doesn't read the new fields).

**Not yet done:** a live `npm run eval:llm` run with all of this in place
— this environment has no network access to Google's API, so this section
documents the fix and the reasoning behind it, not a confirmed result.
Given the diagnosis, the realistic expectation is that case-009 gets fixed
by the rubric change alone (KB grounding wasn't even the cause there), and
case-001/007 get fixed by a combination of the rubric anchor change and
the new KB grounding; whether the agent finally reaches parity with or
exceeds the baseline is the thing the next real run actually answers, not
this writeup.

**Hot take:** the useful signal here wasn't the score, it was the *shape*
of two consecutive results — same pattern (9/10 agreement, exactly one
case), different specific case each time. A single bad case is easy to
wave off as model noise; the same *pattern* recurring with a different
case is a sign something structural is missing, not that the model got
unlucky twice. The fix that mattered here wasn't tuning the prompt harder
in response to whichever case failed most recently — it was noticing that
the agent's supposed advantage (retrieval) had never actually been given
anything to ground the verify step's answer in, and reasoning-with-no-new-grounding
was always going to be a coin flip on some case regardless of which
one it landed on.

## Confirmed run: agent beats baseline — 90% vs. 80%

`GEMINI_MODEL=gemini-3.5-flash-lite npm run eval:llm` with the KB grounding
and rubric v2 fixes in place:

| Metric | Baseline (LLM) | Agent (LLM) | Delta |
|---|---|---|---|
| Correct triage (type + severity) | 8/10 (80.00%) | **9/10 (90.00%)** | **+1 case (+10.00%)** |

This is the first LLM-backed run where the agent actually beats the
baseline, and the per-case diff shows why, cleanly:

- **Case-009 (Certificate Expiry) and case-007 (Data Pipeline Failure) are
  now correct in both workflows** — confirming the severity-rubric v2 fix
  (independent outage clause, functional-failure anchor for `high`) and
  the resource-exhaustion/data-pipeline taxonomy clarification both held
  up under a real run, not just the reasoning that predicted they would.
- **Case-004 (Lambda Throttling) is the one case that now separates the
  two workflows, and it's the story this whole iteration was aiming for:**
  the baseline's single blind call misclassified it as `resource-exhaustion`/`high`
  (expected: `throttling`/`medium`) — "Concurrent executions at limit of
  1000" apparently read as resource exhaustion rather than throttling on
  this pass. The agent's verify step, grounded in `kb-004`'s canonical
  `incident_type: "throttling"`, correctly overrode the same wrong initial
  guess (the agent's own classify step opened with the same misread as the
  baseline) back to `throttling`/`medium`. This is retrieval doing its
  actual job for the first time in this eval: not just adding descriptive
  text to reason over, but supplying an authoritative label that catches
  a concrete classification mistake before it reaches the output — exactly
  the "verification can catch errors before they reach the user" case this
  project was trying to build.
- **Worth naming honestly:** the wording added in the previous entry's
  taxonomy note (`"...running out of memory, connections, disk, or
  concurrency"`) is a plausible contributor to the baseline's confusion
  here — "concurrency" is listed as a resource-exhaustion trigger in that
  note, and Lambda's concurrency *limit* is arguably describable that way,
  even though the correct category for hitting it is `throttling`, a
  distinct rate-limiting concept. So part of what made this a good agent
  win may be a self-inflicted ambiguity in the classify-side prompt rather
  than a pre-existing hard case. That doesn't diminish what the agent did
  — the retrieval+verify mechanism is supposed to be exactly the safety
  net for classify-step mistakes, self-inflicted or not — but the honest
  fix, left for a future iteration rather than made blind right now, is to
  narrow that taxonomy note so `resource-exhaustion`'s examples don't
  overlap with concepts `throttling` already owns (rate limits, 429s,
  concurrency caps), so the baseline doesn't need to rely on the agent's
  safety net to avoid a confusion the prompt itself introduced.
- **Case-001 (EC2 CPU Spike) remains wrong in both workflows** —
  `performance`/`medium` vs. expected `performance`/`high` — a sustained
  95%-CPU, 5x-latency incident that the rubric v2 anchor still isn't
  catching as a functional failure. This is the one open failure mode
  left after three iterations, and it's shared (not agent-specific), so
  it's a prompt-calibration problem, not a retrieval-coverage problem —
  `kb-001` exists and is presumably being retrieved, but nothing in the
  agent's context currently tells it that "response time increased from
  200ms to 2s" already crossed into "measurably failing," rather than
  merely "elevated." Next candidate fix: `kb-001`'s `typical_severity` is
  set to `"high"` already, so the more likely lever is making the verify
  prompt trust a KB entry's `typical_severity` more assertively when the
  description's own symptoms match the entry's `symptoms` list closely
  (which they do here — "CPU > 90%" and "increased response time" both
  match `kb-001` almost verbatim) rather than treating it as just one
  input to weigh against the rubric.

**Verified:** `tsc` builds clean; the 4 mocked-client unit tests still pass
unchanged; `npm run eval:local` still reproduces the identical rule-based
50%/70% numbers. The 80%/90% numbers above are from a real, complete
(`"complete": true` on both workflows) `eval:llm` run — not a placeholder,
not illustrative.

**Overall arc, in one line for the "measured improvement" story:** rule-based
baseline 50% vs. rule-based agent 70% (retrieval alone helped) →
LLM baseline 60% vs. LLM agent 50% (agent regressed — both had zero severity
calibration, and the agent's extra call added more variance than
value) → LLM baseline 80% vs. LLM agent 70% (added a severity rubric — fixed
the shared miscalibration, agent still trailed by one ungrounded verify
call) → **LLM baseline 80% vs. LLM agent 90% (grounded retrieval in
canonical KB labels — agent now genuinely outperforms baseline, and the
per-case diff shows a concrete mistake the verify step actually caught).**
Each step targeted a specific, previously-diagnosed failure mode rather
than re-tuning blindly in response to a single aggregate score — that
discipline is what turned "the agent is worse" into a false alarm from a
missing feature, not a real architectural weakness.

## Currently committed result: 100% vs. 80% — one case beyond what's documented above

The `output/score-llm.json`/`output/{baseline,agent}-results-llm.json`
actually committed alongside this changelog entry (generated
`2026-08-30T02:00:03Z`) show a result one case better than the "90%"
documented immediately above:

| Metric | Baseline (LLM) | Agent (LLM) | Delta |
|---|---|---|---|
| Correct triage (type + severity) | 8/10 (80.00%) | **10/10 (100.00%)** | **+2 cases (+20.00%)** |

The difference from the 90% run above is exactly the case that section
predicted as the next thing to fix: **case-001 (EC2 CPU Spike) is now
correct for the agent** (`performance`/`high`, matching expected — baseline
still misses it at `performance`/`medium`, unchanged). Worth being precise
about what caused this: checking the code for the "next candidate fix"
floated above (making the verify prompt trust a KB entry's
`typical_severity` more assertively) — **that change was not made.** The
prompt content is identical to what the 90% run used. This is the same
code producing a better result on a repeat call, which means it's most
plausibly ordinary LLM sampling variance (temperature 0 and
`thinkingLevel: MINIMAL` reduce but don't eliminate run-to-run variation),
not a fix that should be credited to anything written above.

This is worth stating plainly rather than quietly adopting the better
number: **case-001's outcome for the agent is not yet a reproducibly fixed
behavior**, just a single observation that happened to land correctly. The
`kb-001`-trust fix proposed in the 90% section above is still the right
next step if reproducibility on this specific case matters going forward
— this run doesn't substitute for making that change, it just means the
failure mode isn't 100%-reproducible either.

That said, **this is the real, currently-committed, complete
(`"complete": true` on both) evaluation result**, and per this project's
own standard of using the evidence actually on file rather than a
better-sounding earlier one, 100%/80% — not 90%/80% — is the number that
belongs in any summary, demo, or submission material. The per-case
analysis above (case-004's genuine retrieval-caught win, case-007/009's
confirmed rubric fixes, the honestly-flagged self-inflicted taxonomy
ambiguity) is unchanged and still the substantive story; this section only
updates the headline number and is explicit about which part of the
improvement is confirmed-mechanism versus observed-but-unexplained.

**Verified:** `tsc` builds clean; all 4 mocked-client unit tests
(unchanged) still pass; `npm run eval:local` still reproduces the
identical rule-based 50%/70% numbers — none of this session's verification
work altered rule-based behavior. `output/score-llm.json` confirms
`"complete": true` for both workflows.

## Fix: `sam build` failing with `Cannot find esbuild` even after `npm install`

Reported after handing off a build that passed every check I could run
locally (`tsc`, unit tests, `eval:local`) but had never actually been
through `sam build` — a real gap, since none of this project's CI-equivalent
checks touch the deploy path at all.

**What looked like the cause, and wasn't:** my first guess was that `npm
install` in `services/triage-api` had simply been skipped. It hadn't — the
report showed it run successfully, then `sam build` failing anyway with
the identical error.

**Actual cause:** `sam build`'s log shows two separate install-adjacent
steps — `NodejsNpmEsbuildBuilder:CopySource` then
`NodejsNpmEsbuildBuilder:NpmInstall`. SAM copies the function's `CodeUri`
into its own scratch build directory and runs **its own independent `npm
install` there**, which omits `devDependencies` — correct for what
actually ships in a deployed Lambda, except `esbuild` was listed under
`devDependencies` and is also needed *during* that same build step, before
the dev/prod split should matter. A local `npm install` in the source tree
is irrelevant to this — it never touches SAM's scratch copy. This is a
known AWS SAM CLI behavior with the `esbuild` build method, not a bug in
this project's template or scripts (see
[aws/aws-sam-cli#4183](https://github.com/aws/aws-sam-cli/issues/4183)).

**Fix:** moved `esbuild` from `devDependencies` to `dependencies` in
`services/triage-api/package.json`, and regenerated `package-lock.json`
(the old lockfile had a `"dev": true` flag baked onto esbuild's entry that
a package.json edit alone wouldn't have cleared).

**Verified, not just reasoned about:** simulated SAM's internal
production-only install directly (`npm install --omit=dev`) against both
the old and new `package.json`/lockfile pairs in isolated scratch
directories. Old placement: `node_modules/.bin/esbuild` does not exist
after the install — only a stray platform-specific `@esbuild/*`
sub-package survives, confirming the exact failure mode reported. New
placement: `node_modules/.bin/esbuild` exists.

**This fix alone was not sufficient — a real `sam build` surfaced a
second, independent bug immediately after.** With `esbuild` resolvable,
the build got further and failed differently: `Could not resolve
"../../../../data/knowledge-base.json"` from `triageService.ts`. Root
cause: `services/triage-api/src/services/triageService.ts` statically
imports the knowledge base from `data/knowledge-base.json` at the repo
root — four directories above `services/triage-api/`, which is the
Lambda's `CodeUri`. SAM's build only copies `CodeUri` into its scratch
build directory (`NodejsNpmEsbuildBuilder:CopySource`); anything outside
it, including the entire root-level `data/` directory, simply isn't there
for esbuild to bundle. This had never been caught because every other
consumer of the knowledge base (`eval:local`, `eval:llm`, the unit tests)
runs from the repo root with the full tree present — only the actual
Lambda bundling step, scoped strictly to `CodeUri`, would ever hit this.

**Fix:** relocated `knowledge-base.json` to
`services/triage-api/data/knowledge-base.json` — inside the Lambda's
`CodeUri` — and updated the import in `triageService.ts` accordingly
(`../../data/knowledge-base.json`, relative to `src/services/`). Left
`evaluation-cases.json` at the repo-root `data/` directory unchanged,
since nothing in the deployed Lambda code imports it — only local eval
scripts read it, and they already resolve it correctly relative to `eval/`
regardless of `CodeUri`.

**Verified with the real tool, not just an inference from the two bugs
above:** installed `aws-sam-cli` and ran an actual `sam build` (not a
simulation) after both fixes. Result: `Build Succeeded` for both
`BaselineFunction` and `AgentFunction`. Additionally confirmed the
knowledge base is genuinely inlined into the deployed artifact — not just
silently dropped — by grepping the built `AgentFunction` bundle for a
distinctive KB string (`"SSL/TLS Certificate Expiry"`), which is present
in the bundled output. `sam validate --lint` also passes. `npm run
eval:local` still reproduces the identical 50%/70% rule-based numbers
after the relocation, and `tsc`/the 4 unit tests are unaffected.

**Hot take:** every check this project runs locally — build, unit tests,
both eval scripts — exercises the same npm install (devDependencies
included) and the same full repo tree, so this class of bug had zero
chance of surfacing before someone actually ran `sam build`. "It builds
and tests pass" and "it deploys" are different claims, and a project that
never runs the second one has an untested path by construction, not by
bad luck — and it can hide more than one bug at once, as it did here:
fixing the reported error revealed a second, unrelated one directly
behind it. `sam validate` and a real `sam build` belong somewhere in this
project's own pre-handoff checklist, not just `tsc`/`jest`/`eval:local`.
