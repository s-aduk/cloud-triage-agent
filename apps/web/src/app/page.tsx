'use client';

import { useState } from 'react';
import TriageForm from '@/components/TriageForm';
import TriageResult from '@/components/TriageResult';

export default function Home() {
  const [baselineResult, setBaselineResult] = useState<any>(null);
  const [agentResult, setAgentResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';

  const handleSubmit = async (description: string, title: string) => {
    setLoading(true);
    setError(null);
    setBaselineResult(null);
    setAgentResult(null);

    try {
      // Call baseline endpoint
      const baselineResponse = await fetch(`${apiUrl}/baseline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description, title }),
      });

      if (!baselineResponse.ok) {
        throw new Error(`Baseline request failed: ${baselineResponse.status}`);
      }

      const baselineData = await baselineResponse.json();
      setBaselineResult(baselineData);

      // Call agent endpoint
      const agentResponse = await fetch(`${apiUrl}/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description, title }),
      });

      if (!agentResponse.ok) {
        throw new Error(`Agent request failed: ${agentResponse.status}`);
      }

      const agentData = await agentResponse.json();
      setAgentResult(agentData);
    } catch (err) {
      console.error('Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Cloud Triage Agent</h1>
      <p>
        Enter a cloud incident description to get a triage report from both the
        baseline (simple) and agent (enhanced) workflows.
      </p>

      {error && (
        <div style={{ backgroundColor: '#ffebee', color: '#c62828', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          Error: {error}
        </div>
      )}

      <TriageForm onSubmit={handleSubmit} loading={loading} />

      {baselineResult || agentResult ? (
        <div style={{ display: 'flex', gap: '2rem', marginTop: '2rem' }}>
          <div style={{ flex: 1 }}>
            <h2>Baseline Workflow</h2>
            <TriageResult result={baselineResult} />
          </div>
          <div style={{ flex: 1 }}>
            <h2>Agent Workflow</h2>
            <TriageResult result={agentResult} />
          </div>
        </div>
      ) : null}
    </main>
  );
}