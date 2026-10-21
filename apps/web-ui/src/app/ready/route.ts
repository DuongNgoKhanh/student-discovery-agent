export function GET() {
  // The UI has no direct dependency credentials. Product API owns the detailed
  // DB/MinIO/runtime readiness probe; this endpoint only reports the UI process.
  return Response.json({ status: 'ok', checks: { web: 'ok' } }, { headers: { 'cache-control': 'no-store' } });
}
