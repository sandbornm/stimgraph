export const X_SESSION_COOKIE = 'stim_x_session';
export const X_STATE_COOKIE = 'stim_x_oauth_state';

export function sessionCookieName(secure: boolean) {
  return secure ? `__Host-${X_SESSION_COOKIE}` : X_SESSION_COOKIE;
}

export function stateCookieName(secure: boolean) {
  return secure ? `__Host-${X_STATE_COOKIE}` : X_STATE_COOKIE;
}

type CookieSource = {
  get(name: string): { value: string } | undefined;
};

export function readSessionCookie(cookies: CookieSource, secure: boolean) {
  return cookies.get(sessionCookieName(secure))?.value;
}

export function readStateCookie(cookies: CookieSource, secure: boolean) {
  return cookies.get(stateCookieName(secure))?.value;
}

export type CookieWrite = {
  name: string;
  value: string;
  maxAge: number;
  secure: boolean;
  domain?: string;
};

export function cookieParentDomain(hostname: string) {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || host === 'localhost' || host.includes(':')) return undefined;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return undefined;
  const labels = host.split('.');
  if (labels.length < 3 || labels.some((label) => label.length === 0)) return undefined;
  return labels.slice(1).join('.');
}

export function hostnameFromOrigin(origin: string) {
  try {
    return new URL(origin).hostname;
  } catch {
    return '';
  }
}

export function cookieWriteOptions(write: CookieWrite) {
  const domain = write.domain && !write.name.startsWith('__Host-') ? write.domain : undefined;
  return {
    secure: write.secure,
    maxAge: write.maxAge,
    ...(domain ? { domain } : {}),
  };
}

function clearCookieWrites(name: string, secure: boolean, hostname?: string): CookieWrite[] {
  const writes: CookieWrite[] = [{ name, value: '', maxAge: 0, secure }];
  const domain = hostname ? cookieParentDomain(hostname) : undefined;
  if (domain) writes.push({ name, value: '', maxAge: 0, secure, domain });
  writes.push({ name: `__Host-${name}`, value: '', maxAge: 0, secure: true });
  return writes;
}

export function renewedSessionCookieWrites(input: {
  secure: boolean;
  maxAge: number;
  presentedValue?: string;
  renewedValue?: string;
  hostname?: string;
}): CookieWrite[] {
  if (input.presentedValue?.includes('.')) {
    return sessionCookieWrites({
      secure: input.secure,
      maxAge: input.maxAge,
      clear: true,
      hostname: input.hostname,
    });
  }
  return sessionCookieWrites({
    secure: input.secure,
    maxAge: input.maxAge,
    renewedValue: input.renewedValue,
    clear: false,
  });
}

export function sessionCookieWrites(input: {
  secure: boolean;
  maxAge: number;
  renewedValue?: string;
  clear: boolean;
  hostname?: string;
}): CookieWrite[] {
  if (input.clear) return clearCookieWrites(X_SESSION_COOKIE, input.secure, input.hostname);
  if (!input.renewedValue) return [];
  return [{
    name: sessionCookieName(input.secure),
    value: input.renewedValue,
    maxAge: input.maxAge,
    secure: input.secure,
  }];
}

export function stateCookieSet(secure: boolean): { name: string; maxAge: number; secure: boolean } {
  return { name: stateCookieName(secure), maxAge: 600, secure };
}

export function stateCookieClearWrites(secure: boolean, hostname?: string): CookieWrite[] {
  return clearCookieWrites(X_STATE_COOKIE, secure, hostname);
}

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
