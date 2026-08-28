# Cloud Triage Agent

A hackathon-ready project that helps small engineering teams triage cloud incidents faster by providing structured analysis of raw incident inputs. Includes both a baseline (simple one-prompt) and agent (multi-step with retrieval/verification) workflow for comparison.

## Who this is for

Small engineering teams, startup developers, and solo AWS builders who receive noisy alerts, raw logs, and incident notes and need a fast first-pass triage.

## The problem

Cloud incidents usually arrive with poor context. Engineers must manually inspect logs, infer severity, identify the likely cause, and decide what to do next. That slows down response and makes triage inconsistent.

## Baseline vs Agent

- **Baseline**: Single prompt that summarizes the incident without tools or verification.
- **Agent**: Multi-step workflow that classifies the incident, retrieves context, verifies the conclusion, and returns a structured triage report.

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
│       ├── template.yaml         # SAM template for API service
│       └── src/                  # Source code
│           ├── handlers/         # Lambda handlers
│           └── services/         # Shared triage logic
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
After deployment, note the API URL from the outputs (look for `TriageApiUrl`). Then:

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

Fastest path — no AWS deployment needed:

```bash
npm run eval:local
```

This builds the Lambda handlers with `tsc` and runs both workflows in-process
against `data/evaluation-cases.json`. Current verified result: baseline
5/10 (50.00%), agent 7/10 (70.00%) — see `docs/changelog.md` for the
per-case breakdown, including a regression the agent has on one case.

Results are written to `output/baseline-results.json`, `output/agent-results.json`,
and `output/score.json`.

Once deployed to AWS, `npm run eval:baseline` / `eval:agent` / `eval:score`
run the same comparison against the live API Gateway endpoints instead
(requires `API_URL` to be set — see the reproduction guide).

## Development

### Backend (Lambda)
The backend is located in `services/triage-api/src/`. 
- `handlers/baseline.ts` - Simple one-prompt triage
- `handlers/agent.ts` - Enhanced triage with classify→retrieve→verify→summarize
- `services/triageService.ts` - Shared logic and utilities

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