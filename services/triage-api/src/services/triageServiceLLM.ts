import { invokeStructured, type JsonSchema } from './bedrockClient';
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

const CLASSIFY_SYSTEM_PROMPT = `You are a cloud infrastructure incident triage assistant. Given a raw incident description, classify it. Use only the incidentType and severity values defined in the tool schema. Be decisive: pick the single best category even if the description is ambiguous.`;

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
          .map(
            (entry, i) =>
              `KB entry ${i + 1} - "${entry.title}"\n  Symptoms: ${entry.symptoms.join('; ')}\n  Common causes: ${entry.common_causes.join('; ')}\n  Resolution actions: ${entry.resolution_actions.join('; ')}`
          )
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
well, or no knowledge base entry is relevant, keep it. Cite specific evidence for your final answer.`;

  const verifySystemPrompt = `You are the verification step of a cloud incident triage agent. Your job is to catch and correct mistakes from an earlier, less-informed classification step by weighing retrieved evidence honestly — you have the authority to change the classification, not just comment on it.`;

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
