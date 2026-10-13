import { env } from '@/lib/platform';

type RuntimeEnvironment = Record<string, string | undefined>;

export function getRuntimeValue(name: string): string | undefined {
  const cloudflareValue = (env as unknown as RuntimeEnvironment)[name];
  if (typeof cloudflareValue === 'string' && cloudflareValue.length > 0) {
    return cloudflareValue;
  }

  const processValue = process.env[name];
  return typeof processValue === 'string' && processValue.length > 0
    ? processValue
    : undefined;
}

export function requireRuntimeValue(name: string): string {
  const value = getRuntimeValue(name);
  if (!value) {
    throw new Error(`Missing required server configuration: ${name}`);
  }
  return value;
}
