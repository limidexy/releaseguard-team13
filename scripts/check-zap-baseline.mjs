import { readFileSync } from 'node:fs';

const target = 'http://gateway:8080';
const report = JSON.parse(readFileSync('evidence/zap/baseline.json', 'utf8'));
const site = report.site?.find(entry => entry['@name'] === target);

if (!Array.isArray(site?.alerts) || report.site.length !== 1) {
  throw new Error('ZAP report must cover only the disposable Compose gateway');
}

const counts = [0, 0, 0, 0];
for (const alert of site.alerts) {
  const risk = String(alert.riskcode ?? '');
  if (!/^[0-3]$/.test(risk)) throw new Error('Unrecognized ZAP alert severity');
  counts[Number(risk)]++;
}
console.log(`ZAP baseline: ${counts[3]} high, ${counts[2]} medium, ${counts[1]} low, ${counts[0]} informational alert types.`);
if (counts[3] || counts[2]) process.exitCode = 1;
