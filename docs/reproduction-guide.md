# Reproduction Guide

This guide provides step-by-step instructions for reproducing the Cloud Triage Agent project in a fresh environment.

## Fastest path: local evaluation (no AWS required)

To reproduce the accuracy numbers in `docs/changelog.md` without deploying
anything:

```bash
git clone https://github.com/s-aduk/cloud-triage-agent.git
cd cloud-triage-agent
npm run eval:local
```

This installs `services/triage-api`'s dependencies, compiles it with the real
`tsc` build, and runs both handlers in-process against
`data/evaluation-cases.json`. Expect:

```
Baseline: 5/10 (50.00%)
Agent:    7/10 (70.00%)
Delta:    2 cases (20.00%)
```

Requires only Node.js 18+ and npm. Runtime: well under a minute; no AWS
credentials, no cost. Full results are written to `output/baseline-results.json`,
`output/agent-results.json`, and `output/score.json`.

To reproduce the same comparison against the real, deployed LLM logic
(Google Gemini) instead of the rule-based reference — no API Gateway/deployment
needed, just a free Gemini API key:

```bash
export GEMINI_API_KEY=<your-key>   # free, no credit card: https://aistudio.google.com/apikey
npm run eval:llm
```

This makes ~30 real model calls, using `gemini-3.5-flash-lite` by default —
all of this project's verified real-run results (see `docs/changelog.md`)
are against this model. `gemini-2.5-flash-lite` (the original default) is
still supported via `GEMINI_MODEL=gemini-2.5-flash-lite`, but proved
unreliable on the account this was tested with (a flat ~20/day cap, not
the ~1,000/day documented default; full `gemini-2.5-flash` was cut even
further, to as little as 20/day, in a December 2025 policy change).
If your daily quota doesn't cover all ~30 calls in one sitting, that's
fine — `eval/run-llm.js` is resumable: re-run the same command once your
quota resets and it will only retry cases that previously failed, not the
ones that already succeeded. See "Step 3b: Get a Gemini API key" below.

The steps below cover the full AWS deployment (SAM/Lambda/API Gateway) plus
the frontend, for anyone who wants to exercise the deployed API or the UI
rather than just the evaluation.

## Prerequisites

Before you begin, ensure you have the following installed:

1. **AWS CLI** - Version 2.x
   
   ```bash
   aws --version
   # Should show aws-cli/2.x.x
   ```

2. **AWS SAM CLI** - Version 1.x
   
   ```bash
   sam --version
   # Should show SAM CLI 1.x.x
   ```

3. **Node.js** - Version 18.x or later
   
   ```bash
   node --version
   # Should show v18.x.x or higher
   ```

4. **npm** - Version 9.x or later
   
   ```bash
   npm --version
   # Should show 9.x.x or higher
   ```

5. **Git** - Version 2.x or later
   
   ```bash
   git --version
   # Should show git version 2.x.x
   ```

## Step 1: Clone the Repository

```bash
# Clone the repository (replace with actual URL)
git clone https://github.com/s-aduk/cloud-triage-agent.git
cd cloud-triage-agent
```

## Step 2: Install Dependencies

### Backend Dependencies

```bash
cd services/triage-api
npm install
cd ../..
```

### Frontend Dependencies

```bash
cd apps/web
npm install
cd ../..
```

## Step 3: Configure AWS Credentials

Ensure your AWS CLI is configured with appropriate credentials:

```bash
aws configure
# Enter your AWS Access Key ID, Secret Access Key, region, and output format
```

## Step 3b: Get a Gemini API key

Both workflows call Google Gemini, so this step is required even for
`npm run eval:llm` (not just for deploying):

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with any Google account.
2. Click **Create API key** — no credit card required, no separate approval form.
3. Set it as an environment variable:
   ```bash
   export GEMINI_API_KEY=<your-key>
   ```

This project previously used Amazon Bedrock — see `docs/changelog.md` for
why it moved to Gemini (account-level AWS restrictions on a free-tier
account blocked model access, then a token-per-day quota, then most Bedrock
service quotas simply weren't provisioned for the account at all). Bedrock
support is still in the codebase (`services/triage-api/src/services/bedrockClient.ts`)
if you have working Bedrock access and want to switch back — swap the
import in `triageServiceLLM.ts` and restore the Bedrock IAM policy/parameter
in `template.yaml` (see git history for the previous version).

## Step 4: Build and Deploy

### Build the Application

```bash
sam build
```

### Deploy with Guided Prompts

```bash
sam deploy --guided
```

You will be prompted for:

1. **Stack Name**: Enter a unique name (e.g., cloud-triage-agent-dev)
2. **AWS Region**: Select your preferred region (e.g., us-east-1)
3. **Parameter Environment**: Enter `dev` (or your preferred environment)
4. **Parameter GeminiApiKey**: Paste the key from Step 3b
5. **Parameter GeminiModel**: Press enter to accept the default (`gemini-3.5-flash-lite`)
6. **Confirm changes before deploy**: Enter `Y`
7. **Allow SAM CLI IAM role creation**: Enter `Y`
8. **Save arguments to samconfig.toml**: Enter `Y` (note: this writes your API key into `samconfig.toml` in plain text — don't commit that file; for anything beyond local testing, use Secrets Manager or SSM Parameter Store instead of a plain CloudFormation parameter)

After deployment completes, note the output values, particularly:

- `TriageApiUrl` (base URL — the frontend appends `/baseline`/`/agent` itself)
- `TriageApiBaselineUrl` / `TriageApiAgentUrl` (full endpoint URLs, for direct curl testing)

## Step 5: Configure Frontend

Create a `.env.local` file in the `apps/web` directory:

```bash
cd apps/web
echo "NEXT_PUBLIC_API_URL=<your-api-url-from-deploy-output>" > .env.local
cd ../..
```

Replace `<your-api-url-from-deploy-output>` with the `TriageApiUrl` value (the base URL) from the SAM deployment output — the frontend code appends `/baseline` and `/agent` itself (see `apps/web/src/app/page.tsx`).

## Step 6: Run the Application

### Start the Frontend

```bash
cd apps/web
npm run dev
```

The frontend will be available at http://localhost:3000

### Test the API Endpoints Directly (Optional)

You can test the API endpoints using curl:

```bash
# Test baseline endpoint (use the TriageApiBaselineUrl output value directly)
curl -X POST $TRIAGE_API_BASELINE_URL \
  -H "Content-Type: application/json" \
  -d '{"description": "EC2 instance showing 95% CPU utilization for 15 minutes", "title": "EC2 CPU Spike"}'

# Test agent endpoint (use the TriageApiAgentUrl output value directly)
curl -X POST $TRIAGE_API_AGENT_URL \
  -H "Content-Type: application/json" \
  -d '{"description": "EC2 instance showing 95% CPU utilization for 15 minutes", "title": "EC2 CPU Spike"}'
```

## Step 7: Run Evaluation

To run the evaluation scripts, you'll need to set the API_URL environment variable:

```bash
# Set the API URL (use the same value as in .env.local)
export API_URL=<your-api-url-from-deploy-output>

# Run baseline evaluation
npm run eval:baseline

# Run agent evaluation
npm run eval:agent

# Run scoring
npm run eval:score

# Or run all steps
npm run eval
```

Results will be written to the `output/` directory:

- `baseline-results.json`
- `agent-results.json`
- `score.json`

## Step 8: Verify Results

Check the score.json file to see the comparison between baseline and agent performance:

```bash
cat output/score.json
```

You should see:

- Baseline accuracy percentage
- Agent accuracy percentage
- Improvement in accuracy
- Detailed results for each test case

## Troubleshooting

### Common Issues

1. **Deployment fails due to missing permissions**
   
   - Ensure your IAM user/role has permissions for CloudFormation, Lambda, API Gateway, etc.
   - Consider using administrator permissions for initial deployment (not recommended for production)

2. **Frontend cannot connect to API**
   
   - Verify the `NEXT_PUBLIC_API_URL` in `.env.local` matches the deployed API URL
   - Check that the API Gateway is deployed and accessible
   - Ensure CORS settings allow requests from your frontend origin

3. **Evaluation scripts fail**
   
   - Verify the `API_URL` environment variable is set correctly
   - Ensure the deployed API endpoints are functioning
   - Check network connectivity to the API Gateway

4. **"Cannot find module" errors**
   
   - Run `npm install` in the appropriate directories
   - Ensure you're in the correct directory when running commands

5. **`GEMINI_API_KEY is not set` error**

   - Set the environment variable before running (`export GEMINI_API_KEY=<your-key>`) — see Step 3b. For a deployed Lambda, this needs to be set as the `GeminiApiKey` SAM parameter at deploy time, not just in your local shell.

6. **Gemini call fails with a 429 / rate limit error**

   - **Per-minute** (recovers in under a minute): `geminiClient.ts` retries these automatically with backoff. If you still see one bubble up, you may be sharing quota with other usage on the same key — wait a minute and retry.
   - **Per-day** (`"quotaId":"...PerDay..."` in the error, or the error message says "Gemini daily quota exhausted"): this does not recover until midnight Pacific time, and `geminiClient.ts` deliberately does not retry it. Some free-tier accounts have a much lower daily cap than Google's documented default (this project measured a flat ~20 requests/day on one account, regardless of model) — if a full `eval:llm` run (needs ~30 calls) doesn't fit in your daily quota, that's fine: **`eval/run-llm.js` is resumable.** It skips any case that already has a successful result from a previous run and only spends quota on cases that are missing or previously failed. Just re-run `npm run eval:llm` again once your quota resets, as many times as it takes for both workflows to report `complete: true` in `output/score-llm.json`. Use `FORCE_RERUN=1 npm run eval:llm` if you actually want to ignore previous results and start over.

7. **Handler returns a 502 with a generic `400 INVALID_ARGUMENT`, no further detail**

   - Most likely cause: an incompatible `thinkingConfig` field for the configured model. Gemini 2.5-and-earlier models use `thinkingBudget` (a number); Gemini 3.x models use `thinkingLevel` (a string enum) instead and don't support full thinking-off, so sending the wrong one returns this exact generic error. `geminiClient.ts`'s `buildThinkingConfig()` already picks the right one by model-ID prefix — if you see this, check whether `GEMINI_MODEL` is set to something outside both the `gemini-2.5-*` and `gemini-3*` patterns it detects.

8. **Want to try a different Gemini model (e.g. to dodge an exhausted daily quota on your current one)**

   - Each model tracks its own separate daily quota, so switching models is a legitimate way to get a fresh budget for the day: `GEMINI_MODEL=gemini-3.5-flash-lite npm run eval:llm` (or any other valid Gemini model ID). The thinking-config handling above applies automatically regardless of which generation you pick.

9. **Handler returns a 502 with "Gemini returned no text"**

   - Usually means `maxOutputTokens` was too low for the schema, or the response was blocked by a safety filter. Check the Lambda/console logs for the `finishReason` in the error message for which one it is.

### Logs and Debugging

- **Lambda function logs**: Check CloudWatch Logs for the deployed Lambda functions
- **API Gateway logs**: Enable logging in API Gateway stage settings
- **Frontend errors**: Check browser console for React/JavaScript errors

## Clean Up Resources

To avoid ongoing charges, remember to delete the stack when you're finished:

```bash
sam delete
```

This will remove all AWS resources created by the SAM template.

## Additional Notes

- This project uses synthetic data only - no real AWS resources or data are accessed
- The knowledge base and evaluation cases are stored as JSON files for simplicity
- In a production implementation, you would likely use DynamoDB or S3 for the knowledge base
- Both the baseline and agent workflows call Google Gemini (see `services/triage-api/src/services/geminiClient.ts` and `triageServiceLLM.ts`). A rule-based reference implementation of both (`triageService.ts`) is kept for `npm run eval:local`, which needs no API key at all — see `docs/changelog.md` for why that comparison was worth keeping, and for why this project moved off Bedrock to Gemini.