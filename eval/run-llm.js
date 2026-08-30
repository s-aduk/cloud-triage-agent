/**
 * LLM evaluation runner — same comparison as eval/run-local.js, but against
 * the real Gemini-backed handlers instead of the rule-based reference
 * implementation.
 *
 * Requires:
 *   - GEMINI_API_KEY env var — free, no credit card, get one at
 *     https://aistudio.google.com/apikey
 *   - GEMINI_MODEL env var if you want to override the default in
 *     services/triage-api/src/services/geminiClient.ts
 *
 * This makes ~30 real Gemini calls (10 cases x baseline-1-call +
 * agent-2-calls). Uses gemini-2.5-flash-lite by default. Some free-tier
 * accounts have a daily quota as low as 20 requests/day for a given model
 * (confirmed via real testing — see docs/changelog.md), which a single run
 * of this script can exceed on its own. To handle that without wasting
 * quota, this script is RESUMABLE by default: it loads any previous
 * output/*-results-llm.json, skips cases that already have a successful
 * (non-error) result, and only spends new quota on cases that are missing
 * or previously failed. Just re-run the same command again once your daily
 * quota resets (midnight Pacific) — it'll pick up where it left off.
 *
 * Usage:
 *   npm run eval:llm
 *
 * To smoke-test with fewer cases first:
 *   EVAL_CASE_LIMIT=2 npm run eval:llm
 *
 * To ignore previous results and re-run everything from scratch:
 *   FORCE_RERUN=1 npm run eval:llm
 */
const fs = require('fs');
const path = require('path');

const { BaselineHandler } = require('../services/triage-api/dist/handlers/baseline.js');
const { AgentHandler } = require('../services/triage-api/dist/handlers/agent.js');

const CASES_FILE = path.join(__dirname, '..', 'data', 'evaluation-cases.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const CASE_LIMIT = process.env.EVAL_CASE_LIMIT ? parseInt(process.env.EVAL_CASE_LIMIT, 10) : undefined;
const FORCE_RERUN = !!process.env.FORCE_RERUN;

function makeEvent(caseItem) {
  return { body: JSON.stringify({ description: caseItem.description, title: caseItem.title }) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Loads a previous results file, if present. Returns [] if missing or unreadable. */
function loadPreviousResults(filename) {
  try {
    const raw = fs.readFileSync(path.join(OUTPUT_DIR, filename), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Map of caseId -> prior result, but only for results that succeeded (no .error). */
function successfulResultsById(previousResults) {
  const map = new Map();
  for (const r of previousResults) {
    if (r && r.output && !r.error) map.set(r.caseId, r);
  }
  return map;
}

async function runHandler(handler, cases, label, previousResults) {
  const priorSuccesses = FORCE_RERUN ? new Map() : successfulResultsById(previousResults);
  const results = [];
  let skipped = 0;

  for (const [index, caseItem] of cases.entries()) {
    const prior = priorSuccesses.get(caseItem.id);
    if (prior) {
      process.stdout.write(`[${label}] ${index + 1}/${cases.length}: ${caseItem.title} (already succeeded previously — skipping)\n`);
      results.push(prior);
      skipped++;
      continue;
    }

    process.stdout.write(`[${label}] ${index + 1}/${cases.length}: ${caseItem.title}\n`);
    try {
      const res = await handler(makeEvent(caseItem));
      const parsed = JSON.parse(res.body);
      if (res.statusCode >= 400) {
        console.error(`  -> error (status ${res.statusCode}):`, parsed.error, parsed.detail || '');
        results.push({ caseId: caseItem.id, input: caseItem, error: parsed.detail || parsed.error });
      } else {
        results.push({ caseId: caseItem.id, input: caseItem, output: parsed });
      }
    } catch (error) {
      console.error(`  -> threw:`, error.message);
      results.push({ caseId: caseItem.id, input: caseItem, error: error.message });
    }
    // Real pacing against the per-minute free-tier limit happens inside
    // geminiClient.ts (it applies to every call regardless of call site,
    // including the agent's back-to-back classify+verify calls). This is
    // just a small extra gap between eval cases.
    await sleep(500);
  }

  if (skipped > 0) {
    console.log(`[${label}] Skipped ${skipped}/${cases.length} case(s) that already had a successful result from a previous run.\n`);
  }
  return results;
}

function matchesExpected(output, expected) {
  if (!output || output.error) return false;
  return output.incidentType === expected.incidentType && output.severity === expected.severity;
}

function score(cases, baselineResults, agentResults) {
  const expectedMap = {};
  cases.forEach((c) => (expectedMap[c.id] = c.expected));
  const details = [];
  let baselineCorrect = 0;
  let agentCorrect = 0;

  baselineResults.forEach((r) => {
    const expected = expectedMap[r.caseId];
    const isCorrect = matchesExpected(r.output, expected);
    if (isCorrect) baselineCorrect++;
    details.push({ caseId: r.caseId, title: cases.find((c) => c.id === r.caseId).title, expected, baselineOutput: r.output || r.error, baselineCorrect: isCorrect });
  });

  agentResults.forEach((r) => {
    const expected = expectedMap[r.caseId];
    const isCorrect = matchesExpected(r.output, expected);
    if (isCorrect) agentCorrect++;
    const detail = details.find((d) => d.caseId === r.caseId);
    if (detail) { detail.agentOutput = r.output || r.error; detail.agentCorrect = isCorrect; }
  });

  const total = cases.length;
  const baselineComplete = baselineResults.every((r) => r.output && !r.error);
  const agentComplete = agentResults.every((r) => r.output && !r.error);

  return {
    baseline: { correct: baselineCorrect, total, accuracy: ((baselineCorrect / total) * 100).toFixed(2) + '%', complete: baselineComplete },
    agent: { correct: agentCorrect, total, accuracy: ((agentCorrect / total) * 100).toFixed(2) + '%', complete: agentComplete },
    improvement: { correct: agentCorrect - baselineCorrect, accuracyDifference: (((agentCorrect - baselineCorrect) / total) * 100).toFixed(2) + '%' },
    generatedAt: new Date().toISOString(),
    details,
  };
}

async function main() {
  const allCases = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  const cases = CASE_LIMIT ? allCases.slice(0, CASE_LIMIT) : allCases;

  if (CASE_LIMIT) {
    console.log(`EVAL_CASE_LIMIT=${CASE_LIMIT} set — running ${cases.length}/${allCases.length} cases only.\n`);
  }
  if (FORCE_RERUN) {
    console.log('FORCE_RERUN set — ignoring any previous results, re-running everything.\n');
  }
  console.log('Running against Gemini — this makes real API calls (free tier).\n');

  const previousBaseline = loadPreviousResults('baseline-results-llm.json');
  const previousAgent = loadPreviousResults('agent-results-llm.json');

  const baselineResults = await runHandler(BaselineHandler, cases, 'baseline (LLM)', previousBaseline);
  const agentResults = await runHandler(AgentHandler, cases, 'agent (LLM)', previousAgent);
  const scoreResult = score(cases, baselineResults, agentResults);
  if (CASE_LIMIT) {
    scoreResult.partial = true;
    scoreResult.casesRun = cases.length;
    scoreResult.casesTotal = allCases.length;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'baseline-results-llm.json'), JSON.stringify(baselineResults, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'agent-results-llm.json'), JSON.stringify(agentResults, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'score-llm.json'), JSON.stringify(scoreResult, null, 2));

  console.log('\n--- Results (LLM)' + (CASE_LIMIT ? ` — PARTIAL: ${cases.length}/${allCases.length} cases` : '') + ' ---');
  console.log(`Baseline: ${scoreResult.baseline.correct}/${scoreResult.baseline.total} (${scoreResult.baseline.accuracy})${scoreResult.baseline.complete ? '' : ' — INCOMPLETE, some cases still failing'}`);
  console.log(`Agent:    ${scoreResult.agent.correct}/${scoreResult.agent.total} (${scoreResult.agent.accuracy})${scoreResult.agent.complete ? '' : ' — INCOMPLETE, some cases still failing'}`);
  console.log(`Delta:    ${scoreResult.improvement.correct} cases (${scoreResult.improvement.accuracyDifference})`);
  console.log('\nWritten to output/baseline-results-llm.json, output/agent-results-llm.json, output/score-llm.json');

  if (!scoreResult.baseline.complete || !scoreResult.agent.complete) {
    console.log('\nNot all cases completed successfully (likely a daily quota limit). Re-run this same command again after your quota resets — it will only retry the cases that failed, not the ones that already succeeded.');
  }
}

main().catch((err) => {
  console.error('LLM evaluation failed:', err);
  process.exit(1);
});
