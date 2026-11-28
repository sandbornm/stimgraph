import { execFileSync as defaultExecFileSync } from 'node:child_process';

type ExecFile = typeof defaultExecFileSync;

export function loadLocalCredentials(execFileSync: ExecFile = defaultExecFileSync) {
  if (process.env.STIMGRAPH_CREDENTIAL_SOURCE !== 'keychain') return;
  for (const name of ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'STIMGRAPH_TOKEN_KEY', 'XAI_API_KEY', 'TYPESAFE_API_KEY']) {
    try {
      const value = execFileSync('/usr/bin/security', [
        'find-generic-password', '-s', `net.stimgraph.${name}`, '-a', 'stimgraph', '-w',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
      if (value) process.env[name] = value;
    } catch (error) {
      void error;
    }
  }
}
