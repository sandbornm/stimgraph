import { execFileSync } from 'node:child_process';

// Opt-in, runtime-only Keychain access. No environment files are opened. These
// fixed item names are provisioned manually in Keychain Access by the operator.
export function loadLocalCredentials() {
  if (process.env.STIMGRAPH_CREDENTIAL_SOURCE !== 'keychain') return;
  for (const name of ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'XAI_API_KEY']) {
    try {
      const value = execFileSync('/usr/bin/security', [
        'find-generic-password', '-s', `net.stimgraph.${name}`, '-a', 'stimgraph', '-w',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
      if (value) process.env[name] = value;
    } catch {
      // Missing/locked items leave the service unconfigured. Never log the
      // child-process error: such errors can carry captured output.
    }
  }
}
