const https = require('https');
const fs = require('fs');

// Configuration
const API_URL = process.env.API_URL;
if (!API_URL) {
  console.error('Error: API_URL environment variable is not set');
  console.error('Please set it to the API Gateway URL (e.g., https://xxxx.execute-api.region.amazonaws.com/prod)');
  process.exit(1);
}

const ENDPOINT = `${API_URL}/agent`;
const CASES_FILE = '../data/evaluation-cases.json';
const OUTPUT_FILE = '../output/agent-results.json';

// Helper function to make POST request
function postRequest(data) {
  return new Promise((resolve, reject) => {
    const req = https.request(API_URL.replace(/\/.*$/, '') + ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve(parsed);
        } catch (e) {
          resolve({ error: 'Invalid JSON response', raw: responseBody });
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(JSON.stringify(data));
    req.end();
  });
}

// Main function
async function runAgent() {
  try {
    // Read evaluation cases
    const casesData = fs.readFileSync(CASES_FILE, 'utf8');
    const cases = JSON.parse(casesData);

    console.log(`Running agent evaluation on ${cases.length} cases...`);

    const results = [];

    for (const [index, caseItem] of cases.entries()) {
      console.log(`Processing case ${index + 1}/${cases.length}: ${caseItem.title}`);

      try {
        const response = await postRequest({
          description: caseItem.description,
          title: caseItem.title
        });

        results.push({
          caseId: caseItem.id,
          input: caseItem,
          output: response
        });

        // Optional: add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error processing case ${caseItem.id}:`, error);
        results.push({
          caseId: caseItem.id,
          input: caseItem,
          error: error.message
        });
      }
    }

    // Write results to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`Agent evaluation complete. Results saved to ${OUTPUT_FILE}`);

  } catch (error) {
    console.error('Failed to run agent evaluation:', error);
    process.exit(1);
  }
}

runAgent();