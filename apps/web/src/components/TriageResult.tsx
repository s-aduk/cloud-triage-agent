interface TriageResultProps {
  result: any;
}

export default function TriageResult({ result }: TriageResultProps) {
  if (!result) {
    return <p>No result yet.</p>;
  }

  // If the result is an error object from the API
  if (result.error) {
    return <p style={{ color: 'red' }}>Error: {result.error}</p>;
  }

  // Format confidence as percentage
  const confidencePercent = (result.confidence * 100).toFixed(0);

  // Define severity colors
  const severityColors: Record<string, string> = {
    critical: '#c62828', // dark red
    high: '#ef5350',     // red
    medium: '#ffa726',   // orange
    low: '#66bb6a',      // green
    unknown: '#9e9e9e'   // gray
  };

  const severityColor = severityColors[result.severity.toLowerCase()] || '#9e9e9e';

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 'bold' }}>Incident Type:</span>
        <span>{result.incidentType}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 'bold' }}>Severity:</span>
        <span style={{ color: severityColor, fontWeight: 'bold' }}>{result.severity}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 'bold' }}>Confidence:</span>
        <span>{confidencePercent}%</span>
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <span style={{ fontWeight: 'bold' }}>Probable Cause:</span>
        <br />
        <span>{result.probableCause}</span>
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <span style={{ fontWeight: 'bold' }}>Evidence:</span>
        <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
          {result.evidence.map((item: string, index: number) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
      <div>
        <span style={{ fontWeight: 'bold' }}>Next Action:</span>
        <br />
        <span>{result.nextAction}</span>
      </div>
    </div>
  );
}