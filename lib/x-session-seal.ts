import type { XSession } from './x-session';

export const X_SESSION_SEAL_VERSION = 'v2';
export const X_SESSION_SEAL_CONTEXT = 'stimgraph:x-session';

export type OpenedXSession = {
  session: XSession;
  needsReseal: boolean;
};

export type RuntimeRead = (name: string) => string | undefined;

function processRead(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): ArrayBuffer {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function tokenKeyUsable(read: RuntimeRead): boolean {
  const value = read('STIMGRAPH_TOKEN_KEY');
  if (!value) return false;
  try {
    tokenKeyBytes(value);
    return true;
  } catch {
    return false;
  }
}

export function tokenKeyBytes(value: string): ArrayBuffer {
  try {
    const trimmed = value.trim();
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) throw new Error('invalid');
    const withoutPad = trimmed.replace(/=+$/, '');
    const normalized = withoutPad.replaceAll('-', '+').replaceAll('_', '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    if (padLength === 3) throw new Error('invalid');
    const binary = atob(`${normalized}${'='.repeat(padLength)}`);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength !== 32) throw new Error('invalid');
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } catch {
    throw new Error('STIMGRAPH_TOKEN_KEY must decode to 32 bytes');
  }
}

function sealAdditionalData(version: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(`${version}.${X_SESSION_SEAL_CONTEXT}`);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseSession(plaintext: ArrayBuffer): XSession | null {
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as XSession;
  if (!parsed.accessToken || !parsed.expiresAt || !parsed.profile?.id) return null;
  return parsed;
}

async function legacyKey(read: RuntimeRead): Promise<CryptoKey | null> {
  const secret = read('X_CLIENT_SECRET');
  if (!secret) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`stimgraph:x-session:v1:${secret}`),
  );
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
}

export async function sealXSession(session: XSession, read: RuntimeRead = processRead): Promise<string> {
  const tokenKey = read('STIMGRAPH_TOKEN_KEY');
  if (!tokenKey) throw new Error('Missing required server configuration: STIMGRAPH_TOKEN_KEY');
  const key = await crypto.subtle.importKey('raw', tokenKeyBytes(tokenKey), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: sealAdditionalData(X_SESSION_SEAL_VERSION) },
    key,
    new TextEncoder().encode(JSON.stringify(session)),
  );
  return `${X_SESSION_SEAL_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openXSession(value: string, read: RuntimeRead = processRead): Promise<OpenedXSession | null> {
  try {
    const parts = value.split('.');
    if (parts.length === 3) {
      if (parts[0] !== X_SESSION_SEAL_VERSION || !parts[1] || !parts[2]) return null;
      const tokenKey = read('STIMGRAPH_TOKEN_KEY');
      if (!tokenKey) return null;
      const key = await crypto.subtle.importKey('raw', tokenKeyBytes(tokenKey), { name: 'AES-GCM' }, false, ['decrypt']);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64Url(parts[1]), additionalData: sealAdditionalData(X_SESSION_SEAL_VERSION) },
        key,
        fromBase64Url(parts[2]),
      );
      const session = parseSession(plaintext);
      return session ? { session, needsReseal: false } : null;
    }
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const key = await legacyKey(read);
    if (!key) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(parts[0]) },
      key,
      fromBase64Url(parts[1]),
    );
    const session = parseSession(plaintext);
    return session ? { session, needsReseal: true } : null;
  } catch {
    return null;
  }
}
