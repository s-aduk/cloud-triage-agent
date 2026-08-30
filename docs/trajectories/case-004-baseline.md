# Baseline trajectory — Lambda Throttling (case-004)

**Input:**

- Title: Lambda Throttling
- Description: Lambda function process-orders showing 429 errors. Duration increased from 1s to 8s. Concurrent executions at limit of 1000.

**Expected (from data/evaluation-cases.json):** {"incidentType":"throttling","severity":"medium","probableCause":"sudden increase in order processing volume exceeding concurrency limits","evidence":["429 errors","duration 8x increase","at concurrency limit"],"nextAction":"increase reserved concurrency, investigate batch size optimization, consider SQS buffering","confidence":0.8}

---

## Step 1: single_call

Single prompt, no tools besides the required output schema, no retrieval, no verification.

**System prompt:**
```
You are a cloud infrastructure incident triage assistant. Given a raw incident description, classify it. Use only the incidentType and severity values defined in the tool schema. Be decisive: pick the single best category even if the description is ambiguous.

Two categories overlap in a way that's easy to mix up: "resource-exhaustion" is the right choice when the ROOT CAUSE is a system running out of a resource (memory, connections, disk, concurrency) — including inside a data pipeline job, e.g. an ETL job that fails with OutOfMemoryError is resource-exhaustion, not data-pipeline. Reserve "data-pipeline" for pipeline-specific failure modes that aren't resource exhaustion: bad/malformed input data, schema drift, upstream data quality issues, or orchestration/scheduling failures.

Severity rubric — pick exactly one, based on current, observed impact (not worst-case potential):
- low: no meaningful functional impact — internal, cosmetic, or comfortably within normal operating range; can wait for business hours.
- medium: degraded but still functioning — elevated error rate, latency, or cost, without yet fully failing a request path or a required operational process (e.g. a scheduled job that's slow but still completing).
- high: a customer request path OR a required operational process (e.g. a scheduled batch/ETL job, a backup job) is measurably failing, timing out, or severely degraded for a meaningful share of traffic/runs right now — an actual functional failure, not just a concerning metric. A fully failed job run (e.g. crashed with an error) counts as high even if no live customer request was involved.
- critical: EITHER of the following on its own is enough — (a) active data exposure or an active security breach, OR (b) a full outage: a customer-facing service, or a required operational process, is completely unavailable or completely failing right now for effectively all traffic/attempts. (b) does not require a security angle — e.g. an expired certificate that fails 100% of TLS handshakes is a full outage and is critical on its own, with no breach needed.
Do not escalate severity purely because a percentage or multiplier sounds large (e.g. "300% increase", "50x") when the underlying thing is still working — a cost or latency metric moving a lot while requests still succeed is medium, not high. But do not under-call something that is actually, functionally failing (an error, a crash, a hard failure, 100% of a request type failing) just because the description doesn't use the word "outage" — judge by what is functionally broken right now, not by which words appear.
```

**User prompt:**
```
Incident title: Lambda Throttling
Incident description: Lambda function process-orders showing 429 errors. Duration increased from 1s to 8s. Concurrent executions at limit of 1000.

Classify this incident and provide a full triage report.
```

**Output:**
```json
{
  "incidentType": "throttling",
  "severity": "medium",
  "probableCause": "The Lambda function is hitting its concurrency limit due to increased duration and incoming request volume.",
  "evidence": [
    "Lambda function process-orders showing 429 errors",
    "Concurrent executions at limit of 1000",
    "Duration increased from 1s to 8s"
  ],
  "nextAction": "Review the concurrency limit for the process-orders Lambda function and investigate the root cause of the increased duration.",
  "confidence": 0.95
}
```

---

## Final result

```json
{
  "incidentType": "throttling",
  "severity": "medium",
  "probableCause": "The Lambda function is hitting its concurrency limit due to increased duration and incoming request volume.",
  "evidence": [
    "Lambda function process-orders showing 429 errors",
    "Concurrent executions at limit of 1000",
    "Duration increased from 1s to 8s"
  ],
  "nextAction": "Review the concurrency limit for the process-orders Lambda function and investigate the root cause of the increased duration.",
  "confidence": 0.95
}
```

**Matched expected classification:** yes
