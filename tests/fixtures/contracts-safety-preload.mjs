// Offline denial tests must never read credentials, run Docker or open sockets.
import fs from 'node:fs/promises';
import child from 'node:child_process';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
const deny = kind => { console.error('BOUNDARY_ATTEMPT:' + kind); throw Error('Forbidden offline boundary: ' + kind); };
const readFile = fs.readFile;
fs.readFile = function(path, ...rest) {
  if (String(path).split(/[\\/]/).at(-1) === '.env') deny('credentials');
  return readFile.call(this, path, ...rest);
};
child.execFileSync = () => deny('process');
net.Socket.prototype.connect = () => deny('network');
globalThis.fetch = () => deny('network');
syncBuiltinESMExports();
