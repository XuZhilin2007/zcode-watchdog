import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
export function locations(base = process.env.ZWD_HOME || path.join(os.homedir(), '.zcode-watchdog')) {
  return { home: path.resolve(base), db: path.join(path.resolve(base), 'watchdog.sqlite'),
    log: path.join(path.resolve(base), 'watchdog.log') };
}
export function pipeName(namespace = os.homedir()) {
  const id = crypto.createHash('sha256').update(namespace.toLowerCase()).digest('hex').slice(0,24);
  return process.platform === 'win32' ? '\\\\.\\pipe\\zcode-watchdog-' + id
    : path.join(os.tmpdir(), 'zcode-watchdog-' + id + '.sock');
}
