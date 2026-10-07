// `launch.js --detach <dataDir>`: starts the daemon in a session of its own
// (detached: a closing terminal's SIGHUP never reaches it), with the data
// directory as its working directory, a minimal environment and its output
// in daemon.log, then exits at once so the caller never waits on it.

import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkDataDir, dataFiles } from './data-dir'
import { DAEMON_MARK } from './protocol'

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

const [flag, dataDir] = process.argv.slice(2)
if (flag !== '--detach' || dataDir === undefined || !isAbsolute(dataDir)) {
  fail('usage: launch.js --detach <absolute data directory>')
}
process.umask(0o077)
mkdirSync(dataDir, { recursive: true, mode: 0o700 })
try {
  checkDataDir(dataDir)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}

const server = join(dirname(fileURLToPath(import.meta.url)), 'server.js')
const out = openSync(dataFiles(dataDir).log, 'a', 0o600)
const env: Record<string, string> = {}
for (const name of ['PATH', 'HOME', 'TT_IDLE_MS']) {
  const value = process.env[name]
  if (value !== undefined) env[name] = value
}
const child = spawn(process.execPath, [server, DAEMON_MARK, dataDir], {
  cwd: dataDir,
  env,
  detached: true,
  stdio: ['ignore', out, out],
})
child.unref()
console.log(JSON.stringify({ launched: child.pid }))
process.exit(0)
