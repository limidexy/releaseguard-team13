import { readFile, writeFile } from 'node:fs/promises';
import { required, completed, key } from './client.mjs';
const [command, arg] = process.argv.slice(2), token = process.env.RELEASEGUARD_TOKEN;
if (!token) { console.error('Set RELEASEGUARD_TOKEN using a secret environment; never pass it as a command-line argument.'); process.exit(2); }
try {
  if (command === 'evaluate' && arg) {
    const input = JSON.parse(await readFile(arg, 'utf8'));
    const queued = await required('jobs', token, input, process.env.RELEASEGUARD_IDEMPOTENCY_KEY ?? key());
    const result = await completed(queued.id, token, Number(process.env.RELEASEGUARD_TIMEOUT_MS ?? 120000));
    console.log(JSON.stringify(result,null,2));
    if (result.status !== 'succeeded' || result.result?.gate !== 'passed') process.exitCode = 3;
  } else if (command === 'list') console.log(JSON.stringify(await required('jobs',token),null,2));
  else if (command === 'evidence' && arg) { const data=await required('evidence/'+arg,token); await writeFile(`evidence-${arg}.json`,JSON.stringify(data,null,2)); console.log('Evidence saved.'); }
  else { console.error('Usage: evaluate input.json | list | evidence release-id'); process.exitCode=2; }
} catch(e) { console.error(String(e)); process.exitCode=1; }
