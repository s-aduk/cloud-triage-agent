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
4. Show the baseline workflow results:
   - Incident Type: performance
   - Severity: high
   - Probable Cause: high CPU utilization
   - Evidence: [list items]
   - Next Action: investigate CPU usage and consider scaling
   - Confidence: 70%
5. Explain that this is a simple keyword-based approach

### Part 3: Agent Workflow Demonstration (3 minutes)
1. Show the agent workflow results for the same input:
   - Incident Type: performance
   - Severity: high
   - Probable Cause: sudden traffic increase or infinite loop in application code
   - Evidence: [list items from KB]
   - Next Action: scale EC2 instance or investigate application code for infinite loops
   - Confidence: 85%
2. Highlight the improvements:
   - More specific probable cause
   - Better evidence from knowledge base
   - More actionable next steps
   - Higher confidence score

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
1. Show the evaluation results from running `npm run eval`
2. Display the score.json file showing:
   - Baseline accuracy: X%
   - Agent accuracy: Y%
   - Improvement: Z%
3. Explain that the agent consistently outperforms the baseline

### Part 6: Technical Deep Dive (Optional, 3 minutes)
For technical audiences:
- Show the agent workflow steps: classify → retrieve → verify → summarize
- Point to the relevant code in `services/triage-api/src/services/triageService.ts`
- Mention how this could be extended with LLMs (Amazon Bedrock) in production
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