import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { npmSpawn, spawnFailure } from './npm-command.mjs';

if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Use Node.js 24+ before push');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const violations = [];
const secrets = [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{30,}\b/, /\bgsk_[A-Za-z0-9]{30,}\b/, /\bsk-proj-[A-Za-z0-9_-]{30,}\b/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
for (const file of files) {
  if ((/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) || /(^|\/)(id_rsa|id_ed25519)$/.test(file)) violations.push(file);
  const content = readFileSync(file, 'utf8');
  if (secrets.some(pattern => pattern.test(content))) violations.push(file);
}
if (violations.length) { console.error('Push blocked: sensitive files/patterns in ' + [...new Set(violations)].join(', ')); process.exit(1); }
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const startedAt = new Date().toISOString();
const npm = npmSpawn(['test'], { stdio: 'inherit', timeout: 120000 });
const result = spawnSync(npm.command, npm.args, npm.options);
const failure = spawnFailure('Push blocked: npm test', result);
if (failure) console.error(failure);
mkdirSync('evidence/git', { recursive: true });
writeFileSync('evidence/git/pre-push.json', JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), commit, trackedFiles: files.length, sensitivePatternsDetected: 0, unitExitCode: result.status, startError: result.error ? String(result.error) : null, hostedCI: false, note: 'Local pre-push verification only; no claim of remote CI execution. Pattern scan is not a guarantee of absence of secrets.' }, null, 2));
process.exitCode = result.status === 0 ? 0 : 1;
