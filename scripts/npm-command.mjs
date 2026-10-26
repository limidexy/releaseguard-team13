// Cross-platform npm launcher (D-04).
// Node.js refuses to spawn .cmd/.bat files without a shell on Windows (CVE-2024-27980 hardening,
// Node >= 18.20.2 / 20.12.2), so spawnSync('npm.cmd', [...]) fails with EINVAL and prints nothing.
// On Windows we start npm through the shell with a fixed, validated command line; elsewhere npm runs directly.
const SAFE_ARG = /^[A-Za-z0-9@._=:\/-]+$/;

export function npmSpawn(args, options = {}, platform = process.platform) {
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string' || !SAFE_ARG.test(a))) {
    throw new Error('npmSpawn only accepts fixed, shell-safe arguments');
  }
  if (platform === 'win32') {
    // One command string with no separate args avoids Node's DEP0190 warning for shell + args.
    return { command: ['npm.cmd', ...args].join(' '), args: [], options: { ...options, shell: true } };
  }
  return { command: 'npm', args, options: { ...options } };
}

export function spawnFailure(label, result) {
  if (result.error) return `${label}: could not start (${result.error.code ?? 'error'}): ${result.error.message}`;
  if (result.status !== 0) return `${label}: exited with ${result.status ?? 'signal ' + result.signal}`;
  return null;
}
