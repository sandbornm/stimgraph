export function sessionCookieSecure(origin: string) {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return true;
  }
  if (url.protocol !== 'http:') return true;
  const host = url.hostname;
  return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]');
}

export function sessionCookieAttributes(origin: string, maxAge = 0) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: sessionCookieSecure(origin),
    path: '/',
    maxAge,
  };
}
