import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { agentTriageRuleBased, TriageInput } from '../services/triageService';
import { agentTriageLLM } from '../services/triageServiceLLM';
import { jsonResponse } from './httpResponse';

/**
 * Agent workflow: classify -> retrieve context -> verify -> summarize,
 * using Bedrock for classify/verify. See services/triageServiceLLM.ts for
 * the implementation and docs/changelog.md for why verification is allowed
 * to override the initial classification.
 */
export const AgentHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return jsonResponse(400, { error: 'Missing request body' });
    }

    const input: TriageInput = JSON.parse(event.body);

    if (!input.description) {
      return jsonResponse(400, { error: 'Missing description field' });
    }

    const output = await agentTriageLLM(input);

    return jsonResponse(200, output);
  } catch (error) {
    console.error('Agent handler error:', error);
    return jsonResponse(502, {
      error: 'Triage model call failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Lambda handler wrapping the rule-based agent, used only by
 * `npm run eval:local`. Not deployed (see template.yaml).
 */
export const AgentHandlerRuleBased = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const input: TriageInput = JSON.parse(event.body || '{}');
  const output = await agentTriageRuleBased(input);
  return jsonResponse(200, output);
};
