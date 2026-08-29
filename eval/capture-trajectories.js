/**
 * Captures representative agent trajectories against real Bedrock calls and
 * writes them as readable Markdown files under docs/trajectories/.
 *
 * This is the hackathon's "Agent trajectories" deliverable: representative
 * runs showing agent instructions -> tool responses -> final result,
 * including the classify/retrieve/verify steps and (where it happens) the
 * verify step overriding an earlier guess.
 *
 * Requires the same Bedrock setup as eval:llm (AWS credentials, model
 * access enabled). Runs a small, deliberately-chosen subset of cases rather
 * than all 10, since a handful of representative trajectories is the ask —
 * not a full trajectory per eval case.
 *
 * Usage:
 *   npm run trajectories
 *   EVAL_CASE_IDS=case-002,case-010 npm run trajectories   # pick specific cases
 */
const fs = require('fs');
const path = require('path');

const { agentTriageLLMWithTrajectory, baselineTriageLLMWithTrajectory } = require('../services/triage-api/dist/services/triageServiceLLM.js');

const CASES_FILE = path.join(__dirname, '..', 'data', 'evaluation-cases.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'trajectories');

// Default picks: one clean win for the agent (case-003, per docs/changelog.md's
// rule-based comparison) and the known regression case (case-010) — together
// these show both a case where retrieval/verification help and the one where
// the rule-based version failed, so a reader can see whether the LLM version
// fixes it.
const DEFAULT_CASE_IDS = ['case-003', 'case-010'];

function renderTrajectoryMarkdown(caseItem, workflowName, trajectory, finalOutput) {
  let md = `# ${workflowName} trajectory — ${caseItem.title} (${caseItem.id})\n\n`;
  md += `**Input:**\n\n`;
  md += `- Title: ${caseItem.title}\n`;
  md += `- Description: ${caseItem.description}\n\n`;
  md += `**Expected (from data/evaluation-cases.json):** ${JSON.stringify(caseItem.expected)}\n\n`;
  md += `---\n\n`;

  trajectory.forEach((step, i) => {
    md += `## Step ${i + 1}: ${step.step}\n\n`;
    md += `${step.description}\n\n`;
    if (step.input && typeof step.input === 'object' && 'system' in step.input) {
      md += `**System prompt:**\n\`\`\`\n${step.input.system}\n\`\`\`\n\n`;
      md += `**User prompt:**\n\`\`\`\n${step.input.prompt}\n\`\`\`\n\n`;
    } else {
      md += `**Input:**\n\`\`\`json\n${JSON.stringify(step.input, null, 2)}\n\`\`\`\n\n`;
    }
    md += `**Output:**\n\`\`\`json\n${JSON.stringify(step.output, null, 2)}\n\`\`\`\n\n`;
  });

  md += `---\n\n## Final result\n\n\`\`\`json\n${JSON.stringify(finalOutput, null, 2)}\n\`\`\`\n`;

  const matched = finalOutput.incidentType === caseItem.expected.incidentType && finalOutput.severity === caseItem.expected.severity;
  md += `\n**Matched expected classification:** ${matched ? 'yes' : 'no'}\n`;

  return md;
}

async function main() {
  const allCases = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  const caseIds = process.env.EVAL_CASE_IDS ? process.env.EVAL_CASE_IDS.split(',').map((s) => s.trim()) : DEFAULT_CASE_IDS;
  const cases = allCases.filter((c) => caseIds.includes(c.id));

  if (cases.length === 0) {
    console.error(`No cases matched ids: ${caseIds.join(', ')}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const caseItem of cases) {
    console.log(`Capturing trajectory for ${caseItem.id}: ${caseItem.title}`);

    const { output: baselineOutput, trajectory: baselineTrajectory } = await baselineTriageLLMWithTrajectory({
      description: caseItem.description,
      title: caseItem.title,
    });
    const baselineMd = renderTrajectoryMarkdown(caseItem, 'Baseline', baselineTrajectory, baselineOutput);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${caseItem.id}-baseline.md`), baselineMd);

    const { output: agentOutput, trajectory: agentTrajectory } = await agentTriageLLMWithTrajectory({
      description: caseItem.description,
      title: caseItem.title,
    });
    const agentMd = renderTrajectoryMarkdown(caseItem, 'Agent', agentTrajectory, agentOutput);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${caseItem.id}-agent.md`), agentMd);

    console.log(`  -> wrote docs/trajectories/${caseItem.id}-baseline.md and ${caseItem.id}-agent.md`);
  }

  console.log(`\nDone. ${cases.length} case(s) captured to docs/trajectories/.`);
}

main().catch((err) => {
  console.error('Trajectory capture failed:', err);
  process.exit(1);
});
