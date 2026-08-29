import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ToolConfiguration,
} from '@aws-sdk/client-bedrock-runtime';

// Inference profile ID, not a bare model ID: on-demand invocation of a base
// model ID (e.g. "anthropic.claude-...") is rejected for current-generation
// Claude models on Bedrock — you must use a region-prefixed cross-region
// inference profile ID instead.
//
// Verify this is still current for your account/region before deploying:
//   aws bedrock list-inference-profiles --region <your-region>
// and make sure model access is enabled in the Bedrock console
// (Model access -> Anthropic -> request/enable) — requests fail with
// AccessDeniedException until that's done, even with correct IAM permissions.
const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const MODEL_ID = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;
const REGION = process.env.AWS_REGION || 'us-east-1';

let client: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({ region: REGION });
  }
  return client;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * Calls Bedrock's Converse API with a single tool defined, and forces the
 * model to use it (toolChoice) so the response is always a JSON object
 * matching the given schema rather than free text that has to be parsed
 * with regex or hope.
 *
 * Throws on any Bedrock error (auth, access, throttling) — callers decide
 * how to handle failure (the handlers below return a 502 rather than
 * silently falling back to a guess, since a silent fallback is exactly the
 * kind of thing that made the rule-based version's numbers untrustworthy).
 */
export async function invokeStructured<T>(params: {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: JsonSchema;
  maxTokens?: number;
}): Promise<T> {
  const { system, prompt, toolName, toolDescription, schema, maxTokens = 512 } = params;

  const messages: Message[] = [
    {
      role: 'user',
      content: [{ text: prompt }],
    },
  ];

  const toolConfig: ToolConfiguration = {
    tools: [
      {
        toolSpec: {
          name: toolName,
          description: toolDescription,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          inputSchema: { json: schema as any },
        },
      },
    ],
    toolChoice: { tool: { name: toolName } },
  };

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: system }],
    messages,
    toolConfig,
    inferenceConfig: { maxTokens, temperature: 0 },
  });

  const response = await getClient().send(command);

  const content = response.output?.message?.content ?? [];
  const toolUseBlock = content.find((block) => 'toolUse' in block && block.toolUse);

  if (!toolUseBlock?.toolUse?.input) {
    throw new Error(
      `Bedrock did not return a tool_use block (stopReason: ${response.stopReason}). ` +
        'This usually means the model or inference profile ID is wrong for this account/region, ' +
        'or model access has not been enabled in the Bedrock console.'
    );
  }

  return toolUseBlock.toolUse.input as T;
}

export const bedrockConfig = { modelId: MODEL_ID, region: REGION };
