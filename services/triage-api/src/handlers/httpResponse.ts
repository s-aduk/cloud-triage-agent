import { APIGatewayProxyResult } from 'aws-lambda';

// Matches template.yaml's AWS::Serverless::Api Cors property (AllowOrigin
// '*', AllowMethods 'GET,POST,OPTIONS'). That config only shapes the
// preflight OPTIONS response API Gateway generates automatically — it does
// NOT add these headers to what a Lambda proxy integration itself returns.
// Without this on every actual response (2xx and error alike), the browser
// receives a response with no Access-Control-Allow-Origin header and blocks
// it client-side with "has been blocked by CORS policy", even though the
// request reached the Lambda and got a real answer.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json',
};

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}
