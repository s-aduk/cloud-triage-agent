# ILLUSTRATIVE — Baseline trajectory — Cost Anomaly (case-010)

> **This is a mocked example, not a real Bedrock run.** It demonstrates the trajectory format and the classify -> retrieve -> verify -> override mechanism using scripted responses, generated the same way as `services/triage-api/src/services/__tests__/triageServiceLLM.test.ts`. Real trajectories (from actual Bedrock calls) should replace this file once Bedrock account access is provisioned — run `npm run trajectories`. See docs/changelog.md for why this project holds a hard line against presenting unverified numbers as real ones; the same standard applies here, hence this banner.

**Input:**

- Title: Cost Anomaly
- Description: AWS Cost Explorer shows Lambda costs increased 300% day-over-day. No traffic increase observed. Same number of invocations but longer duration.

**Expected (from data/evaluation-cases.json):** {"incidentType":"cost-anomaly","severity":"medium"}

---

## Step 1: single_call

Single prompt, no tools besides the required output schema, no retrieval, no verification.

**System prompt:**
```
You are a cloud infrastructure incident triage assistant. Given a raw incident description, classify it. Use only the incidentType and severity values defined in the tool schema. Be decisive: pick the single best category even if the description is ambiguous.
```

**User prompt:**
```
Incident title: Cost Anomaly
Incident description: AWS Cost Explorer shows Lambda costs increased 300% day-over-day. No traffic increase observed. Same number of invocations but longer duration.

Classify this incident and provide a full triage report.
```

**Output (mocked):**
```json
{
  "incidentType": "throttling",
  "severity": "medium",
  "probableCause": "Lambda throttling due to increased invocation duration",
  "evidence": [
    "\"Lambda\" and duration increase mentioned in description"
  ],
  "nextAction": "Check Lambda concurrency limits and throttling metrics in CloudWatch",
  "confidence": 0.55
}
```

---

## Final result (mocked)

```json
{
  "incidentType": "throttling",
  "severity": "medium",
  "probableCause": "Lambda throttling due to increased invocation duration",
  "evidence": [
    "\"Lambda\" and duration increase mentioned in description"
  ],
  "nextAction": "Check Lambda concurrency limits and throttling metrics in CloudWatch",
  "confidence": 0.55
}
```

**Matched expected classification:** no
