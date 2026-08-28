# Plan: Cloud Triage Agent

**Source PRD**: Conversational requirements
**Selected Milestone**: Initial implementation
**Complexity**: Medium

## Summary
Build a hackathon-ready Cloud Triage Agent that helps small engineering teams triage cloud incidents faster by providing structured analysis of raw incident inputs. The project includes both a baseline (simple one-prompt) and agent (multi-step with retrieval/verification) workflow for comparison, synthetic evaluation data, and clear deployment instructions.

## Patterns to Mirror
| Category | Source | Pattern |
|----------|--------|---------|
| Naming | [ucidown/covid19-chest-xray-dataset:0] | kebab-case for files/dirs, camelCase for vars/functions, PascalCase for components/types |
| Error handling | [ecc:code-reviewer] | Explicit error handling, never swallow errors, user-friendly messages |
| Logging | [ecc:build-error-resolver] | Structured logging with levels (info, warn, error) |
| Data access | [ecc:database-reviewer] | Repository pattern for data access layer |
| Tests | [ecc:tdd-guide] | AAA pattern (Arrange-Act-Assert) with descriptive test names |

## Files to Change
| File | Action | Why |
|------|--------|-----|
| template.yaml | CREATE | AWS SAM template for infrastructure |
| README.md | CREATE | Setup, build, deploy, run instructions |
| data/evaluation-cases.json | CREATE | Synthetic test cases for evaluation |
| data/knowledge-base.json | CREATE | Knowledge base for agent retrieval |
| services/triage-api/template.yaml | CREATE | SAM template for API service |
| services/triage-api/src/handlers/baseline.ts | CREATE | Baseline workflow Lambda handler |
| services/triage-api/src/handlers/agent.ts | CREATE | Agent workflow Lambda handler |
| services/triage-api/src/services/triageService.ts | CREATE | Shared triage logic |
| eval/run-baseline.ts | CREATE | Baseline evaluation script |
| eval/run-agent.ts | CREATE | Agent evaluation script |
| eval/score.ts | CREATE | Scoring/evaluation script |
| docs/changelog.md | CREATE | Improvement journey documentation |
| docs/reproduction-guide.md | CREATE | Environment setup instructions |
| docs/demo-script.md | CREATE | Demo execution guide |
| apps/web/package.json | CREATE | Frontend dependencies |
| apps/web/src/app/page.tsx | CREATE | Main frontend page |
| apps/web/src/components/TriageForm.tsx | CREATE | Input form component |
| apps/web/src/components/TriageResult.tsx | CREATE | Results display component |

## Tasks
### Task 1: Create project structure and core files
- **Action**: Create the required directory structure and basic files (template.yaml, README.md, etc.)
- **Mirror**: Following AWS SAM and serverless best practices
- **Validate**: Check that all required directories and files exist

### Task 2: Implement baseline workflow
- **Action**: Create a simple Lambda function that takes incident input and returns triage report using a single prompt
- **Mirror**: Following AWS Lambda handler patterns
- **Validate**: Test the baseline function with sample input

### Task 3: Implement agent workflow
- **Action**: Create a more sophisticated workflow with classification, retrieval, verification steps
- **Mirror**: Following multi-step agent patterns with clear separation of concerns
- **Validate**: Test the agent workflow produces better results than baseline

### Task 4: Create synthetic data and evaluation scripts
- **Action**: Generate evaluation cases, knowledge base, and scoring script
- **Mirror**: Following standard JSON data formats and Node/TypeScript testing patterns
- **Validate**: Run evaluation script to compare baseline vs agent performance

### Task 5: Create frontend application
- **Action**: Build a simple Next.js/React UI to interact with the triage agent
- **Mirror**: Following Next.js app router patterns and React best practices
- **Validate**: Frontend can successfully call the API and display results

### Task 6: Add documentation and deployment instructions
- **Action**: Create README, changelog, reproduction guide, demo script
- **Mirror**: Following standard technical documentation patterns
- **Validate**: Instructions are clear and reproducible

## Validation
```bash
# Check directory structure
ls -la apps/web services/triage-api data eval docs output

# Check core files exist
ls -la template.yaml README.md

# Validate SAM template
sam validate

# Check that we can build
sam build

# Run basic tests (to be implemented)
```

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Scope too large for 3 days | Medium | Focus on core triage functionality, keep UI minimal |
| SAM deployment complexity | Medium | Use guided deployment, keep template simple |
| Evaluation metric definition | Medium | Define clear correctness criteria for triage outcomes |
| Synthetic data quality | Low | Use varied, realistic cloud incident scenarios |
| Agent workflow over-engineering | Medium | Keep agent steps focused: classify → retrieve → verify |

## Acceptance
- [ ] All required directories and files created
- [ ] Baseline workflow implemented and testable
- [ ] Agent workflow implemented and testable
- [ ] Evaluation cases and scoring script created
- [ ] README with clear setup/build/deploy/run instructions
- [ ] Changelog showing improvement journey
- [ ] Template.yaml valid and deployable
- [ ] Project follows Ponytail principle (simplest solution that works)