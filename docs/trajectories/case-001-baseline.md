# Baseline trajectory — EC2 CPU Spike (case-001)

**Input:**

- Title: EC2 CPU Spike
- Description: EC2 instance i-0a1b2c3d4e5f6g7h8 showing 95% CPU utilization for 15 minutes. CloudWatch alarm triggered. Application response times increased from 200ms to 2s. No recent deployments.

**Expected (from data/evaluation-cases.json):** {"incidentType":"performance","severity":"high","probableCause":"sudden traffic increase or infinite loop in application code","evidence":["CloudWatch CPU alarm","95% utilization for 15min","response time increase 5x"],"nextAction":"scale EC2 instance or investigate application code for infinite loops","confidence":0.85}

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
Incident title: EC2 CPU Spike
Incident description: EC2 instance i-0a1b2c3d4e5f6g7h8 showing 95% CPU utilization for 15 minutes. CloudWatch alarm triggered. Application response times increased from 200ms to 2s. No recent deployments.

Classify this incident and provide a full triage report.
```

**Output:**
```json
{
  "incidentType": "performance",
  "severity": "medium",
  "probableCause": "The EC2 instance is experiencing high CPU utilization leading to increased application response times.",
  "evidence": [
    "EC2 instance i-0a1b2c3d4e5f6g7h8 showing 95% CPU utilization for 15 minutes",
    "Application response times increased from 200ms to 2s",
    "No recent deployments"
  ],
  "nextAction": "Check the running processes and application logs on instance i-0a1b2c3d4e5f6g7h8 to identify the process consuming high CPU.",
  "confidence": 0.95
}
```

---

## Final result

```json
{
  "incidentType": "performance",
  "severity": "medium",
  "probableCause": "The EC2 instance is experiencing high CPU utilization leading to increased application response times.",
  "evidence": [
    "EC2 instance i-0a1b2c3d4e5f6g7h8 showing 95% CPU utilization for 15 minutes",
    "Application response times increased from 200ms to 2s",
    "No recent deployments"
  ],
  "nextAction": "Check the running processes and application logs on instance i-0a1b2c3d4e5f6g7h8 to identify the process consuming high CPU.",
  "confidence": 0.95
}
```

**Matched expected classification:** no
