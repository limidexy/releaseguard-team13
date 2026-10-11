import { readFile } from 'node:fs/promises';
import { SignJWT } from 'jose';
export async function env() { return Object.fromEntries((await readFile('.env', 'utf8')).split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => { const i=l.indexOf('='); return [l.slice(0,i),l.slice(i+1)]; })); }
export async function token(sub, role, workspace = 'team13', service = false, principal = 'developer') {
  const e = await env(); return new SignJWT({ workspace, role, service, ...(service ? {principal} : {}) }).setSubject(sub).setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-local').setAudience('releaseguard').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(e.AUTH_SECRET));
}
if (process.argv[1]?.endsWith('dev-tokens.mjs')) {
  for (const [sub, role] of [['developer', 'contributor'], ['reviewer', 'reviewer'], ['observer', 'viewer']]) console.log(sub + ': ' + await token(sub, role));
  console.log('Local development tokens expire in one hour. Paste into the local console only.');
}
