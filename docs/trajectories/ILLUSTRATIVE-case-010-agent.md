# ILLUSTRATIVE — Agent trajectory — Cost Anomaly (case-010)

> **This is a mocked example, not a real Gemini run.** It demonstrates the trajectory format and the classify -> retrieve -> verify -> override mechanism using scripted responses, generated the same way as `services/triage-api/src/services/__tests__/triageServiceLLM.test.ts`. Real trajectories (from actual Gemini calls) should replace this file once a real GEMINI_API_KEY is used — run `npm run trajectories`. See docs/changelog.md for why this project holds a hard line against presenting unverified numbers as real ones; the same standard applies here, hence this banner.

**Input:**

- Title: Cost Anomaly
- Description: AWS Cost Explorer shows Lambda costs increased 300% day-over-day. No traffic increase observed. Same number of invocations but longer duration.

**Expected (from data/evaluation-cases.json):** {"incidentType":"cost-anomaly","severity":"medium"}

---

## Step 1: classify

First-pass classification from the raw incident description alone, no knowledge base access yet.

**System prompt:**
```
You are a cloud infrastructure incident triage assistant. Given a raw incident description, classify it. Use only the incidentType and severity values defined in the tool schema. Be decisive: pick the single best category even if the description is ambiguous.
```

**User prompt:**
```
Incident title: Cost Anomaly
Incident description: AWS Cost Explorer shows Lambda costs increased 300% day-over-day. No traffic increase observed. Same number of invocations but longer duration.
```

**Output (mocked):**
```json
{
  "incidentType": "throttling",
  "severity": "medium",
  "probableCause": "Lambda throttling suspected",
  "confidence": 0.5
}
```

## Step 2: retrieve

Local similarity search over 10 knowledge base entries (not an LLM call).

**Input:**
```json
{
  "description": "AWS Cost Explorer shows Lambda costs increased 300% day-over-day. No traffic increase observed. Same number of invocations but longer duration.",
  "knowledgeBaseSize": 10
}
```

**Output (mocked):**
```json
{
  "retrievedCount": 3,
  "retrievedTitles": [
    "Unexpected Cost Increases",
    "Lambda Function Throttling",
    "EC2 High CPU Utilization"
  ]
}
```

## Step 3: verify

Verification OVERRODE the initial classification (throttling -> cost-anomaly) based on retrieved evidence.

**System prompt:**
```
You are the verification step of a cloud incident triage agent. Your job is to catch and correct mistakes from an earlier, less-informed classification step by weighing retrieved evidence honestly — you have the authority to change the classification, not just comment on it.
```

**User prompt:**
```
Incident title: Cost Anomaly
Incident description: AWS Cost Explorer shows Lambda costs increased 300% day-over-day. No traffic increase observed. Same number of invocations but longer duration.

Initial classification (from a first-pass read, before seeing the knowledge base):
- incidentType: throttling
- severity: medium
- probableCause: Lambda throttling suspected
- confidence: 0.5

Retrieved knowledge base entries (ranked by similarity to the description):
KB entry 1 - "Unexpected Cost Increases"
  Symptoms: cost anomalies in Cost Explorer; usage spikes without traffic increase; budget alarms
  Common causes: increasing resource utilization; inefficient code loops; data transfer costs; unused resources left running
  Resolution actions: right-size over-provisioned resources; identify and fix inefficient code; terminate unused resources; optimize data transfer/storage

KB entry 2 - "Lambda Function Throttling"
  Symptoms: 429 errors; increased duration; concurrent executions at limit
  Common causes: traffic spike exceeding concurrency limits; long-running executions; burst traffic patterns
  Resolution actions: increase reserved concurrency; optimize function duration; implement buffering with SQS/Kinesis; consider provisioned concurrency

KB entry 3 - "EC2 High CPU Utilization"
  Symptoms: CPU > 90%; increased response time; CloudWatch alarm
  Common causes: sudden traffic spike; infinite loop; inefficient algorithm; missing index
  Resolution actions: scale instance vertically/horizontally; optimize application code; add database indexing; implement caching

Review the initial classification against the retrieved knowledge base entries and the incident description.
If the knowledge base evidence contradicts the initial classification, CHANGE incidentType, severity, and/or
probableCause to match the evidence rather than keeping the initial guess — do not just lower confidence while
keeping a classification you have evidence against. If the initial classification already matches the evidence
well, or no knowledge base entry is relevant, keep it. Cite specific evidence for your final answer.
```

**Output (mocked):**
```json
{
  "incidentType": "cost-anomaly",
  "severity": "medium",
  "probableCause": "Unexpected Lambda cost increase driven by longer execution duration per invocation, not throttling",
  "evidence": [
    "KB entry matched: \"Unexpected Cost Increases\" — symptom \"sudden cost spike without traffic increase\" matches description",
    "Description explicitly states \"No traffic increase observed\" and \"Same number of invocations but longer duration\", ruling out throttling (which would show increased invocation attempts/errors, not cost)"
  ],
  "nextAction": "Review AWS Cost Explorer broken down by Lambda function; check recent code/config changes that could have increased per-invocation duration (memory misconfiguration, added synchronous calls, retry loops)",
  "confidence": 0.85
}
```

---

## Final result (mocked)

```json
{
  "incidentType": "cost-anomaly",
  "severity": "medium",
  "probableCause": "Unexpected Lambda cost increase driven by longer execution duration per invocation, not throttling",
  "evidence": [
    "KB entry matched: \"Unexpected Cost Increases\" — symptom \"sudden cost spike without traffic increase\" matches description",
    "Description explicitly states \"No traffic increase observed\" and \"Same number of invocations but longer duration\", ruling out throttling (which would show increased invocation attempts/errors, not cost)"
  ],
  "nextAction": "Review AWS Cost Explorer broken down by Lambda function; check recent code/config changes that could have increased per-invocation duration (memory misconfiguration, added synchronous calls, retry loops)",
  "confidence": 0.85
}
```

**Matched expected classification:** yes
