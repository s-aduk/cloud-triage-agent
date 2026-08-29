# Cloud Triage Agent

A hackathon-ready project that helps small engineering teams triage cloud incidents faster by providing structured analysis of raw incident inputs. Includes both a baseline (single Bedrock call) and agent (multi-step with retrieval + verification, also Bedrock-backed) workflow for comparison. A rule-based reference implementation of both is also kept for a fast, free, no-AWS-credentials sanity check — see `docs/changelog.md` for why that comparison mattered before the LLM was wired in.

## Who this is for

Small engineering teams, startup developers, and solo AWS builders who receive noisy alerts, raw logs, and incident notes and need a fast first-pass triage.

## The problem

Cloud incidents usually arrive with poor context. Engineers must manually inspect logs, infer severity, identify the likely cause, and decide what to do next. That slows down response and makes triage inconsistent.

## Baseline vs Agent

- **Baseline**: A single Bedrock call with a fixed prompt — no tools, no retrieval, no verification.
- **Agent**: Multi-step workflow — classifies the incident (Bedrock), retrieves relevant knowledge base entries (local similarity search), then verifies the classification against that evidence (Bedrock, with authority to override the initial guess), and returns a structured triage report.

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
│   ├── evaluation-cases.json     # Test cases for evaluation
│   └── knowledge-base.json       # Knowledge base for agent retrieval
├── services/
│   └── triage-api/               # Lambda backend
│       └── src/                  # Source code
│           ├── handlers/         # Lambda handlers (baseline.ts, agent.ts)
│           └── services/         # Shared triage logic
│               ├── bedrockClient.ts     # Bedrock Converse API wrapper (forced tool-use JSON)
│               ├── triageService.ts     # Types, KB retrieval, rule-based reference impl
│               └── triageServiceLLM.ts  # Bedrock-backed baseline + agent workflows
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
- **Bedrock model access enabled** for the model in `template.yaml`'s `BedrockModelId` parameter (default: `us.anthropic.claude-haiku-4-5-20251001-v1:0`) — in the Bedrock console, under Model access, request/enable access for Anthropic models in your target region. Requests fail with `AccessDeniedException` until this is done, even with correct IAM permissions.

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

**LLM (Bedrock) evaluation — requires AWS credentials + Bedrock model access, incurs a small cost:**

```bash
npm run eval:llm
```

Builds and runs the actual deployed handlers (`baseline.ts`, `agent.ts`),
which call Bedrock. Makes 10 baseline calls + 20 agent calls (classify +
verify per case) — roughly 30 real model invocations total. Results are
written to `output/baseline-results-llm.json`, `output/agent-results-llm.json`,
and `output/score-llm.json`. See `docs/changelog.md` for how these numbers
compare to the rule-based reference once you've run it.

Once deployed to AWS, `npm run eval:baseline` / `eval:agent` / `eval:score`
run the same comparison against the live API Gateway endpoints instead
(requires `API_URL` to be set — see the reproduction guide).

## Development

### Backend (Lambda)
The backend is located in `services/triage-api/src/`.
- `handlers/baseline.ts` - Deployed handler (`BaselineHandler`, Bedrock-backed) + rule-based reference (`BaselineHandlerRuleBased`, used by `eval:local` only)
- `handlers/agent.ts` - Deployed handler (`AgentHandler`, Bedrock-backed) + rule-based reference (`AgentHandlerRuleBased`, used by `eval:local` only)
- `services/bedrockClient.ts` - Bedrock Converse API wrapper; forces tool-use so responses are always structured JSON matching a schema, never free text to parse
- `services/triageServiceLLM.ts` - `baselineTriageLLM` (single call) and `agentTriageLLM` (classify → retrieve → verify, verify can override classify)
- `services/triageService.ts` - Shared types, knowledge base loading/retrieval, and the rule-based reference implementations
- `services/__tests__/triageServiceLLM.test.ts` - Jest tests with a mocked Bedrock client, including a regression test pinning that verification can override a wrong initial classification

Run these with `npm run test:api` from the repo root (no AWS credentials needed — the Bedrock client is mocked).

### Frontend (Next.js)
The frontend is in `apps/web/`:
- `src/app/page.tsx` - Main page with triage form
- `src/components/TriageForm.tsx` - Input form component
- `src/components/TriageResult.tsx` - Results display component

### Data
- `data/evaluation-cases.json` - 10+ synthetic test cases
- `data/knowledge-base.json` - Knowledge base for agent retrieval

## Licensing

This project is licensed under the MIT License.

## Acknowledgments

Built with AWS SAM, Lambda, API Gateway, and Next.js for the frontend.