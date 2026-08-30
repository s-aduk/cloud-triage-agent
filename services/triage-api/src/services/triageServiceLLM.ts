import { invokeStructured, type JsonSchema } from './geminiClient';
import {
  TriageInput,
  TriageOutput,
  KnowledgeBaseEntry,
  loadKnowledgeBase,
  retrieveContext,
} from './triageService';

// Same taxonomy the rule-based classifier and data/evaluation-cases.json use,
// so LLM output stays comparable to the earlier baseline/agent numbers in
// docs/changelog.md rather than introducing a different label set.
const INCIDENT_TYPES = [
  'performance',
  'security',
  'resource-exhaustion',
  'throttling',
  'timeout',
  'deployment-issue',
  'certificate',
  'cost-anomaly',
  'network',
  'data-pipeline',
  'unknown',
];

const SEVERITIES = ['low', 'medium', 'high', 'critical'];

interface ClassificationResult {
  incidentType: string;
  severity: string;
  probableCause: string;
  confidence: number;
}

const CLASSIFICATION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    incidentType: { type: 'string', enum: INCIDENT_TYPES },
    severity: { type: 'string', enum: SEVERITIES },
    probableCause: { type: 'string', description: 'One sentence: the most likely root cause.' },
    confidence: { type: 'number', description: 'Your confidence in this classification, 0 to 1.' },
  },
  required: ['incidentType', 'severity', 'probableCause', 'confidence'],
};

const TRIAGE_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    incidentType: { type: 'string', enum: INCIDENT_TYPES },
    severity: { type: 'string', enum: SEVERITIES },
    probableCause: { type: 'string', description: 'One sentence: the most likely root cause.' },
    evidence: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific phrases or facts from the incident description (or knowledge base) that support this triage.',
    },
    nextAction: { type: 'string', description: 'A specific, actionable next step for the on-call engineer.' },
    confidence: { type: 'number', description: 'Confidence in this triage, 0 to 1.' },
  },
  required: ['incidentType', 'severity', 'probableCause', 'evidence', 'nextAction', 'confidence'],
};

// Shared severity rubric — v1 (previous run) fixed the systemic
// over-escalation bug (4/5 misses were medium->high or high->critical with
// no calibration anchor at all). This is v2, after that run introduced two
// new misses of its own:
//  - case-009 (cert expiry, all clients get SSL handshake failures): the
//    agent's verify step read "critical" as requiring a security breach
//    and missed that a full outage qualifies on its own — downgraded a
//    correct "critical" to "high". Fixed by making the outage clause
//    explicit and independent of the breach clause below.
//  - case-001 (sustained 95% CPU, 5x latency) and case-007 (Glue job OOM,
//    fully failed): both workflows under-called these as "medium" — the
//    v1 instruction not to round up on a big percentage swung too far and
//    got applied to cases where something was genuinely, functionally
//    failing, not just a dramatic-sounding metric. Fixed by anchoring
//    "high" to functional failure (a request path or required operational
//    process actually failing right now) rather than only "customer
//    request path," so it covers non-customer-facing-but-critical
//    processes like a batch job too.
const SEVERITY_RUBRIC = `Severity rubric — pick exactly one, based on current, observed impact (not worst-case potential):
- low: no meaningful functional impact — internal, cosmetic, or comfortably within normal operating range; can wait for business hours.
- medium: degraded but still functioning — elevated error rate, latency, or cost, without yet fully failing a request path or a required operational process (e.g. a scheduled job that's slow but still completing).
- high: a customer request path OR a required operational process (e.g. a scheduled batch/ETL job, a backup job) is measurably failing, timing out, or severely degraded for a meaningful share of traffic/runs right now — an actual functional failure, not just a concerning metric. A fully failed job run (e.g. crashed with an error) counts as high even if no live customer request was involved.
- critical: EITHER of the following on its own is enough — (a) active data exposure or an active security breach, OR (b) a full outage: a customer-facing service, or a required operational process, is completely unavailable or completely failing right now for effectively all traffic/attempts. (b) does not require a security angle — e.g. an expired certificate that fails 100% of TLS handshakes is a full outage and is critical on its own, with no breach needed.
Do not escalate severity purely because a percentage or multiplier sounds large (e.g. "300% increase", "50x") when the underlying thing is still working — a cost or latency metric moving a lot while requests still succeed is medium, not high. But do not under-call something that is actually, functionally failing (an error, a crash, a hard failure, 100% of a request type failing) just because the description doesn't use the word "outage" — judge by what is functionally broken right now, not by which words appear.`;

const CLASSIFY_SYSTEM_PROMPT = `You are a cloud infrastructure incident triage assistant. Given a raw incident description, classify it. Use only the incidentType and severity values defined in the tool schema. Be decisive: pick the single best category even if the description is ambiguous.

Two categories overlap in a way that's easy to mix up: "resource-exhaustion" is the right choice when the ROOT CAUSE is a system running out of a resource (memory, connections, disk, concurrency) — including inside a data pipeline job, e.g. an ETL job that fails with OutOfMemoryError is resource-exhaustion, not data-pipeline. Reserve "data-pipeline" for pipeline-specific failure modes that aren't resource exhaustion: bad/malformed input data, schema drift, upstream data quality issues, or orchestration/scheduling failures.

${SEVERITY_RUBRIC}`;

/**
 * One step in an agent's execution trajectory — see docs/trajectories/ for
 * the hackathon's "agent trajectories" deliverable, generated from these.
 */
export interface TrajectoryStep {
  step: string;
  description: string;
  input: unknown;
  output: unknown;
  timestampMs: number;
}

/**
 * Baseline: a single Bedrock call, no retrieval, no verification step.
 * This mirrors the "one direct prompt with basic instructions" baseline
 * the hackathon brief describes — same underlying model as the agent below,
 * so the comparison isolates the effect of retrieval + verification rather
 * than comparing two different models.
 */
export const baselineTriageLLM = async (input: TriageInput): Promise<TriageOutput> => {
  return (await baselineTriageLLMWithTrajectory(input)).output;
};

export const baselineTriageLLMWithTrajectory = async (
  input: TriageInput
): Promise<{ output: TriageOutput; trajectory: TrajectoryStep[] }> => {
  const trajectory: TrajectoryStep[] = [];
  const prompt = `Incident title: ${input.title || '(none provided)'}\nIncident description: ${input.description}\n\nClassify this incident and provide a full triage report.`;

  const output = await invokeStructured<TriageOutput>({
    system: CLASSIFY_SYSTEM_PROMPT,
    prompt,
    toolName: 'submit_triage',
    toolDescription: 'Submit the completed incident triage report.',
    schema: TRIAGE_OUTPUT_SCHEMA,
  });

  trajectory.push({
    step: 'single_call',
    description: 'Single prompt, no tools besides the required output schema, no retrieval, no verification.',
    input: { system: CLASSIFY_SYSTEM_PROMPT, prompt },
    output,
    timestampMs: Date.now(),
  });

  return { output, trajectory };
};

/**
 * Agent: classify -> retrieve -> verify -> summarize, using Bedrock for the
 * classify and verify steps. Retrieval stays local/non-LLM (the same
 * similarity-based lookup as the rule-based version) since that's a
 * legitimate, cheap retrieval mechanism on its own — the LLM's job is to
 * reason over what retrieval finds, not to replace it.
 *
 * Verification is explicitly allowed to OVERRIDE the initial classification
 * when retrieved evidence disagrees. This is a direct fix for the
 * regression documented in docs/changelog.md (case-010): the rule-based
 * verifier could only adjust confidence, never change the answer, which is
 * why a correctly-retrieved KB entry got discarded there.
 */
export const agentTriageLLM = async (input: TriageInput): Promise<TriageOutput> => {
  return (await agentTriageLLMWithTrajectory(input)).output;
};

export const agentTriageLLMWithTrajectory = async (
  input: TriageInput
): Promise<{ output: TriageOutput; trajectory: TrajectoryStep[] }> => {
  const trajectory: TrajectoryStep[] = [];

  // Step 1: classify (LLM, no knowledge base access yet — this is
  // deliberately the same "cold read" a keyword classifier would get)
  const classifyPrompt = `Incident title: ${input.title || '(none provided)'}\nIncident description: ${input.description}`;
  const initial = await invokeStructured<ClassificationResult>({
    system: CLASSIFY_SYSTEM_PROMPT,
    prompt: classifyPrompt,
    toolName: 'submit_classification',
    toolDescription: 'Submit the initial incident classification.',
    schema: CLASSIFICATION_SCHEMA,
  });
  trajectory.push({
    step: 'classify',
    description: 'First-pass classification from the raw incident description alone, no knowledge base access yet.',
    input: { system: CLASSIFY_SYSTEM_PROMPT, prompt: classifyPrompt },
    output: initial,
    timestampMs: Date.now(),
  });

  // Step 2: retrieve (local similarity search, not an LLM call)
  const knowledgeBase = loadKnowledgeBase();
  const context: KnowledgeBaseEntry[] = retrieveContext(input.description, knowledgeBase);
  trajectory.push({
    step: 'retrieve',
    description: `Local similarity search over ${knowledgeBase.length} knowledge base entries (not an LLM call).`,
    input: { description: input.description, knowledgeBaseSize: knowledgeBase.length },
    output: { retrievedCount: context.length, retrievedTitles: context.map((e) => e.title) },
    timestampMs: Date.now(),
  });

  // Step 3 + 4: verify against retrieved evidence and summarize in one call
  const contextBlock =
    context.length > 0
      ? context
          .map((entry, i) => {
            const canonical =
              entry.incident_type || entry.typical_severity
                ? `\n  Canonical categorization for this pattern: incidentType="${entry.incident_type ?? 'n/a'}", typicalSeverity="${entry.typical_severity ?? 'n/a'}"`
                : '';
            return `KB entry ${i + 1} - "${entry.title}"${canonical}\n  Symptoms: ${entry.symptoms.join('; ')}\n  Common causes: ${entry.common_causes.join('; ')}\n  Resolution actions: ${entry.resolution_actions.join('; ')}`;
          })
          .join('\n\n')
      : '(no matching knowledge base entries were retrieved)';

  const verifyPrompt = `Incident title: ${input.title || '(none provided)'}
Incident description: ${input.description}

Initial classification (from a first-pass read, before seeing the knowledge base):
- incidentType: ${initial.incidentType}
- severity: ${initial.severity}
- probableCause: ${initial.probableCause}
- confidence: ${initial.confidence}

Retrieved knowledge base entries (ranked by similarity to the description):
${contextBlock}

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
either.`;

  const verifySystemPrompt = `You are the verification step of a cloud incident triage agent. Your job is to catch and correct mistakes from an earlier, less-informed classification step by weighing retrieved evidence honestly — you have the authority to change the classification, not just comment on it. Only change severity if the retrieved evidence or description actually supports a different impact level than the initial read — do not escalate severity just because you now have more context to cite; more evidence is not the same as more impact.

Retrieved KB entries may include a canonical incidentType and typicalSeverity for that failure pattern (see the prompt below for how to weigh them) — this is the concrete grounding this verification step has that the initial classification pass didn't.

${SEVERITY_RUBRIC}

Resource-exhaustion vs. data-pipeline: resource-exhaustion is correct when the root cause is a system running out of memory, connections, disk, or concurrency — including inside a data pipeline job (an ETL job failing with OutOfMemoryError is resource-exhaustion). Reserve data-pipeline for pipeline-specific issues that aren't resource exhaustion: bad input data, schema drift, or orchestration/scheduling failures.`;

  const output = await invokeStructured<TriageOutput>({
    system: verifySystemPrompt,
    prompt: verifyPrompt,
    toolName: 'submit_triage',
    toolDescription: 'Submit the final, verified incident triage report.',
    schema: TRIAGE_OUTPUT_SCHEMA,
  });

  trajectory.push({
    step: 'verify',
    description:
      output.incidentType !== initial.incidentType
        ? `Verification OVERRODE the initial classification (${initial.incidentType} -> ${output.incidentType}) based on retrieved evidence.`
        : 'Verification confirmed the initial classification against retrieved evidence.',
    input: { system: verifySystemPrompt, prompt: verifyPrompt },
    output,
    timestampMs: Date.now(),
  });

  return { output, trajectory };
};
