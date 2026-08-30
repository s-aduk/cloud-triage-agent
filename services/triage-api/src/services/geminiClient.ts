import { GoogleGenAI, ThinkingLevel } from '@google/genai';

// Gemini 2.5 Flash-Lite: free tier via Google AI Studio (aistudio.google.com),
// no credit card required. Deliberately NOT gemini-2.5-flash: Google cut
// Flash's free daily quota sharply in December 2025, and this project hit
// it directly — a real run returned a daily cap of just 20 requests for
// Flash on this account. Flash-Lite's free daily quota is far more
// generous (~1,000/day per Google's docs at time of writing) and it's a
// reasoning model too — plenty for a structured-classification task like
// this. Get a key at https://aistudio.google.com/apikey and set
// GEMINI_API_KEY. See docs/changelog.md for the full quota debugging story.
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const MODEL = process.env.GEMINI_MODEL || DEFAULT_MODEL;

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey');
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Free tier for gemini-2.5-flash-lite is a more generous 15 requests/minute
// (vs. 5 for full Flash) — see the model-selection comment above for why
// Flash-Lite is the default. This still lives here rather than in the
// caller because agentTriageLLM makes 2 calls back-to-back (classify, then
// verify) with no gap between them, so pacing only the outer eval loop
// wouldn't be enough on its own.
const MIN_INTERVAL_MS = 5000; // 60s / 15 requests + ~1s buffer
let lastCallAt = 0;

async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastCallAt = Date.now();
}

function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429) return true;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('RESOURCE_EXHAUSTED') || message.includes('"code":429');
}

/**
 * A per-DAY quota error will not recover within this process's lifetime —
 * Google resets these at midnight Pacific, not on any retryDelay timescale.
 * Retrying one is actively harmful: each retry is itself a request that
 * burns more of an already-exhausted daily budget for a near-certain
 * second failure. Per-MINUTE quota errors, by contrast, genuinely are
 * worth retrying — they recover in tens of seconds.
 */
function isDailyQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('PerDay') || message.toLowerCase().includes('requests per day');
}

/**
 * Extracts the server-suggested retry delay (seconds) from a Gemini 429
 * error's RetryInfo detail, if present. Falls back to a fixed default
 * otherwise — better to wait a bit too long than hammer the API again
 * immediately and burn another attempt against the same per-minute quota.
 */
function extractRetryDelayMs(err: unknown, fallbackMs: number): number {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const match = message.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/);
    if (match) {
      return Math.ceil(parseFloat(match[1]) * 1000) + 1000; // +1s buffer
    }
  } catch {
    // fall through to default
  }
  return fallbackMs;
}

/**
 * Gemini 3.x models use `thinkingLevel` (a string enum) instead of the
 * older `thinkingBudget` (a number token count) that 2.5-and-earlier models
 * use — these are not interchangeable. Sending `thinkingBudget: 0` to a
 * Gemini 3.x Flash/Flash-Lite model returns a generic
 * `400 INVALID_ARGUMENT` with no detail, because full thinking-off isn't a
 * supported state for that model family; `thinkingLevel: MINIMAL` is the
 * documented closest equivalent (Google's own docs describe it as "as
 * close as possible to a zero budget for thinking"). Detected by model ID
 * prefix rather than hardcoded to one model, so this keeps working if
 * GEMINI_MODEL is changed to another Gemini 3.x variant later.
 */
function buildThinkingConfig(model: string): { thinkingBudget?: number; thinkingLevel?: ThinkingLevel } {
  if (/^gemini-3/i.test(model)) {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  return { thinkingBudget: 0 };
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * Same signature as bedrockClient.ts's invokeStructured, so
 * triageServiceLLM.ts doesn't need to change when switching providers.
 *
 * toolName/toolDescription aren't used here — Gemini's responseMimeType +
 * responseSchema forces structured JSON directly, without needing the
 * tool-forcing trick Bedrock's Converse API needed. They're kept in the
 * signature purely so this is a drop-in replacement for the Bedrock client.
 *
 * Retries on per-minute rate limits with backoff (free tier: 15 RPM for
 * Flash-Lite). Fails fast — no retry — on daily quota exhaustion, since
 * that only resets at midnight Pacific and retrying would just waste more
 * of it.
 */
export async function invokeStructured<T>(params: {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: JsonSchema;
  maxTokens?: number;
}): Promise<T> {
  const { system, prompt, schema, maxTokens = 1024 } = params;
  const maxRetries = 5;
  const fallbackDelayMs = 15000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await waitForRateLimit();
    try {
      const response = await getClient().models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          responseSchema: schema as any,
          temperature: 0,
          maxOutputTokens: maxTokens,
          // Thinking is enabled by default across Gemini models and its
          // tokens count against maxOutputTokens, which can silently eat
          // the whole budget before any JSON is emitted, truncating the
          // response mid-string. buildThinkingConfig() picks the right
          // field (thinkingBudget vs thinkingLevel) for whichever model
          // family MODEL resolves to — see its comment for why these
          // aren't interchangeable.
          thinkingConfig: buildThinkingConfig(MODEL),
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error(
          `Gemini returned no text (finishReason: ${response.candidates?.[0]?.finishReason}). ` +
            'This can happen if maxOutputTokens is too low for the schema, or content was blocked by safety filters.'
        );
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Gemini response was not valid JSON despite responseMimeType: application/json. Raw text: ${text}`);
      }
    } catch (err) {
      lastError = err;
      if (isDailyQuotaError(err)) {
        throw new Error(
          `Gemini daily quota exhausted for model "${MODEL}". This resets at midnight Pacific time — ` +
            'retrying now would not help and would only waste more of an already-exhausted budget, so failing immediately. ' +
            `Original error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (isRateLimitError(err) && attempt < maxRetries) {
        const delayMs = extractRetryDelayMs(err, fallbackDelayMs);
        console.warn(
          `Gemini rate limit hit (attempt ${attempt + 1}/${maxRetries + 1}), waiting ${(delayMs / 1000).toFixed(1)}s before retry...`
        );
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export const geminiConfig = { model: MODEL };
