import { NextResponse, type NextRequest } from 'next/server';
import { trustedTailnetLogin } from './lib/background-policy';

export function proxy(request: NextRequest) {
  if (process.env.STIMGRAPH_TAILNET !== 'true') return NextResponse.next();
  const trusted = trustedTailnetLogin(request.headers, process.env.STIMGRAPH_TAILNET_LOGIN);
  const host = request.headers.get('host') ?? '';
  const local = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)
    && !request.headers.has('tailscale-user-login') && !request.headers.has('x-forwarded-for');
  if (!trusted && !local) return new NextResponse('Forbidden', { status: 403 });
  const origin = request.headers.get('origin');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin
    && origin !== process.env.STIMGRAPH_PUBLIC_ORIGIN && origin !== `http://${host}`) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}

export const config = { matcher: '/:path*' };
