import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { TriageInput, TriageOutput } from '../services/triageService';
import { baselineTriageLLM } from '../services/triageServiceLLM';

/**
 * Baseline workflow: a single Bedrock call with a fixed prompt, no
 * retrieval, no verification step. See docs/changelog.md for the
 * rule-based baseline this replaced and the numbers that motivated
 * moving to an LLM here.
 */
export const BaselineHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing request body' }),
      };
    }

    const input: TriageInput = JSON.parse(event.body);

    if (!input.description) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing description field' }),
      };
    }

    const output = await baselineTriageLLM(input);

    return {
      statusCode: 200,
      body: JSON.stringify(output),
    };
  } catch (error) {
    console.error('Baseline handler error:', error);
    return {
      statusCode: 502,
      body: JSON.stringify({
        error: 'Triage model call failed',
        detail: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

/**
 * Rule-based reference implementation (the original baseline, kept for
 * `npm run eval:local` so a fast, free, no-AWS-credentials sanity check
 * stays available). Not used by the deployed Lambda handler above.
 */
export function generateBaselineTriageRuleBased(input: TriageInput): TriageOutput {
  const description = input.description.toLowerCase();

  let incidentType = 'unknown';
  let severity = 'low';
  let probableCause = 'insufficient information';
  let evidence: string[] = [];
  let nextAction = 'gather more information';
  let confidence = 0.3;

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

/**
 * Lambda handler wrapping the rule-based baseline, used only by
 * `npm run eval:local`. Not deployed (see template.yaml).
 */
export const BaselineHandlerRuleBased = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const input: TriageInput = JSON.parse(event.body || '{}');
  const output = generateBaselineTriageRuleBased(input);
  return { statusCode: 200, body: JSON.stringify(output) };
};
