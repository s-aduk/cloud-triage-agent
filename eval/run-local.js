const fs = require('fs');
const path = require('path');

const { BaselineHandler } = require('../services/triage-api/dist/handlers/baseline.js');
const { AgentHandler } = require('../services/triage-api/dist/handlers/agent.js');

const CASES_FILE = path.join(__dirname, '..', 'data', 'evaluation-cases.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

function makeEvent(caseItem) {
  return { body: JSON.stringify({ description: caseItem.description, title: caseItem.title }) };
}

async function runHandler(handler, cases, label) {
  const results = [];
  for (const [index, caseItem] of cases.entries()) {
    process.stdout.write(`[${label}] ${index + 1}/${cases.length}: ${caseItem.title}\n`);
    try {
      const res = await handler(makeEvent(caseItem));
      const output = JSON.parse(res.body);
      results.push({ caseId: caseItem.id, input: caseItem, output });
    } catch (error) {
      results.push({ caseId: caseItem.id, input: caseItem, error: error.message });
    }
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
    details.push({ caseId: r.caseId, title: cases.find((c) => c.id === r.caseId).title, expected, baselineOutput: r.output, baselineCorrect: isCorrect });
  });

  agentResults.forEach((r) => {
    const expected = expectedMap[r.caseId];
    const isCorrect = matchesExpected(r.output, expected);
    if (isCorrect) agentCorrect++;
    const detail = details.find((d) => d.caseId === r.caseId);
    if (detail) { detail.agentOutput = r.output; detail.agentCorrect = isCorrect; }
  });

  const total = cases.length;
  return {
    baseline: { correct: baselineCorrect, total, accuracy: ((baselineCorrect / total) * 100).toFixed(2) + '%' },
    agent: { correct: agentCorrect, total, accuracy: ((agentCorrect / total) * 100).toFixed(2) + '%' },
    improvement: { correct: agentCorrect - baselineCorrect, accuracyDifference: (((agentCorrect - baselineCorrect) / total) * 100).toFixed(2) + '%' },
    generatedAt: new Date().toISOString(),
    details,
  };
}

async function main() {
  const cases = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  const baselineResults = await runHandler(BaselineHandler, cases, 'baseline');
  const agentResults = await runHandler(AgentHandler, cases, 'agent');
  const scoreResult = score(cases, baselineResults, agentResults);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'baseline-results.json'), JSON.stringify(baselineResults, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'agent-results.json'), JSON.stringify(agentResults, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'score.json'), JSON.stringify(scoreResult, null, 2));

  console.log('\n--- Results ---');
  console.log(`Baseline: ${scoreResult.baseline.correct}/${scoreResult.baseline.total} (${scoreResult.baseline.accuracy})`);
  console.log(`Agent:    ${scoreResult.agent.correct}/${scoreResult.agent.total} (${scoreResult.agent.accuracy})`);
  console.log(`Delta:    ${scoreResult.improvement.correct} cases (${scoreResult.improvement.accuracyDifference})`);
}

main().catch((err) => { console.error('Local evaluation failed:', err); process.exit(1); });
