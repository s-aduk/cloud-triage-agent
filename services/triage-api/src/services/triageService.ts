import { readFileSync } from 'fs';
import { join } from 'path';

// Types for our triage system
export interface TriageInput {
  description: string;
  title?: string;
}

export interface TriageOutput {
  incidentType: string;
  severity: string;
  probableCause: string;
  evidence: string[];
  nextAction: string;
  confidence: number;
}

// Knowledge base entry type
interface KnowledgeBaseEntry {
  id: string;
  title: string;
  symptoms: string[];
  common_causes: string[];
  investigation_steps: string[];
  resolution_actions: string[];
  confidence_factors: string[];
}

// Load knowledge base from file
const loadKnowledgeBase = (): KnowledgeBaseEntry[] => {
  try {
    // In a real Lambda, we might load from S3 or DynamoDB, but for simplicity we load from local file
    // Note: This is for demonstration. In production, we would use a proper data store.
    const filePath = join(__dirname, '../../..', 'data', 'knowledge-base.json');
    const data = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(data);
    return parsed.cloud_incidents || [];
  } catch (error) {
    console.warn('Could not load knowledge base, using empty array:', error);
    return [];
  }
};

// Simple text similarity function (for demo)
const calculateSimilarity = (text1: string, text2: string): number => {
  const words1 = new Set(text1.toLowerCase().split(/\W+/));
  const words2 = new Set(text2.toLowerCase().split(/\W+/));
  const intersection = [...words1].filter(word => words2.has(word));
  const union = new Set([...words1, ...words2]);
  return intersection.length / union.size;
};

// Classify incident based on description (simple keyword matching)
const classifyIncident = (description: string): { incidentType: string; severity: string; probableCause: string } => {
  const desc = description.toLowerCase();

  // Define patterns for classification
  const patterns: Array<{
    incidentType: string;
    severity: string;
    probableCause: string;
    keywords: string[];
  }> = [
    {
      incidentType: 'performance',
      severity: 'high',
      probableCause: 'high CPU utilization or resource contention',
      keywords: ['cpu', 'processor', 'performance', 'slow', 'latency', 'response time']
    },
    {
      incidentType: 'security',
      severity: 'critical',
      probableCause: 'unauthorized access or data exposure',
      keywords: ['s3', 'public', 'access', 'bucket', 'breach', 'unauthorized', 'exposure']
    },
    {
      incidentType: 'resource-exhaustion',
      severity: 'high',
      probableCause: 'resource exhaustion (connections, memory, etc.)',
      keywords: ['connection', 'database', 'memory', 'ram', 'disk', 'storage', 'exhaustion', 'limit']
    },
    {
      incidentType: 'throttling',
      severity: 'medium',
      probableCause: 'service throttling or rate limiting',
      keywords: ['lambda', 'throttl', '429', 'concurrent', 'limit', 'rate']
    },
    {
      incidentType: 'timeout',
      severity: 'high',
      probableCause: 'timeout or latency issues',
      keywords: ['timeout', 'latency', 'delay', 'api gateway', '504', '502']
    },
    {
      incidentType: 'deployment-issue',
      severity: 'medium',
      probableCause: 'recent deployment causing issues',
      keywords: ['deploy', 'deployment', 'release', 'version', 'rollback']
    },
    {
      incidentType: 'certificate',
      severity: 'critical',
      probableCause: 'SSL/TLS certificate issue',
      keywords: ['certificate', 'ssl', 'tls', 'expired', 'handshake']
    },
    {
      incidentType: 'cost-anomaly',
      severity: 'medium',
      probableCause: 'unexpected cost increase',
      keywords: ['cost', 'billing', 'bill', 'charge', 'expense', 'anomaly']
    },
    {
      incidentType: 'network',
      severity: 'high',
      probableCause: 'network connectivity issues',
      keywords: ['network', 'vpc', 'subnet', 'connectivity', 'reject', 'packet loss']
    },
    {
      incidentType: 'data-pipeline',
      severity: 'high',
      probableCause: 'data processing job failure',
      keywords: ['glue', 'etl', 'job', 'pipeline', 'data processing', 'outofmemory']
    }
  ];

  // Find the best matching pattern
  let bestMatch = patterns[0];
  let maxMatches = 0;

  for (const pattern of patterns) {
    let matches = 0;
    for (const keyword of pattern.keywords) {
      if (desc.includes(keyword)) {
        matches++;
      }
    }
    if (matches > maxMatches) {
      maxMatches = matches;
      bestMatch = pattern;
    }
  }

  // If no keywords matched, return unknown
  if (maxMatches === 0) {
    return {
      incidentType: 'unknown',
      severity: 'low',
      probableCause: 'insufficient information to classify'
    };
  }

  return {
    incidentType: bestMatch.incidentType,
    severity: bestMatch.severity,
    probableCause: bestMatch.probableCause
  };
};

// Retrieve relevant knowledge base entries
const retrieveContext = (description: string, kb: KnowledgeBaseEntry[]): KnowledgeBaseEntry[] => {
  // Score each KB entry by similarity to the description
  const scored = kb.map(entry => {
    // Create a text representation of the entry for comparison
    const entryText = `${entry.title} ${entry.symptoms.join(' ')} ${entry.common_causes.join(' ')}`;
    const similarity = calculateSimilarity(description, entryText);
    return { entry, similarity };
  });

  // Sort by similarity descending and take top 3
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, 3).map(item => item.entry);
};

// Verify and refine the classification based on retrieved context
const verifyClassification = (
  initial: { incidentType: string; severity: string; probableCause: string },
  context: KnowledgeBaseEntry[],
  description: string
): { incidentType: string; severity: string; probableCause: string; evidence: string[]; nextAction: string; confidence: number } => {
  // Start with initial classification
  let incidentType = initial.incidentType;
  let severity = initial.severity;
  let probableCause = initial.probableCause;
  let evidence: string[] = [];
  let nextAction = '';
  let confidence = 0.5; // Base confidence

  // If we have context, we can refine
  if (context.length > 0) {
    // Look for the most relevant KB entry (highest similarity already sorted in retrieveContext)
    const bestEntry = context[0];

    // If the KB entry's incident type matches our initial classification, boost confidence
    // For simplicity, we'll assume the KB entry doesn't have an explicit incidentType field
    // Instead, we'll check if symptoms match
    const symptomMatches = bestEntry.symptoms.some(symptom =>
      description.toLowerCase().includes(symptom.toLowerCase())
    );

    if (symptomMatches) {
      confidence = 0.8;
      // Use the probable cause and resolution actions from the KB entry
      probableCause = bestEntry.common_causes[0] || probableCause;
      nextAction = bestEntry.resolution_actions[0] || 'investigate further';
      evidence = [
        ...bestEntry.symptoms.slice(0, 2),
        ...bestEntry.common_causes.slice(0, 1)
      ].map(s => `KB: ${s}`);
    } else {
      // If symptoms don't match, reduce confidence and keep initial
      confidence = 0.4;
      evidence = [`KB entry "${bestEntry.title}" retrieved but symptoms don't match`];
    }
  } else {
    // No context found
    confidence = 0.3;
    evidence = ['No matching knowledge base entries found'];
  }

  // Set nextAction if not already set
  if (!nextAction) {
    nextAction = 'gather more information and monitor';
  }

  // Add the description as evidence
  evidence.push(`Incident description: ${description.substring(0, 100)}...`);

  return {
    incidentType,
    severity,
    probableCause,
    evidence,
    nextAction,
    confidence
  };
};

// Main agent workflow function
export const agentTriage = async (input: TriageInput): Promise<TriageOutput> => {
  // Step 1: Classify
  const classification = classifyIncident(input.description);

  // Step 2: Retrieve context
  const knowledgeBase = loadKnowledgeBase();
  const context = retrieveContext(input.description, knowledgeBase);

  // Step 3: Verify
  const result = verifyClassification(classification, context, input.description);

  // Step 4: Summarize (already done in verifyClassification for this demo)
  return result;
};

export { TriageInput, TriageOutput, loadKnowledgeBase };