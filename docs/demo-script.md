# Demo Script

This script provides a step-by-step guide for demonstrating the Cloud Triage Agent during presentations or hackathon submissions.

## Overview

The demo showcases how the Cloud Triage Agent helps engineering teams triage cloud incidents faster by:
1. Accepting raw incident descriptions
2. Processing them through both baseline and agent workflows
3. Comparing the results to show the value of the enhanced agent approach
4. Providing actionable insights for incident response

## Demo Flow

### Part 1: Introduction (2 minutes)
- Explain the problem: engineers receive noisy alerts and need fast triage
- Introduce the Cloud Triage Agent solution
- Show the project architecture diagram (if available)

### Part 2: Baseline Workflow Demonstration (3 minutes)
1. Navigate to the deployed frontend (http://localhost:3000)
2. Enter a sample incident description:
   ```
   Title: EC2 CPU Spike
   Description: EC2 instance i-0a1b2c3d4e5f6g7h8 showing 95% CPU utilization for 15 minutes. CloudWatch alarm triggered. Application response times increased from 200ms to 2s. No recent deployments.
   ```
3. Click "Analyze Incident"
4. Show the baseline workflow results (a single Gemini call, no tools, no retrieval, no verification — see `services/triage-api/src/services/triageServiceLLM.ts`'s `baselineTriageLLM`)
5. Explain that this is the "one direct prompt with basic instructions" baseline — same underlying model as the agent, so any improvement the agent shows comes from retrieval + verification, not a bigger model

### Part 3: Agent Workflow Demonstration (3 minutes)
1. Show the agent workflow results for the same input — classify → retrieve (local KB similarity search) → verify (Gemini, with authority to override the initial guess) → summarize
2. Highlight the improvements over baseline:
   - Evidence grounded in the knowledge base, not just the raw description
   - More actionable next steps
   - Higher confidence score
3. **This is the strongest part of the demo:** pull up `docs/changelog.md`'s case-010 (Cost Anomaly) writeup — the rule-based agent actually got this one *wrong* (a keyword tie-break picked "throttling" from the word "Lambda"), and the verification step's job in the LLM version is specifically to catch and correct exactly that kind of mistake by weighing retrieved evidence over an early guess. Then pull up the follow-on "Real LLM run" section: the incidentType override does now fire correctly on case-010 (both baseline and agent correctly land on `cost-anomaly`) — the remaining gap on that case is a severity call, not a classification miss, and it's addressed by the severity rubric documented right after it.

### Part 4: Comparison of Multiple Cases (4 minutes)
Demonstrate with 2-3 different incident types to show versatility:

#### Case 2: Security Incident
```
Title: S3 Bucket Public Access
Description: AWS Config rule flagged S3 bucket 'company-backups-2024' as publicly accessible. Bucket contains customer PII data. No IAM policy changes in last 24 hours.
```
- Baseline: Might miss severity or misclassify
- Agent: Correctly identifies as security/critical with proper evidence

#### Case 3: Mixed Signals (Optional)
```
Title: Mixed Signals - Deploy and Error
Description: Deploy finished 10 minutes ago to ECS service web-frontend. Error rate increased from 0.1% to 5%. CPU normal at 40%. Memory usage increased from 60% to 85%.
```
- Shows agent's ability to handle complex scenarios
- Baseline might focus on just one aspect
- Agent considers multiple factors

### Part 5: Evaluation Results (2 minutes)
1. Show the rule-based reference comparison first (`npm run eval:local` — free, instant, no API key needed): baseline 50%, agent 70% — see `docs/changelog.md` for the per-case breakdown and the case-010 regression.
2. Show the real Gemini-backed numbers from `npm run eval:llm` (`output/score-llm.json`): **baseline 80%, agent 100%** — the agent genuinely outperforms the baseline. Walk through the case that reliably decides it: case-004 (Lambda Throttling), where the baseline's blind classify call misread it as `resource-exhaustion` and the agent's verify step, grounded in the knowledge base's canonical `throttling` label for that pattern, caught and corrected the same initial mistake. That's retrieval doing its actual job — not just adding text to reason over, but supplying an authoritative label that overrides a concrete error. Note per `docs/changelog.md` that the extra point over an earlier 90% run (case-001) hasn't been confirmed as a reproducible fix — say so if asked, rather than overclaiming.
3. Explain the fair-comparison setup: baseline and agent use the same model, same schema, same evaluation cases — the only difference is retrieval + verification.
4. Walk the arc in `docs/changelog.md`'s "Confirmed run" section: three iterations, each fixing a specific diagnosed cause (severity calibration, then retrieval grounding) rather than re-tuning blind — that's the actual improvement story, more than any single score.
5. Be honest about the one open failure mode: case-001 (EC2 CPU Spike) is still wrong in both workflows — a good moment to show the changelog's "Hot Take" section rather than hide it.

### Part 6: Technical Deep Dive (Optional, 3 minutes)
For technical audiences:
- Show the agent workflow steps: classify → retrieve → verify → summarize (`services/triage-api/src/services/triageServiceLLM.ts`)
- Point out the verification step is explicitly instructed that it may override the initial classification when retrieved evidence disagrees — walk through why (the case-010 regression this fixes)
- Mention the provider swap: `bedrockClient.ts` and `geminiClient.ts` implement the same `invokeStructured()` interface, so the actual agent logic in `triageServiceLLM.ts` doesn't know or care which LLM provider is behind it — worth a sentence on why (this project started on Amazon Bedrock, hit account-level AWS restrictions on a free-tier account — model access gates, then a token-per-day quota, then most Bedrock service quotas simply not provisioned — and switched to Google Gemini's free tier to get real numbers; see `docs/changelog.md`)
- Show the agent trajectories in `docs/trajectories/` — prompts, tool responses, and the override mechanism in action
- Show the SAM template and deployment simplicity

### Part 7: Closing (1 minute)
- Recap the value proposition
- Mention next steps for production use
- Invite questions

## Tips for Effective Demo

1. **Prepare your environment**: Have the frontend running and API deployed beforehand
2. **Use realistic examples**: Choose incidents that are relatable to your audience
3. **Explain the difference**: Clearly articulate why the agent output is better
4. **Keep it flowing**: Move smoothly between sections
5. **Have backup cases**: Prepare 3-4 different incident types in case one doesn't work well
6. **Focus on outcomes**: Emphasize how this helps engineers respond faster
7. **Be ready to discuss limitations**: Acknowledge this is a MVP and discuss production enhancements

## Sample Incident Cases for Demo

Keep these handy for quick switching during the demo:

1. **High CPU**: EC2 instance showing 95% CPU utilization for 15 minutes
2. **Public S3 Bucket**: S3 bucket flagged as publicly accessible containing PII
3. **Database Connections**: RDS showing 98% connection usage with application errors
4. **Lambda Throttling**: Lambda function getting 429 errors at concurrency limit
5. **API Gateway Timeout**: 504 errors and latency increased from 300ms to 12s
6. **Deployment Issue**: Recent deploy correlating with error rate increase
7. **Certificate Expiry**: SSL certificate expired causing handshake failures
8. **Cost Anomaly**: 300% increase in Lambda costs without traffic increase

## Measuring Success

A successful demo will leave the audience understanding:
- The problem of slow incident triage
- How the Cloud Triage Agent provides faster, more accurate assessments
- The tangible difference between baseline and agent approaches
- The potential for this tool to improve their incident response process