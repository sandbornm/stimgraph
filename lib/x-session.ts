import { requireRuntimeValue } from './runtime-env';

export const X_SESSION_COOKIE = 'stim_x_session';
export const X_STATE_COOKIE = 'stim_x_oauth_state';
export const X_VERIFIER_COOKIE = 'stim_x_pkce_verifier';

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

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function fromBase64Url(value: string): ArrayBuffer {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const secret = requireRuntimeValue('X_CLIENT_SECRET');
  const material = new TextEncoder().encode(`stimgraph:x-session:v1:${secret}`);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

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
  const key = await getEncryptionKey();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(session));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openXSession(value: string): Promise<XSession | null> {
  try {
    const [ivPart, ciphertextPart] = value.split('.');
    if (!ivPart || !ciphertextPart) return null;
    const key = await getEncryptionKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(ivPart) },
      key,
      fromBase64Url(ciphertextPart),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as XSession;
    if (!parsed.accessToken || !parsed.expiresAt || !parsed.profile?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}
