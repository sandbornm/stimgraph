import { tokenKeyBytes } from './x-session-seal';

export const X_AUTH_CONFIG_KEYS = ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_REDIRECT_URI', 'STIMGRAPH_TOKEN_KEY'] as const;

export function xAuthConfigured(read: (name: string) => string | undefined) {
  return X_AUTH_CONFIG_KEYS.every((name) => {
    const value = read(name);
    if (!value) return false;
    if (name !== 'STIMGRAPH_TOKEN_KEY') return true;
    try {
      tokenKeyBytes(value);
      return true;
    } catch {
      return false;
    }
  });
}
