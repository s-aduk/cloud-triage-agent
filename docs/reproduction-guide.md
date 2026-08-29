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
(Bedrock) instead of the rule-based reference — no API Gateway/deployment
needed, just AWS credentials with Bedrock access:

```bash
npm run eval:llm
```

See the "Bedrock setup" step below for the model-access prerequisite; this
makes ~30 real model calls and incurs a small cost.

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

## Step 3b: Enable Bedrock model access

Both workflows call Bedrock, so this step is required even for `npm run eval:llm` (not just for deploying):

1. In the AWS Console, go to **Bedrock -> Model access** in the region you plan to use.
2. Request/enable access to the Anthropic Claude model referenced by `template.yaml`'s `BedrockModelId` parameter (default: `us.anthropic.claude-haiku-4-5-20251001-v1:0`).
3. Confirm the inference profile ID is valid for your account/region:
   ```bash
   aws bedrock list-inference-profiles --region <your-region>
   ```
   If it's not listed, or you're in a different region, update `BedrockModelId` in `template.yaml` (for deployment) or set the `BEDROCK_MODEL_ID` environment variable (for `npm run eval:llm`) to a valid inference profile ID for your account.

Without this step, calls fail with `AccessDeniedException` even with correct IAM permissions — this is a Bedrock console setting, not an IAM policy.

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
4. **Confirm changes before deploy**: Enter `Y`
5. **Allow SAM CLI IAM role creation**: Enter `Y`
6. **Save arguments to samconfig.toml**: Enter `Y`

After deployment completes, note the output values, particularly:

- `TriageApiBaselineUrl`
- `TriageApiAgentUrl`

## Step 5: Configure Frontend

Create a `.env.local` file in the `apps/web` directory:

```bash
cd apps/web
echo "NEXT_PUBLIC_API_URL=<your-api-url-from-deploy-output>" > .env.local
cd ../..
```

Replace `<your-api-url-from-deploy-output>` with the `TriageApiBaselineUrl` value from the SAM deployment output (or point the frontend at whichever endpoint it's built to call — check `apps/web` for which one it expects).

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

5. **`AccessDeniedException` calling Bedrock**

   - Model access has to be enabled per-region in the Bedrock console (Model access -> Anthropic) — this is separate from IAM permissions, and the IAM policy in `template.yaml` alone won't fix it. See Step 3b above.

6. **`ValidationException: ... with on-demand throughput isn't supported`**

   - You're using a bare model ID instead of an inference profile ID. Current-generation Claude models on Bedrock require a region-prefixed inference profile ID (e.g. `us.anthropic....`), not the bare `anthropic....` model ID. Check `BedrockModelId` in `template.yaml` / `BEDROCK_MODEL_ID` env var.

7. **Bedrock call succeeds but the handler returns a 502 with "Bedrock did not return a tool_use block"**

   - Usually means the configured model doesn't support forced tool-use the way `bedrockClient.ts` expects it to, or the inference profile ID is valid but points to the wrong region for your account. Try the request with the AWS CLI (`aws bedrock-runtime converse ...`) directly to isolate whether it's the model/region or the application code.

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
- Both the baseline and agent workflows call Amazon Bedrock (see `services/triage-api/src/services/bedrockClient.ts` and `triageServiceLLM.ts`). A rule-based reference implementation of both (`triageService.ts`) is kept for `npm run eval:local`, which needs no AWS credentials — see `docs/changelog.md` for why that comparison was worth keeping.