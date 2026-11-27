import { getRuntimeValue } from './runtime-env';
import {
  openXSession as openSealedXSession,
  sealXSession as sealSealedXSession,
  toBase64Url,
  type OpenedXSession,
} from './x-session-seal';

export const X_SESSION_COOKIE = 'stim_x_session';
export const X_STATE_COOKIE = 'stim_x_oauth_state';

export type { OpenedXSession };

export type XProfile = {
  id: string;
  username: string;
  name: string;
  profileImageUrl?: string;
};

export type XSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  profile: XProfile;
};

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return toBase64Url(new Uint8Array(digest));
}

export async function sealXSession(session: XSession): Promise<string> {
  return sealSealedXSession(session, getRuntimeValue);
}

export async function openXSession(value: string): Promise<OpenedXSession | null> {
  return openSealedXSession(value, getRuntimeValue);
}
