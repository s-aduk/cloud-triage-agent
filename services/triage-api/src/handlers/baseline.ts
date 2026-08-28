import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { TriageInput, TriageOutput } from '../services/triageService';

/**
 * Baseline workflow: simple one-prompt triage
 * Takes incident description and returns structured triage report
 */
export const BaselineHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Parse input
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing request body' }),
      };
    }

    const input: TriageInput = JSON.parse(event.body);

    // Validate input
    if (!input.description) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing description field' }),
      };
    }

    // Simple baseline: use a basic prompt to generate triage report
    // In a real implementation, this would call an LLM with a fixed prompt
    // For this example, we'll simulate with a simple rule-based approach
    const output = generateBaselineTriage(input);

    return {
      statusCode: 200,
      body: JSON.stringify(output),
    };
  } catch (error) {
    console.error('Baseline handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

/**
 * Simple baseline triage generation (rule-based for demo)
 * In production, this would be an LLM call with a fixed prompt
 */
function generateBaselineTriage(input: TriageInput): TriageOutput {
  const description = input.description.toLowerCase();

  // Simple keyword-based classification (for demo purposes)
  let incidentType = 'unknown';
  let severity = 'low';
  let probableCause = 'insufficient information';
  let evidence: string[] = [];
  let nextAction = 'gather more information';
  let confidence = 0.3;

  // Check for keywords
  if (description.includes('cpu') || description.includes('processor')) {
    incidentType = 'performance';
    severity = 'high';
    probableCause = 'high CPU utilization';
    evidence = ['CPU utilization mentioned in description'];
    nextAction = 'investigate CPU usage and consider scaling';
    confidence = 0.7;
  } else if (description.includes('s3') && (description.includes('public') || description.includes('access'))) {
    incidentType = 'security';
    severity = 'critical';
    probableCause = 'S3 bucket publicly accessible';
    evidence = ['S3 and public access mentioned'];
    nextAction = 'block public access immediately';
    confidence = 0.9;
  } else if (description.includes('connection') && description.includes('database')) {
    incidentType = 'resource-exhaustion';
    severity = 'high';
    probableCause = 'database connection exhaustion';
    evidence = ['database connection mentioned'];
    nextAction = 'check connection pool and increase limits';
    confidence = 0.8;
  } else if (description.includes('lambda') && description.includes('throttl')) {
    incidentType = 'throttling';
    severity = 'medium';
    probableCause = 'Lambda function throttling';
    evidence = ['Lambda throttling mentioned'];
    nextAction = 'increase concurrency limit';
    confidence = 0.75;
  } else if (description.includes('api gateway') && (description.includes('timeout') || description.includes('latency'))) {
    incidentType = 'timeout';
    severity = 'high';
    probableCause = 'API Gateway timeout or latency issue';
    evidence = ['API Gateway and timeout/latency mentioned'];
    nextAction = 'increase timeout and investigate backend';
    confidence = 0.7;
  } else if (description.includes('deploy') && (description.includes('error') || description.includes('fail'))) {
    incidentType = 'deployment-issue';
    severity = 'medium';
    probableCause = 'recent deployment causing issues';
    evidence = ['deployment and errors mentioned'];
    nextAction = 'consider rolling back deployment';
    confidence = 0.65;
  } else if (description.includes('certificate') || description.includes('ssl')) {
    incidentType = 'certificate';
    severity = 'critical';
    probableCause = 'SSL/TLS certificate issue';
    evidence = ['certificate or SSL mentioned'];
    nextAction = 'check certificate validity and renew if needed';
    confidence = 0.85;
  } else if (description.includes('cost') || description.includes('billing')) {
    incidentType = 'cost-anomaly';
    severity = 'medium';
    probableCause = 'unexpected cost increase';
    evidence = ['cost or billing mentioned'];
    nextAction = 'review AWS Cost Explorer for anomalies';
    confidence = 0.6;
  }

  // If we didn't match any specific pattern, keep unknown but adjust confidence slightly
  if (incidentType === 'unknown') {
    confidence = 0.2;
  }

  return {
    incidentType,
    severity,
    probableCause,
    evidence,
    nextAction,
    confidence,
  };
}