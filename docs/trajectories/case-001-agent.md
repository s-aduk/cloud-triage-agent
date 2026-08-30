# Agent trajectory — EC2 CPU Spike (case-001)

**Input:**

- Title: EC2 CPU Spike
- Description: EC2 instance i-0a1b2c3d4e5f6g7h8 showing 95% CPU utilization for 15 minutes. CloudWatch alarm triggered. Application response times increased from 200ms to 2s. No recent deployments.

**Expected (from data/evaluation-cases.json):** {"incidentType":"performance","severity":"high","probableCause":"sudden traffic increase or infinite loop in application code","evidence":["CloudWatch CPU alarm","95% utilization for 15min","response time increase 5x"],"nextAction":"scale EC2 instance or investigate application code for infinite loops","confidence":0.85}

---

## Step 1: classify

First-pass classification from the raw incident description alone, no knowledge base access yet.

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
```

**Output:**
```json
{
  "incidentType": "performance",
  "severity": "medium",
  "probableCause": "An EC2 instance is experiencing sustained high CPU utilization, leading to increased application response times without a full service failure.",
  "confidence": 0.85
}
```

## Step 2: retrieve

Local similarity search over 10 knowledge base entries (not an LLM call).

**Input:**
```json
{
  "description": "EC2 instance i-0a1b2c3d4e5f6g7h8 showing 95% CPU utilization for 15 minutes. CloudWatch alarm triggered. Application response times increased from 200ms to 2s. No recent deployments.",
  "knowledgeBaseSize": 10
}
```

**Output:**
```json
{
  "retrievedCount": 3,
  "retrievedTitles": [
    "EC2 High CPU Utilization",
    "Database Connection Exhaustion",
    "Lambda Function Throttling"
  ]
}
```

## Step 3: verify

Verification confirmed the initial classification against retrieved evidence.

**System prompt:**
```
You are the verification step of a cloud incident triage agent. Your job is to catch and correct mistakes from an earlier, less-informed classification step by weighing retrieved evidence honestly — you have the authority to change the classification, not just comment on it. Only change severity if the retrieved evidence or description actually supports a different impact level than the initial read — do not escalate severity just because you now have more context to cite; more evidence is not the same as more impact.

Retrieved KB entries may include a canonical incidentType and typicalSeverity for that failure pattern (see the prompt below for how to weigh them) — this is the concrete grounding this verification step has that the initial classification pass didn't.

Severity rubric — pick exactly one, based on current, observed impact (not worst-case potential):
- low: no meaningful functional impact — internal, cosmetic, or comfortably within normal operating range; can wait for business hours.
- medium: degraded but still functioning — elevated error rate, latency, or cost, without yet fully failing a request path or a required operational process (e.g. a scheduled job that's slow but still completing).
- high: a customer request path OR a required operational process (e.g. a scheduled batch/ETL job, a backup job) is measurably failing, timing out, or severely degraded for a meaningful share of traffic/runs right now — an actual functional failure, not just a concerning metric. A fully failed job run (e.g. crashed with an error) counts as high even if no live customer request was involved.
- critical: EITHER of the following on its own is enough — (a) active data exposure or an active security breach, OR (b) a full outage: a customer-facing service, or a required operational process, is completely unavailable or completely failing right now for effectively all traffic/attempts. (b) does not require a security angle — e.g. an expired certificate that fails 100% of TLS handshakes is a full outage and is critical on its own, with no breach needed.
Do not escalate severity purely because a percentage or multiplier sounds large (e.g. "300% increase", "50x") when the underlying thing is still working — a cost or latency metric moving a lot while requests still succeed is medium, not high. But do not under-call something that is actually, functionally failing (an error, a crash, a hard failure, 100% of a request type failing) just because the description doesn't use the word "outage" — judge by what is functionally broken right now, not by which words appear.

Resource-exhaustion vs. data-pipeline: resource-exhaustion is correct when the root cause is a system running out of memory, connections, disk, or concurrency — including inside a data pipeline job (an ETL job failing with OutOfMemoryError is resource-exhaustion). Reserve data-pipeline for pipeline-specific issues that aren't resource exhaustion: bad input data, schema drift, or orchestration/scheduling failures.
```

**User prompt:**
```
Incident title: EC2 CPU Spike
Incident description: EC2 instance i-0a1b2c3d4e5f6g7h8 showing 95% CPU utilization for 15 minutes. CloudWatch alarm triggered. Application response times increased from 200ms to 2s. No recent deployments.

Initial classification (from a first-pass read, before seeing the knowledge base):
- incidentType: performance
- severity: medium
- probableCause: An EC2 instance is experiencing sustained high CPU utilization, leading to increased application response times without a full service failure.
- confidence: 0.85

Retrieved knowledge base entries (ranked by similarity to the description):
KB entry 1 - "EC2 High CPU Utilization"
  Canonical categorization for this pattern: incidentType="performance", typicalSeverity="high"
  Symptoms: CPU > 90%; increased response time; CloudWatch alarm
  Common causes: sudden traffic spike; infinite loop; inefficient algorithm; missing index
  Resolution actions: scale instance vertically/horizontally; optimize application code; add database indexing; implement caching

KB entry 2 - "Database Connection Exhaustion"
  Canonical categorization for this pattern: incidentType="resource-exhaustion", typicalSeverity="high"
  Symptoms: 'too many connections' errors; high connection usage %; application timeouts
  Common causes: connection pool misconfiguration; application connection leak; insufficient max_connections
  Resolution actions: increase max_connections; fix connection leaks in application; optimize connection pool settings; kill idle connections

KB entry 3 - "Lambda Function Throttling"
  Canonical categorization for this pattern: incidentType="throttling", typicalSeverity="medium"
  Symptoms: 429 errors; increased duration; concurrent executions at limit
  Common causes: traffic spike exceeding concurrency limits; long-running executions; burst traffic patterns
  Resolution actions: increase reserved concurrency; optimize function duration; implement buffering with SQS/Kinesis; consider provisioned concurrency

Review the initial classification against the retrieved knowledge base entries and the incident description.
If the knowledge base evidence contradicts the initial classification, CHANGE incidentType, severity, and/or
probableCause to match the evidence rather than keeping the initial guess — do not just lower confidence while
keeping a classification you have evidence against. If the initial classification already matches the evidence
well, or no knowledge base entry is relevant, keep it. Cite specific evidence for your final answer.

When a retrieved KB entry has a "Canonical categorization" line, treat its incidentType as a strong default for
this failure pattern and its typicalSeverity as a strong default for a typical instance of it — prefer the KB's
incidentType over the initial guess when they disagree, since the KB reflects a deliberate taxonomy decision.
For severity specifically, use typicalSeverity as your starting point but adjust up or down from it only when
THIS incident's description gives concrete evidence the instance is worse or better than typical (e.g. an
explicit full outage vs. a partial/transient symptom) — don't copy typicalSeverity blindly, and don't ignore it
either.
```

**Output:**
```json
{
  "incidentType": "performance",
  "severity": "high",
  "probableCause": "An EC2 instance is experiencing high CPU utilization resulting in severe latency degradation for application requests.",
  "evidence": [
    "EC2 instance i-0a1b2c3d4e5f6g7h8 showing 95% CPU utilization",
    "Application response times increased from 200ms to 2s",
    "KB entry 1 - EC2 High CPU Utilization with typicalSeverity=high"
  ],
  "nextAction": "Investigate running processes on the EC2 instance to identify the cause of the high CPU load and consider scaling or optimizing the application code.",
  "confidence": 0.95
}
```

---

## Final result

```json
{
  "incidentType": "performance",
  "severity": "high",
  "probableCause": "An EC2 instance is experiencing high CPU utilization resulting in severe latency degradation for application requests.",
  "evidence": [
    "EC2 instance i-0a1b2c3d4e5f6g7h8 showing 95% CPU utilization",
    "Application response times increased from 200ms to 2s",
    "KB entry 1 - EC2 High CPU Utilization with typicalSeverity=high"
  ],
  "nextAction": "Investigate running processes on the EC2 instance to identify the cause of the high CPU load and consider scaling or optimizing the application code.",
  "confidence": 0.95
}
```

**Matched expected classification:** yes
