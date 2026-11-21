export function isSecretEnvPath(relative) {
  return relative.split('/').some((part) => part === '.env' || (part.startsWith('.env.') && part !== '.env.example'));
}
