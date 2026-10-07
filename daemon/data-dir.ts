import { chmodSync, lstatSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** The files the daemon keeps in its data directory. */
export function dataFiles(dataDir: string) {
  return {
    socket: join(dataDir, 'd.sock'),
    lock: join(dataDir, 'daemon.lock'),
    world: join(dataDir, 'world.json'),
    log: join(dataDir, 'daemon.log'),
  }
}

/**
 * Throws unless `dataDir` is an absolute path to a real directory the current
 * user owns. A directory of ours with looser permissions is closed to 0700;
 * a symlink or someone else's directory is refused, since the socket inside
 * it takes every action the plugin can.
 */
export function checkDataDir(dataDir: string): void {
  if (!isAbsolute(dataDir)) throw new Error(`data directory is not absolute: ${dataDir}`)
  const info = lstatSync(dataDir)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`data directory is not a directory: ${dataDir}`)
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error(`data directory belongs to another user: ${dataDir}`)
  }
  if ((info.mode & 0o777) !== 0o700) chmodSync(dataDir, 0o700)
}
