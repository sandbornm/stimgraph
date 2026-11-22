export function tailnetAgentAllowed(headers: Headers, config: { tailnet?: string; agentApi?: string; logins?: string }) {
  if ((config.agentApi ?? '').toLowerCase() === 'off') return false;
  if (config.tailnet !== 'true') return false;
  const login = headers.get('tailscale-user-login')?.trim();
  const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(':')[0];
  if (!login || !host.endsWith('.ts.net')) return false;
  const allow = (config.logins ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !allow.length || allow.includes(login.toLowerCase());
}
