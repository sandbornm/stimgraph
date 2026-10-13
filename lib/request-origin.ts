import { getRuntimeValue } from './runtime-env';

export function requestOrigin(request: Request) {
  // This is explicit deployment configuration, never an untrusted forwarded
  // header. HTTPS terminates at Tailscale Serve in front of loopback HTTP.
  if (getRuntimeValue('STIMGRAPH_TAILNET') === 'true') {
    const configured = getRuntimeValue('STIMGRAPH_PUBLIC_ORIGIN');
    if (configured) return new URL(configured).origin;
  }
  return new URL(request.url).origin;
}
