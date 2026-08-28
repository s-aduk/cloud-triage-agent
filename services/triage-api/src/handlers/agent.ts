import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { agentTriage, TriageInput } from '../services/triageService';

/**
 * Agent workflow: classify -> retrieve context -> verify -> summarize
 * Takes incident description and returns structured triage report with enhanced reasoning
 */
export const AgentHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
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

    // Run the agent workflow
    const output = await agentTriage(input);

    return {
      statusCode: 200,
      body: JSON.stringify(output),
    };
  } catch (error) {
    console.error('Agent handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};