# Cloud Triage Agent

A hackathon-ready project that helps small engineering teams triage cloud incidents faster by providing structured analysis of raw incident inputs. Includes both a baseline (single Gemini call) and agent (multi-step with retrieval + verification, also Gemini-backed) workflow for comparison. A rule-based reference implementation of both is also kept for a fast, free, no-API-key sanity check — see `docs/changelog.md` for why that comparison mattered before the LLM was wired in, and for why this project moved from Amazon Bedrock to Google Gemini.

## Who this is for

Small engineering teams, startup developers, and solo AWS builders who receive noisy alerts, raw logs, and incident notes and need a fast first-pass triage.

## The problem

Cloud incidents usually arrive with poor context. Engineers must manually inspect logs, infer severity, identify the likely cause, and decide what to do next. That slows down response and makes triage inconsistent.

## Baseline vs Agent

- **Baseline**: A single Gemini call with a fixed prompt — no tools, no retrieval, no verification.
- **Agent**: Multi-step workflow — classifies the incident (Gemini), retrieves relevant knowledge base entries (local similarity search), then verifies the classification against that evidence (Gemini, with authority to override the initial guess), and returns a structured triage report.

## Features

- **Baseline Workflow**: Simple one-prompt triage for quick incident assessment
- **Agent Workflow**: Enhanced triage with classification, context retrieval, verification, and summarization
- **Synthetic Evaluation**: 10+ test cases for measuring workflow effectiveness
- **Frontend UI**: Simple React interface for interacting with the triage agent
- **AWS SAM Deployment**: Easy deployment to AWS Lambda and API Gateway
- **Evaluation Scripts**: Automated scoring and comparison of baseline vs agent performance

## Project Structure

```
cloud-triage-agent/
├── template.yaml                 # AWS SAM template
├── README.md                     # This file
├── data/                         # Synthetic data
│   └── evaluation-cases.json     # Test cases for evaluation
├── services/
│   └── triage-api/               # Lambda backend
│       ├── data/
│       │   └── knowledge-base.json  # Knowledge base for agent retrieval (must live inside CodeUri for esbuild bundling — see docs/changelog.md)
│       └── src/                  # Source code
│           ├── handlers/         # Lambda handlers (baseline.ts, agent.ts)
│           └── services/         # Shared triage logic
│               ├── geminiClient.ts      # Gemini structured-output wrapper (active provider)
│               ├── bedrockClient.ts     # Bedrock Converse API wrapper (alternate provider, not currently used — see docs/changelog.md)
│               ├── triageService.ts     # Types, KB retrieval, rule-based reference impl
│               └── triageServiceLLM.ts  # LLM-backed baseline + agent workflows (provider-agnostic)
├── eval/                         # Evaluation scripts
│   ├── run-baseline.ts           # Baseline evaluation
│   ├── run-agent.ts              # Agent evaluation
│   └── score.ts                  # Scoring script
├── docs/                         # Documentation
│   ├── changelog.md              # Improvement journey
│   ├── reproduction-guide.md     # Setup instructions
│   └── demo-script.md            # Demo execution guide
├── apps/
│   └── web/                      # Next.js frontend
│       ├── package.json
│       └── src/
│           ├── app/
│           └── components/
└── output/                       # Evaluation results
```

## Prerequisites

- [AWS CLI](https://aws.amazon.com/cli/) installed and configured
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) installed
- [Node.js](https://nodejs.org/) (v18 or later) and npm
- [Git](https://git-scm.com/)
- **A free Gemini API key** — get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (no credit card, no approval form). This project previously used Amazon Bedrock; see `docs/changelog.md` for why it moved to Gemini.

## Setup and Deployment

### 1. Clone the repository
```bash
git clone <repository-url>
cd cloud-triage-agent
```

### 2. Install dependencies
```bash
# Install frontend dependencies
cd apps/web
npm install
cd ../..

# Install backend dependencies (if any)
cd services/triage-api
npm install
cd ../..
```

### 3. Build and deploy with AWS SAM
```bash
# Build the application
sam build

# Deploy (follow prompts for stack name, region, etc.)
sam deploy --guided
```

### 4. Configure frontend
After deployment, note the endpoint URLs from the stack outputs (`TriageApiBaselineUrl` and `TriageApiAgentUrl`). Then:

```bash
# In apps/web/.env.local
NEXT_PUBLIC_API_URL=<your-api-url-from-sam-deploy-output>
```

### 5. Run the frontend
```bash
cd apps/web
npm run dev
```

The frontend will be available at http://localhost:3000

## Evaluation
Primary metric: correct triage outcome rate (incident type and severity).

**Rule-based reference comparison — free, no AWS credentials needed:**

```bash
npm run eval:local
```

Builds the rule-based reference handlers and runs both workflows in-process
against `data/evaluation-cases.json`. Verified result: baseline 5/10
(50.00%), agent 7/10 (70.00%). This is the comparison documented in the
first half of `docs/changelog.md`, kept as a fast sanity check — it is not
what's deployed.

**LLM (Gemini) evaluation — requires a free Gemini API key, no cost:**

```bash
export GEMINI_API_KEY=<your-key>   # free: https://aistudio.google.com/apikey
npm run eval:llm
```

Builds and runs the actual deployed handlers (`baseline.ts`, `agent.ts`),
which call Gemini. Makes 10 baseline calls + 20 agent calls (classify +
verify per case) — roughly 30 real model invocations total, well within
Gemini's free tier. Results are written to `output/baseline-results-llm.json`,
`output/agent-results-llm.json`, and `output/score-llm.json`. See `docs/changelog.md`
for how these numbers compare to the rule-based reference once you've run it,
and for why this project moved from Bedrock to Gemini.

Once deployed to AWS, `npm run eval:baseline` / `eval:agent` / `eval:score`
run the same comparison against the live API Gateway endpoints instead
(requires `API_URL` to be set — see the reproduction guide).

## Agent trajectories

Representative execution traces (prompts, tool/retrieval responses, and
whether verification overrode an earlier guess) for both workflows:

```bash
npm run trajectories
```

Writes to `docs/trajectories/` — see `docs/trajectories/README.md` for what's
a real capture vs. the current illustrative example (mocked, pending a real
`GEMINI_API_KEY` run — see `docs/changelog.md`).

## Development

### Backend (Lambda)
The backend is located in `services/triage-api/src/`.
- `handlers/baseline.ts` - Deployed handler (`BaselineHandler`, Gemini-backed) + rule-based reference (`BaselineHandlerRuleBased`, used by `eval:local` only)
- `handlers/agent.ts` - Deployed handler (`AgentHandler`, Gemini-backed) + rule-based reference (`AgentHandlerRuleBased`, used by `eval:local` only)
- `services/geminiClient.ts` - Gemini structured-output wrapper (active provider); forces JSON via `responseMimeType`/`responseSchema`, never free text to parse
- `services/bedrockClient.ts` - Bedrock Converse API wrapper (alternate provider, not currently imported — see `docs/changelog.md`)
- `services/triageServiceLLM.ts` - `baselineTriageLLM` (single call) and `agentTriageLLM` (classify → retrieve → verify, verify can override classify) — provider-agnostic
- `services/triageService.ts` - Shared types, knowledge base loading/retrieval, and the rule-based reference implementations
- `services/__tests__/triageServiceLLM.test.ts` - Jest tests with a mocked LLM client, including a regression test pinning that verification can override a wrong initial classification

Run these with `npm run test:api` from the repo root (no API key needed — the LLM client is mocked).

### Frontend (Next.js)
The frontend is in `apps/web/`:
- `src/app/page.tsx` - Main page with triage form
- `src/components/TriageForm.tsx` - Input form component
- `src/components/TriageResult.tsx` - Results display component

### Data
- `data/evaluation-cases.json` - 10+ synthetic test cases
- `services/triage-api/data/knowledge-base.json` - Knowledge base for agent retrieval, with a canonical `incident_type`/`typical_severity` per entry used to ground the agent's verify step (see `docs/changelog.md`). Lives inside the Lambda's `CodeUri`, not the repo-root `data/` directory, because `esbuild` needs to resolve and inline it at build time — see `docs/changelog.md` for the `sam build` failure this fixes.

## Measured Improvement

Full case-by-case evidence and the iteration history are in
`docs/changelog.md`. Currently committed numbers, from a real (non-mocked,
non-illustrative), complete (`"complete": true`) `npm run eval:llm` run
against `gemini-3.5-flash-lite`:

| Metric | Simple baseline | Agent | Change |
|---|---|---|---|
| Correct triage (type + severity), rule-based (`eval:local`) | 5/10 (50%) | 7/10 (70%) | +2 cases |
| Correct triage (type + severity), Gemini-backed (`eval:llm`) | 8/10 (80%) | 10/10 (100%) | +2 cases |

The agent's clearest confirmed win over the baseline (case-004, Lambda
Throttling) is a genuine case of verification catching a classification
mistake: the baseline's single blind call misread it as
`resource-exhaustion`; the agent's classify step made the identical
mistake, but the verify step, grounded in the knowledge base's canonical
label for that failure pattern, corrected it before it reached the output.
See `docs/changelog.md` for why the agent's other point of improvement
over an earlier 90% run (case-001) is flagged there as an unreproduced
observation, not a confirmed fix — the same code produced both results,
so that specific case's outcome may vary run to run.

## Main Failure Mode & Hot Take

**Main failure mode still open (baseline only):** case-001 (EC2 CPU Spike
— sustained 95% CPU, 5x latency increase) is misclassified as `medium`
severity instead of `high` by the baseline on the current run. The agent
gets this case right, but per `docs/changelog.md` that specific outcome
isn't a confirmed, reproducible fix — no code change explains it, so it's
flagged as an unreproduced observation rather than something to rely on.
The underlying issue for the baseline (and potentially the agent, on a
different run) is a prompt/rubric calibration problem rather than a
retrieval-coverage problem — the matching knowledge base entry exists,
but isn't consistently trusted assertively enough by the verify step when
its `typical_severity` and the incident's own symptoms line up closely.
See `docs/changelog.md`'s final section for the specific next fix this
points to.

**Hot take:** the most useful debugging signal in this project wasn't any
single accuracy number — it was noticing that two consecutive "the agent
regressed" results shared the same *shape* (baseline and agent agreeing on
9 of 10 cases, with a different single case flipping each time) rather
than treating each regression as a fresh, unrelated mystery. A repeating
pattern with a different specific failure each time is a sign something
structural is missing — in this case, that the agent's retrieval step was
returning descriptive text with no canonical label attached, so its
"verification" had nothing more authoritative to check against than its
own second guess. The fix that actually closed the gap wasn't tuning a
prompt harder in response to whichever case failed most recently; it was
giving the agent's supposed advantage (retrieval) something real to be an
advantage with. A retrieval step that returns context without grounding
isn't meaningfully different from re-asking the same question twice.

## Licensing

This project is licensed under the MIT License.

## Acknowledgments

Built with AWS SAM, Lambda, API Gateway, and Next.js for the frontend.