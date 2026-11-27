import { tokenKeyUsable } from './x-session-seal.ts';

export const X_AUTH_CONFIG_KEYS = ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_REDIRECT_URI', 'STIMGRAPH_TOKEN_KEY'] as const;

export function xAuthConfigured(read: (name: string) => string | undefined) {
  return X_AUTH_CONFIG_KEYS.every((name) => {
    if (name === 'STIMGRAPH_TOKEN_KEY') return tokenKeyUsable(read);
    return Boolean(read(name));
  });
}

export function xClientCredentialsConfigured(read: (name: string) => string | undefined) {
  return Boolean(read('X_CLIENT_ID')) && Boolean(read('X_CLIENT_SECRET'));
}
