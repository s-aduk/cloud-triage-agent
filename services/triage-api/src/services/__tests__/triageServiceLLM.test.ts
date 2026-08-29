import { agentTriageLLM, baselineTriageLLM } from '../triageServiceLLM';
import { invokeStructured } from '../bedrockClient';

jest.mock('../bedrockClient', () => ({
  invokeStructured: jest.fn(),
}));

const mockedInvokeStructured = invokeStructured as jest.MockedFunction<typeof invokeStructured>;

const COST_ANOMALY_INPUT = {
  title: 'Cost Anomaly',
  description:
    'AWS Cost Explorer shows Lambda costs increased 300% day-over-day. No traffic increase observed. Same number of invocations but longer duration.',
};

describe('agentTriageLLM', () => {
  beforeEach(() => {
    mockedInvokeStructured.mockReset();
  });

  it('lets the verify step override a wrong initial classification', async () => {
    // Step 1 (classify) returns a wrong guess — this is the exact failure
    // mode the rule-based agent had on case-010 (see docs/changelog.md):
    // the word "Lambda" pulls the classifier toward "throttling" even
    // though the incident is a cost anomaly.
    mockedInvokeStructured.mockResolvedValueOnce({
      incidentType: 'throttling',
      severity: 'medium',
      probableCause: 'Lambda throttling suspected',
      confidence: 0.5,
    });

    // Step 3 (verify) sees the retrieved KB context and corrects it.
    mockedInvokeStructured.mockResolvedValueOnce({
      incidentType: 'cost-anomaly',
      severity: 'medium',
      probableCause: 'Unexpected Lambda cost increase, not throttling',
      evidence: ['KB entry matched: Unexpected Cost Increases'],
      nextAction: 'review AWS Cost Explorer for anomalies',
      confidence: 0.85,
    });

    const result = await agentTriageLLM(COST_ANOMALY_INPUT);

    expect(result.incidentType).toBe('cost-anomaly');
    expect(mockedInvokeStructured).toHaveBeenCalledTimes(2);

    // First call is the classify step with no KB context.
    expect(mockedInvokeStructured.mock.calls[0][0].toolName).toBe('submit_classification');
    // Second call is the verify step, and must be told it's allowed to
    // change the answer — this is the specific instruction that fixes the
    // rule-based version's bug, so it's worth pinning in a test.
    const verifyCall = mockedInvokeStructured.mock.calls[1][0];
    expect(verifyCall.toolName).toBe('submit_triage');
    expect(verifyCall.prompt).toMatch(/CHANGE incidentType/);
    expect(verifyCall.prompt).toContain('throttling'); // the initial guess is passed through
  });

  it('keeps the initial classification when the verify step agrees', async () => {
    mockedInvokeStructured.mockResolvedValueOnce({
      incidentType: 'security',
      severity: 'critical',
      probableCause: 'S3 bucket publicly accessible',
      confidence: 0.9,
    });
    mockedInvokeStructured.mockResolvedValueOnce({
      incidentType: 'security',
      severity: 'critical',
      probableCause: 'S3 bucket publicly accessible',
      evidence: ['KB entry matched: S3 Public Access Exposure'],
      nextAction: 'block public access immediately',
      confidence: 0.95,
    });

    const result = await agentTriageLLM({
      title: 'S3 Bucket Public Access',
      description: 'S3 bucket "prod-data" was found publicly accessible during a routine audit.',
    });

    expect(result.incidentType).toBe('security');
    expect(result.severity).toBe('critical');
  });
});

describe('baselineTriageLLM', () => {
  beforeEach(() => {
    mockedInvokeStructured.mockReset();
  });

  it('makes exactly one model call with no retrieval step', async () => {
    mockedInvokeStructured.mockResolvedValueOnce({
      incidentType: 'cost-anomaly',
      severity: 'medium',
      probableCause: 'Unexpected cost increase',
      evidence: ['cost mentioned'],
      nextAction: 'review Cost Explorer',
      confidence: 0.6,
    });

    const result = await baselineTriageLLM(COST_ANOMALY_INPUT);

    expect(mockedInvokeStructured).toHaveBeenCalledTimes(1);
    expect(mockedInvokeStructured.mock.calls[0][0].toolName).toBe('submit_triage');
    expect(result.incidentType).toBe('cost-anomaly');
  });
});
