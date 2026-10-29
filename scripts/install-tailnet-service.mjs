import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(root, '.tailnet');
const config = resolve(runtime, 'service.json');
if (!existsSync(config) || !existsSync(resolve(runtime, 'source/.next/BUILD_ID'))) {
  throw new Error('Build the isolated source and create .tailnet/service.json first.');
}
const settings = JSON.parse(readFileSync(config, 'utf8'));
const origin = new URL(settings.publicOrigin);
if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.ts.net') || !settings.tailnetLogin) throw new Error('Configure the HTTPS tailnet origin and login.');
const variables = {
  NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  STIMGRAPH_TAILNET: 'true', STIMGRAPH_TAILNET_LOGIN: settings.tailnetLogin,
  STIMGRAPH_PUBLIC_ORIGIN: origin.origin, X_REDIRECT_URI: `${origin.origin}/api/auth/x/callback`,
  STIMGRAPH_BACKGROUND_POLL: 'true', STIMGRAPH_DATABASE: resolve(runtime, 'state/stimgraph.sqlite'),
  STIMGRAPH_CREDENTIAL_SOURCE: settings.credentialSource === 'keychain' ? 'keychain' : 'none',
};
const label = 'net.stimgraph.tailnet';
const domain = `gui/${process.getuid()}`;
const agents = resolve(homedir(), 'Library/LaunchAgents');
const plist = resolve(agents, `${label}.plist`);
const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
mkdirSync(agents, { recursive: true });
writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>
<string>${xml(process.execPath)}</string>
<string>${xml(resolve(runtime, 'source/node_modules/next/dist/bin/next'))}</string>
<string>start</string><string>--hostname</string><string>127.0.0.1</string>
<string>--port</string><string>${Number(settings.port ?? 3001)}</string>
</array>
<key>WorkingDirectory</key><string>${xml(resolve(runtime, 'source'))}</string>
<key>EnvironmentVariables</key><dict>
${Object.entries(variables).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('\n')}
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(resolve(runtime, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(runtime, 'service-error.log'))}</string>
</dict></plist>
`, { mode: 0o600 });
try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }); } catch { }
for (let attempt = 0; ; attempt++) {
  try {
    execFileSync('launchctl', ['bootstrap', domain, plist], { stdio: 'pipe' });
    break;
  } catch {
    if (attempt >= 4) throw new Error('LaunchAgent could not be loaded; check it with plutil and launchctl.');
    await new Promise((done) => setTimeout(done, 1000));
  }
}
console.log(`Installed ${label}; starts at login and restarts after a crash.`);
