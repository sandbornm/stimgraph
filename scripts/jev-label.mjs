// One-shot: ask the running Stimgraph server to label all bookmarks that lack a current
// Jev label. The server holds TYPESAFE_API_KEY; this script never sees it.
// Usage: STIMGRAPH_URL=https://<host>.<tailnet>.ts.net pnpm jev:label [limit]
const origin = process.env.STIMGRAPH_URL ?? 'http://127.0.0.1:3001';
const limit = Number(process.argv[2] ?? 1000);
const response = await fetch(`${origin}/api/jev`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({ limit }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(`Jev labeling failed (${response.status}): ${body.error ?? 'unknown error'}`);
  process.exit(1);
}
console.log(`Considered ${body.considered}, labeled ${body.labeled}, accepted ${body.accepted}, failed ${body.failed}, already current ${body.skipped}.`);
