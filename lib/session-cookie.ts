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

export function readSessionCookie(cookies: CookieSource): { value: string | undefined; legacy: boolean } {
  const current = cookies.get(sessionCookieName(true))?.value;
  if (current) return { value: current, legacy: false };
  const legacy = cookies.get(sessionCookieName(false))?.value;
  if (legacy) return { value: legacy, legacy: true };
  return { value: undefined, legacy: false };
}

export function readStateCookie(cookies: CookieSource): string | undefined {
  return cookies.get(stateCookieName(true))?.value ?? cookies.get(stateCookieName(false))?.value;
}

export type CookieWrite = {
  name: string;
  value: string;
  maxAge: number;
  secure: boolean;
};

export function sessionCookieWrites(input: {
  secure: boolean;
  maxAge: number;
  renewedValue?: string;
  legacyAccepted?: boolean;
  legacyValue?: string;
  clear: boolean;
}): CookieWrite[] {
  if (input.clear) {
    return [
      { name: sessionCookieName(false), value: '', maxAge: 0, secure: input.secure },
      { name: sessionCookieName(true), value: '', maxAge: 0, secure: true },
    ];
  }
  const writes: CookieWrite[] = [];
  const value = input.renewedValue ?? (input.secure && input.legacyAccepted ? input.legacyValue : undefined);
  if (value) {
    writes.push({ name: sessionCookieName(input.secure), value, maxAge: input.maxAge, secure: input.secure });
  }
  if (input.secure && input.legacyAccepted) {
    writes.push({ name: sessionCookieName(false), value: '', maxAge: 0, secure: true });
  }
  return writes;
}

export function stateCookieSet(secure: boolean): { name: string; maxAge: number; secure: boolean } {
  return { name: stateCookieName(secure), maxAge: 600, secure };
}

export function stateCookieClearWrites(secure: boolean): CookieWrite[] {
  return [
    { name: stateCookieName(false), value: '', maxAge: 0, secure },
    { name: stateCookieName(true), value: '', maxAge: 0, secure: true },
  ];
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
