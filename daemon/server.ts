// The daemon: one process per install that holds the shared game, runs its
// combat clock, applies every session's actions and serves the world over a
// Unix socket. It never creates a game on its own, never writes a save it
// could not read or one a newer version wrote, and exits once no session has
// talked to it for a while.

import { chmodSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'

import type { GameState } from '../types'

import { isNewerSave, newGame, parseSave, step } from '../src/game/engine'
import { checkDataDir, dataFiles } from './data-dir'
import {
  DAEMON_MARK,
  MAX_BODY_BYTES,
  buildId,
  compareVersions,
  parseAction,
  type ActionReply,
  applyDaemonAction,
  type Hello,
  type SeedReply,
  type ShutdownReply,
  type WorldReply,
  type WorldState,
} from './protocol'

export type DaemonOptions = {
  dataDir: string
  build: string
  version: string
  stepMs?: number
  saveMs?: number
  /** Quiet time, with no request open, after which the daemon exits. */
  idleMs?: number
  /** Longest a `/world` long-poll is held before it answers unchanged. */
  pollMs?: number
  /** Called once the daemon has stopped; the process exits here. */
  onExit?: (code: number) => void
  log?: (line: string) => void
}

export type Daemon = {
  epoch: string
  stop: (reason: string) => Promise<void>
}

/** A lock younger than this, with nothing listening on the socket, is a daemon still starting. */
const STARTING_GRACE_MS = 2000
/** A lock its owner has not touched for this long, with no answer on the socket, is stale. */
const LOCK_STALE_MS = 10_000
/** How often a running daemon touches its lock and checks it still owns it. */
const HEARTBEAT_MS = 2000
const PROBE_TIMEOUT_MS = 2000
const MAX_APPLIED_IDS = 2000
/** A break marker older than this was left by a breaker that died. */
const BREAK_STALE_MS = 5000
/** Longest a starting daemon tries to take the lock before giving up. */
const LOCK_DEADLINE_MS = 8000

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function isErrno(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code
}

type Probe = 'alive' | 'dead' | 'silent'

/**
 * Asks the socket for `/hello`: `alive` when a daemon answers, `dead` when
 * nothing listens there (no socket, or the connection is refused), `silent`
 * when something took the connection but did not answer in time.
 */
export function probe(socketPath: string): Promise<Probe> {
  return new Promise(resolve => {
    const req = request({ socketPath, path: '/hello', method: 'GET', timeout: PROBE_TIMEOUT_MS }, res => {
      res.resume()
      resolve(res.statusCode === 200 ? 'alive' : 'silent')
    })
    req.on('timeout', () => {
      resolve('silent')
      req.destroy()
    })
    req.on('error', err => resolve(isErrno(err, 'ENOENT') || isErrno(err, 'ECONNREFUSED') ? 'dead' : 'silent'))
    req.end()
  })
}

/**
 * Removes a lock judged stale, but only while holding `daemon.lock.break`:
 * one breaker at a time, so no contender removes a lock another one has
 * just written in its place. A breaker that died mid-break leaves its file,
 * which is cleared once it is clearly old.
 */
function breakStale(lock: string, judgedIno: number): void {
  const breaker = `${lock}.break`
  try {
    writeFileSync(breaker, String(process.pid), { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if (!isErrno(err, 'EEXIST')) throw err
    try {
      if (Date.now() - statSync(breaker).mtimeMs > BREAK_STALE_MS) rmSync(breaker, { force: true })
    } catch {
      // Gone already.
    }
    return
  }
  try {
    if (statSync(lock).ino === judgedIno) rmSync(lock, { force: true })
  } catch {
    // Gone already.
  } finally {
    rmSync(breaker, { force: true })
  }
}

/**
 * Takes `daemon.lock`, or returns false when a live daemon already holds it.
 *
 * Alive means its socket answers, never that the pid in the lock exists: a
 * pid is reused. A lock is stale once nothing listens on the socket and the
 * lock is past the time a starting daemon needs to listen, or once its owner
 * has stopped refreshing it (a live daemon touches it every heartbeat).
 */
async function takeLock(lock: string, socket: string, epoch: string): Promise<boolean> {
  const deadline = Date.now() + LOCK_DEADLINE_MS
  while (Date.now() < deadline) {
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid, epoch }), { flag: 'wx', mode: 0o600 })
      return true
    } catch (err) {
      if (!isErrno(err, 'EEXIST')) throw err
    }
    const seen = await probe(socket)
    if (seen === 'alive') return false
    let judged: { ino: number; mtimeMs: number }
    try {
      judged = statSync(lock)
    } catch {
      continue
    }
    if (Date.now() - judged.mtimeMs >= (seen === 'dead' ? STARTING_GRACE_MS : LOCK_STALE_MS)) breakStale(lock, judged.ino)
    await sleep(50 + Math.random() * 50)
  }
  return false
}

function ownsLock(lock: string, epoch: string): boolean {
  try {
    return (JSON.parse(readFileSync(lock, 'utf8')) as { epoch?: unknown }).epoch === epoch
  } catch {
    return false
  }
}

type Loaded = { state: WorldState; game: GameState | null }

/** Reads `world.json` by the world states; an unreadable one is set aside, never overwritten. */
function loadWorld(file: string, log: (line: string) => void): Loaded {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return { state: 'empty', game: null }
    throw err
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    raw = undefined
  }
  if (isNewerSave(raw)) {
    log('world.json comes from a newer version: locked')
    return { state: 'locked', game: null }
  }
  const game = parseSave(raw)
  if (game !== null) return { state: 'loaded', game }
  const kept = join(dirname(file), `world.unreadable-${Date.now()}.json`)
  renameSync(file, kept)
  log(`world.json unreadable: kept as ${kept}`)
  return { state: 'empty', game: null }
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge())
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(text === '' ? undefined : JSON.parse(text))
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Starts the daemon in this process, or resolves null when another one
 * already serves the data directory.
 */
export async function startDaemon(options: DaemonOptions): Promise<Daemon | null> {
  const { dataDir, build, version } = options
  const stepMs = options.stepMs ?? 1500
  const saveMs = options.saveMs ?? 5000
  const idleMs = options.idleMs ?? 15_000
  const pollMs = options.pollMs ?? 10_000
  const log = options.log ?? ((line: string) => console.log(`${new Date().toISOString()} ${line}`))
  const onExit = options.onExit ?? (() => undefined)

  checkDataDir(dataDir)
  const files = dataFiles(dataDir)
  const epoch = `${process.pid}-${Date.now()}`
  if (!(await takeLock(files.lock, files.socket, epoch))) {
    log('another daemon serves this data directory: exiting')
    return null
  }

  let { state, game } = loadWorld(files.world, log)
  let seq = 0
  let isDirty = false
  let lastActivity = Date.now()
  let isStopping = false
  // Requests still open, long-polls included: while any session polls, one is.
  let openRequests = 0
  // Ids of recent actions, oldest first, so a resend is applied once.
  const applied = new Set<string>()
  const waiters = new Set<{ since: number; epoch: string; res: ServerResponse; timer: ReturnType<typeof setTimeout> }>()

  const world = (): WorldReply => ({ epoch, seq, state, game })

  /** Writes the world, only while this daemon still holds the lock. */
  function save(): void {
    if (state !== 'loaded' || game === null || !isDirty || !ownsLock(files.lock, epoch)) return
    const tmp = `${files.world}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(game), { mode: 0o600 })
    renameSync(tmp, files.world)
    isDirty = false
  }

  function changed(next: GameState): void {
    game = next
    seq += 1
    isDirty = true
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiters.delete(waiter)
      send(waiter.res, 200, world())
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    lastActivity = Date.now()
    const url = new URL(req.url ?? '/', 'http://d')
    const route = `${req.method} ${url.pathname}`
    switch (route) {
      case 'GET /hello': {
        const hello: Hello = { build, version, pid: process.pid, epoch, state }
        return send(res, 200, hello)
      }
      case 'GET /world': {
        const since = Number(url.searchParams.get('since') ?? '-1')
        const theirs = url.searchParams.get('epoch') ?? ''
        if (theirs !== epoch || !(since >= seq) || isStopping) return send(res, 200, world())
        const waiter = { since, epoch: theirs, res, timer: setTimeout(() => {
          waiters.delete(waiter)
          send(res, 200, world())
        }, pollMs) }
        waiters.add(waiter)
        res.on('close', () => {
          clearTimeout(waiter.timer)
          waiters.delete(waiter)
        })
        return
      }
      case 'POST /seed': {
        const body = (await readBody(req)) as { game?: unknown } | undefined
        if (state !== 'empty') return send(res, 200, { adopted: false, state } satisfies SeedReply)
        const sent = typeof body === 'object' && body !== null && Object.hasOwn(body, 'game') ? body.game : null
        const adopted = sent === null ? null : parseSave(sent)
        state = 'loaded'
        changed(adopted ?? newGame(Date.now()))
        save()
        log(adopted === null ? 'seeded a new game' : 'seeded the saved game')
        return send(res, 200, { adopted: adopted !== null, state } satisfies SeedReply)
      }
      case 'POST /action': {
        const action = parseAction(await readBody(req))
        if (action === null) return send(res, 400, { ok: false, error: 'bad-action' } satisfies ActionReply)
        if (state === 'locked') return send(res, 200, { ok: false, error: 'locked' } satisfies ActionReply)
        if (state === 'empty' || game === null) return send(res, 200, { ok: false, error: 'not-ready' } satisfies ActionReply)
        if (action.id !== undefined) {
          if (applied.has(action.id)) return send(res, 200, { ok: true, seq } satisfies ActionReply)
          applied.add(action.id)
          if (applied.size > MAX_APPLIED_IDS) applied.delete(applied.values().next().value as string)
        }
        const result = applyDaemonAction(game, action)
        if (result.error !== undefined) return send(res, 200, { ok: false, error: result.error } satisfies ActionReply)
        changed(result.state)
        return send(res, 200, { ok: true, seq } satisfies ActionReply)
      }
      case 'POST /shutdown': {
        const theirBuild = url.searchParams.get('build') ?? ''
        const theirVersion = url.searchParams.get('version') ?? ''
        // Only a strictly newer version takes over: two builds of one version
        // would otherwise shut each other down in turn.
        if (theirBuild === build) return send(res, 200, { ok: false, reason: 'same-build' } satisfies ShutdownReply)
        if (compareVersions(theirVersion, version) <= 0) {
          return send(res, 200, { ok: false, reason: 'not-newer' } satisfies ShutdownReply)
        }
        send(res, 200, { ok: true } satisfies ShutdownReply)
        void stop(`shutdown for build ${theirBuild} ${theirVersion}`)
        return
      }
      default:
        return send(res, 404, { error: 'not-found' })
    }
  }

  const server = createServer((req, res) => {
    openRequests += 1
    let isDone = false
    const done = () => {
      if (isDone) return
      isDone = true
      openRequests -= 1
      lastActivity = Date.now()
    }
    res.on('finish', done)
    res.on('close', done)
    handle(req, res).catch(err => {
      if (err instanceof BodyTooLarge) return send(res, 413, { ok: false, error: 'too-large' })
      log(`request failed: ${err instanceof Error ? err.message : String(err)}`)
      send(res, 500, { ok: false, error: 'internal' })
    })
  })

  // The lock is ours: whatever socket file is left belongs to a daemon that died.
  if (!ownsLock(files.lock, epoch)) {
    log('lost the lock before listening: exiting')
    return null
  }
  rmSync(files.socket, { force: true })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(files.socket, () => {
      server.off('error', reject)
      resolve()
    })
  })
  chmodSync(files.socket, 0o600)
  const boundIno = statSync(files.socket).ino

  const timers = [
    setInterval(() => {
      if (state === 'loaded' && game !== null) changed(step(game))
    }, stepMs),
    setInterval(() => {
      try {
        save()
      } catch (err) {
        log(`save failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }, saveMs),
    setInterval(() => {
      if (openRequests === 0 && Date.now() - lastActivity >= idleMs) void stop('idle')
    }, Math.min(1000, idleMs)),
    setInterval(() => {
      if (!ownsLock(files.lock, epoch)) return void stop('lost the lock', false)
      try {
        const now = new Date()
        utimesSync(files.lock, now, now)
      } catch {
        // Gone between the check and the touch: the next beat stops.
      }
    }, HEARTBEAT_MS),
  ]

  /**
   * Saves, stops serving, then removes the socket and the lock, in that order.
   * A daemon that lost its lock saves nothing and removes neither: both
   * belong to the daemon that holds the lock now.
   */
  async function stop(reason: string, isOwner = true): Promise<void> {
    if (isStopping) return
    isStopping = true
    for (const timer of timers) clearInterval(timer)
    try {
      if (isOwner) save()
    } catch (err) {
      log(`final save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      send(waiter.res, 200, world())
    }
    waiters.clear()
    await new Promise<void>(resolve => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
    if (isOwner && ownsLock(files.lock, epoch)) {
      try {
        if (statSync(files.socket).ino === boundIno) rmSync(files.socket, { force: true })
      } catch {
        // Already gone.
      }
      rmSync(files.lock, { force: true })
    }
    log(`stopped: ${reason}`)
    onExit(0)
  }

  log(`serving ${files.socket} as ${epoch} (build ${build}, version ${version}, ${state})`)
  return { epoch, stop }
}

async function main(dataDir: string | undefined): Promise<void> {
  if (dataDir === undefined) throw new Error('usage: server.js terminal-tales-daemon <dataDir>')
  const script = process.argv[1] ?? ''
  const root = dirname(dirname(script))
  const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')) as { version?: unknown }
  process.title = DAEMON_MARK
  process.umask(0o077)
  const idleMs = Number(process.env.TT_IDLE_MS) || undefined
  const daemon = await startDaemon({
    dataDir,
    build: buildId(readFileSync(script, 'utf8')),
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    idleMs,
    onExit: code => process.exit(code),
  })
  if (daemon === null) process.exit(0)
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void daemon.stop(signal))
  process.on('SIGHUP', () => undefined)
}

if (process.argv[2] === DAEMON_MARK) {
  main(process.argv[3]).catch(err => {
    console.error(`${new Date().toISOString()} daemon failed: ${err instanceof Error ? err.stack : String(err)}`)
    process.exit(1)
  })
}
