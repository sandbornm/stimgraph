import app from 'vinext/server/app-router-entry';
import { pollConnectedAccounts } from './lib/background-sync';
import { getRuntimeValue } from './lib/runtime-env';
import { trustedTailnetLogin } from './lib/background-policy';

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const tailnet = getRuntimeValue('STIMGRAPH_TAILNET') === 'true';
    const url = new URL(request.url);
    if (tailnet) {
      const trusted = trustedTailnetLogin(request.headers, getRuntimeValue('STIMGRAPH_TAILNET_LOGIN'));
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        && !request.headers.has('tailscale-user-login') && !request.headers.has('x-forwarded-for');
      if (!trusted && !local) return new Response('Forbidden', { status: 403 });
      const origin = getRuntimeValue('STIMGRAPH_PUBLIC_ORIGIN');
      if (origin) {
        const canonical = new URL(origin);
        url.protocol = canonical.protocol;
        url.host = canonical.host;
        request = new Request(url, request);
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const originHeader = request.headers.get('origin');
        if (originHeader && originHeader !== origin && originHeader !== 'http://127.0.0.1:3001') {
          return new Response('Forbidden', { status: 403 });
        }
      }
    }
    const response = await app.fetch(request, env, ctx);
    if (tailnet) {
      const privateResponse = new Response(response.body, response);
      privateResponse.headers.set('Cache-Control', 'private, no-store');
      privateResponse.headers.set('X-Content-Type-Options', 'nosniff');
      privateResponse.headers.set('Referrer-Policy', 'same-origin');
      privateResponse.headers.set('X-Frame-Options', 'DENY');
      return privateResponse;
    }
    return response;
  },
  async scheduled() {
    await pollConnectedAccounts();
  },
};

export default worker;
