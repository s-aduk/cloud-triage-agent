const fs = require('fs');

const BASELINE_RESULTS_FILE = '../output/baseline-results.json';
const AGENT_RESULTS_FILE = '../output/agent-results.json';
const CASES_FILE = '../data/evaluation-cases.json';
const OUTPUT_FILE = '../output/score.json';

// Helper to load JSON file
function loadJsonFile(filepath) {
  try {
    const data = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error loading ${filepath}:`, error.message);
    process.exit(1);
  }
}

// Function to compare two objects for incidentType and severity
function matchesExpected(output, expected) {
  if (!output || output.error) {
    return false;
  }
  return output.incidentType === expected.incidentType &&
         output.severity === expected.severity;
}

// Main function
function runScoring() {
  // Load data
  const baselineResults = loadJsonFile(BASELINE_RESULTS_FILE);
  const agentResults = loadJsonFile(AGENT_RESULTS_FILE);
  const cases = loadJsonFile(CASES_FILE);

  // Create a map of caseId to expected outcome from cases
  const expectedMap = {};
  cases.forEach(caseItem => {
    expectedMap[caseItem.id] = caseItem.expected;
  });

  // Initialize counters
  let baselineCorrect = 0;
  let agentCorrect = 0;
  const totalCases = cases.length;

  // Detailed results for each case
  const details = [];

  // Process each result
  baselineResults.forEach(result => {
    const caseId = result.caseId;
    const expected = expectedMap[caseId];
    const output = result.output;

    let isCorrect = false;
    if (expected && output) {
      isCorrect = matchesExpected(output, expected);
    }

    if (isCorrect) {
      baselineCorrect++;
    }

    details.push({
      caseId,
      title: cases.find(c => c.id === caseId).title,
      expected,
      output,
      correct: isCorrect
    });
  });

  agentResults.forEach(result => {
    const caseId = result.caseId;
    const expected = expectedMap[caseId];
    const output = result.output;

    let isCorrect = false;
    if (expected && output) {
      isCorrect = matchesExpected(output, expected);
    }

    if (isCorrect) {
      agentCorrect++;
    }

    // Find the detail for this case and add agent result
    const detail = details.find(d => d.caseId === caseId);
    if (detail) {
      detail.agentOutput = output;
      detail.agentCorrect = isCorrect;
    }
  });

  // Calculate accuracies
  const baselineAccuracy = (baselineCorrect / totalCases) * 100;
  const agentAccuracy = (agentCorrect / totalCases) * 100;

  // Prepare final score object
  const score = {
    baseline: {
      correct: baselineCorrect,
      total: totalCases,
      accuracy: baselineAccuracy.toFixed(2) + '%'
    },
    agent: {
      correct: agentCorrect,
      total: totalCases,
      accuracy: agentAccuracy.toFixed(2) + '%'
    },
    improvement: {
      correct: agentCorrect - baselineCorrect,
      accuracyDifference: (agentAccuracy - baselineAccuracy).toFixed(2) + '%'
    },
    details: details
  };

  // Write score to file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(score, null, 2));
  console.log(`Scoring complete. Results saved to ${OUTPUT_FILE}`);
  console.log(`Baseline: ${baselineCorrect}/${totalCases} (${baselineAccuracy.toFixed(2)}%)`);
  console.log(`Agent: ${agentCorrect}/${totalCases} (${agentAccuracy.toFixed(2)}%)`);
  console.log(`Improvement: ${agentCorrect - baselineCorrect} cases (${(agentAccuracy - baselineAccuracy).toFixed(2)}%)`);
}

runScoring();