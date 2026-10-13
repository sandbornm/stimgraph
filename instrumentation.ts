export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.STIMGRAPH_TAILNET === 'true') {
    const { loadLocalCredentials } = await import('./lib/local-credentials');
    loadLocalCredentials();
  }
  if (process.env.STIMGRAPH_BACKGROUND_POLL !== 'true') return;
  const { pollConnectedAccounts } = await import('./lib/background-sync');
  const globalState = globalThis as typeof globalThis & { stimgraphPoller?: boolean };
  if (globalState.stimgraphPoller) return;
  globalState.stimgraphPoller = true;
  async function tick() {
    try { await pollConnectedAccounts(); }
    catch { console.error('Background sync failed; retrying in one minute.'); }
    setTimeout(tick, 60_000).unref();
  }
  void tick();
}
