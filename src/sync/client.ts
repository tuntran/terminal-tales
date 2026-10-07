// The plugin's side of the shared fight. It finds or starts the daemon, shows
// the world it long-polls, and sends every action through an outbox drained
// in the background, so no hook ever waits on the network. Without a daemon
// (no runtime, the desktop app, a daemon that keeps failing) the session runs
// its own game and saves it in `$.store`; it never touches `world.json`.

import type { HttpInit, HttpResponse, ProcessRunInit, ProcessRunResult, Timer } from 'claude-code'

import type { GameState, SyncMode } from '../../types'

import {
  applyDaemonAction,
  buildId,
  compareVersions,
  type ActionReply,
  type DaemonAction,
  type Hello,
  type SeedReply,
  type WorldReply,
} from '../../daemon/protocol'
import { isNewerSave, newGame, parseSave, step } from '../game/engine'

export const SAVE_KEY = 'save'
export const UNREADABLE_KEY = 'save-unreadable'
export const INSTALL_KEY = 'install-id'
/** True once the save in `SAVE_KEY` was handed to the daemon; a solo save clears it. */
export const MIGRATED_KEY = 'migrated'

export const STEP_MS = 1500
export const SAVE_MS = 10_000
/** How often a solo session looks for the daemon again. */
export const SOLO_RETRY_MS = 30_000

const HELLO_TIMEOUT_MS = 2000
const ACTION_TIMEOUT_MS = 2000
/** Longer than the daemon holds a long-poll (10 s), so a held poll is not cut. */
const POLL_TIMEOUT_MS = 12_000
const LAUNCH_WAIT_MS = 3000
const LAUNCH_TIMEOUT_MS = 5000
/** A socket path longer than this does not fit `sockaddr_un` everywhere. */
const MAX_SOCKET_BYTES = 100
const MAX_OUTBOX = 1000

/** Where node or bun may live when the session's PATH does not reach it. */
const RUNTIME_PATHS = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', '/opt/homebrew/bin/bun', '/usr/local/bin/bun']


/**
 * What the client needs from the engine. The hooks module builds it over `$`,
 * which never crosses an import, and a test drives every call it makes.
 */
export type Host = {
  root: string
  fetch: (url: string, init: HttpInit) => Promise<HttpResponse>
  run: (argv: readonly string[], init: ProcessRunInit) => Promise<ProcessRunResult>
  readFile: (path: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  home: () => Promise<string | undefined>
  path: () => Promise<string | undefined>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  now: () => Promise<number>
  sleep: (ms: number) => Promise<void>
  every: (ms: number, fn: () => void) => Timer
  toast: (text: string) => void
  readGame: () => Promise<GameState | null>
  updateGame: (fn: (g: GameState | null) => GameState | null) => Promise<void>
  setMode: (mode: SyncMode) => Promise<void>
}

type Link = { home: string; dataDir: string; socket: string }

type Failure = 'no-home' | 'no-process' | 'no-runtime' | 'failed'

type Ensured = { hello: Hello; link: Link } | { failure: Failure }

// This copy of the module's sync state. A second session.start bumps the
// generation, and a loop from an older one stops at its next turn.
let generation = 0
let mode: SyncMode = 'starting'
/** The newest world shown: a reply from another epoch, or an older seq, is never shown over it. */
let cursor = { epoch: '', seq: -1 }
let outbox: DaemonAction[] = []
let isFlushing = false
/** The action whose `/action` request is out now, if any. */
let inFlight: DaemonAction | null = null
// Action ids: this module copy's own tag and a counter, unique enough to tell a resend.
const sender = Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')).join('')
let sent = 0
let ensuring: Promise<Ensured> | null = null
let link: Link | null = null
let runtime: string | null = null
let soloTimers: Timer[] = []
let isSoloWritable = true
const toasted = new Set<string>()

/** True while this session runs its own game (solo or locked), not the daemon's. */
function isLocal(): boolean {
  return mode === 'solo' || mode === 'locked'
}

function toastOnce(host: Host, key: string, text: string): void {
  if (toasted.has(key)) return
  toasted.add(key)
  host.toast(text)
}

async function setMode(host: Host, next: SyncMode): Promise<void> {
  mode = next
  await host.setMode(next)
}

// ---------- transport ----------

/** One request to the daemon, rejected after `timeoutMs` whatever the host does. */
async function call<T>(host: Host, where: Link, method: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const request = host.fetch(`http://d${path}`, {
    method,
    socketPath: where.socket,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const timeout = host.sleep(timeoutMs).then((): never => {
    throw new Error(`timed out: ${method} ${path}`)
  })
  const res = await Promise.race([request, timeout])
  if (res.status !== 200 && res.status !== 400) throw new Error(`status ${res.status}: ${method} ${path}`)
  return JSON.parse(res.text) as T
}

async function hello(host: Host, where: Link): Promise<Hello | null> {
  try {
    return await call<Hello>(host, where, 'GET', '/hello', undefined, HELLO_TIMEOUT_MS)
  } catch {
    return null
  }
}

// ---------- where the daemon lives ----------

function utf8Length(text: string): number {
  let bytes = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

function isInstallId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}$/.test(value)
}

/**
 * This install's id: made once and kept in `$.store`, which an update of the
 * plugin keeps and which a `--plugin-dir` copy and a marketplace install do
 * not share, so neither does their daemon. Two first sessions at once may
 * each write one; both read back the one that landed.
 */
async function installId(host: Host): Promise<string> {
  const stored = await host.storeGet(INSTALL_KEY)
  if (isInstallId(stored)) return stored
  const made = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  await host.storeSet(INSTALL_KEY, made)
  await host.sleep(250)
  const settled = await host.storeGet(INSTALL_KEY)
  return isInstallId(settled) ? settled : made
}

async function locate(host: Host): Promise<Link | null> {
  if (link !== null) return link
  const home = (await host.home())?.replace(/\/+$/, '')
  if (home === undefined || !home.startsWith('/') || home.includes('\0') || home.split('/').includes('..')) return null
  const dataDir = `${home}/.claude/tt/${await installId(host)}`
  const socket = `${dataDir}/d.sock`
  if (utf8Length(socket) > MAX_SOCKET_BYTES) return null
  link = { home, dataDir, socket }
  return link
}

let own: { build: string; version: string } | null = null

/** The build and version of the daemon bundle this copy of the plugin ships. */
async function ownBuild(host: Host): Promise<{ build: string; version: string }> {
  if (own !== null) return own
  const bundle = await host.readFile(`${host.root}/dist/server.js`)
  const manifest = JSON.parse(await host.readFile(`${host.root}/.claude-plugin/plugin.json`)) as { version?: unknown }
  own = { build: buildId(bundle), version: typeof manifest.version === 'string' ? manifest.version : '0.0.0' }
  return own
}

/** node first, then bun: from the session's PATH, else from the usual places. */
async function findRuntime(host: Host, where: Link): Promise<string | null> {
  if (runtime !== null) return runtime
  for (const name of ['node', 'bun']) {
    try {
      const found = await host.run(['which', name], { cwd: where.dataDir, timeoutMs: LAUNCH_TIMEOUT_MS })
      const path = found.stdout.trim()
      if (found.exitCode === 0 && path.startsWith('/')) return (runtime = path)
    } catch {
      // `which` itself is missing: try the usual places.
    }
  }
  for (const path of [...RUNTIME_PATHS, `${where.home}/.bun/bin/bun`]) {
    if (await host.exists(path)) return (runtime = path)
  }
  return null
}

/**
 * Starts the daemon detached. Every command runs with the data directory, or
 * `/` before it exists, as its working directory, never the session's: bun
 * would run a project's `bunfig.toml` preload.
 */
async function launch(host: Host, where: Link): Promise<'ok' | Failure> {
  try {
    await host.run(['mkdir', '-p', '-m', '700', where.dataDir], { cwd: '/', timeoutMs: LAUNCH_TIMEOUT_MS })
  } catch {
    return 'no-process'
  }
  const found = await findRuntime(host, where)
  if (found === null) return 'no-runtime'
  try {
    // `env -i`: the launcher starts from an empty environment, so nothing like
    // NODE_OPTIONS or BUN_OPTIONS from the session loads code into it.
    const path = (await host.path()) ?? '/usr/bin:/bin'
    const argv = ['/usr/bin/env', '-i', `PATH=${path}`, `HOME=${where.home}`, found, `${host.root}/dist/launch.js`, '--detach', where.dataDir]
    const ran = await host.run(argv, { cwd: where.dataDir, timeoutMs: LAUNCH_TIMEOUT_MS })
    return ran.exitCode === 0 ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

async function waitFor(host: Host, where: Link, isUp: boolean): Promise<Hello | null> {
  for (let waited = 0; waited < LAUNCH_WAIT_MS; waited += 100) {
    const answer = await hello(host, where)
    if ((answer !== null) === isUp) return answer
    await host.sleep(100)
  }
  return null
}

async function doEnsure(host: Host): Promise<Ensured> {
  const where = await locate(host)
  if (where === null) return { failure: 'no-home' }
  let mine: { build: string; version: string }
  try {
    mine = await ownBuild(host)
  } catch {
    return { failure: 'failed' }
  }
  let answer = await hello(host, where)
  // A daemon from an older version steps down for this one. Any other daemon
  // is used as it is: two builds of one version must not take turns.
  if (answer !== null && answer.build !== mine.build && compareVersions(mine.version, answer.version) > 0) {
    const query = `?build=${encodeURIComponent(mine.build)}&version=${encodeURIComponent(mine.version)}`
    const reply = await call<{ ok: boolean }>(host, where, 'POST', `/shutdown${query}`, undefined, HELLO_TIMEOUT_MS).catch(() => null)
    if (reply?.ok === true) {
      await waitFor(host, where, false)
      answer = null
    }
  }
  if (answer !== null) return { hello: answer, link: where }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const launched = await launch(host, where)
    if (launched === 'no-process' || launched === 'no-runtime') return { failure: launched }
    answer = await waitFor(host, where, true)
    if (answer !== null) return { hello: answer, link: where }
  }
  return { failure: 'failed' }
}

/** One look for the daemon at a time, however many loops ask. */
function ensureDaemon(host: Host): Promise<Ensured> {
  ensuring ??= doEnsure(host).finally(() => {
    ensuring = null
  })
  return ensuring
}

// ---------- the world ----------

/**
 * Hands an empty daemon its world: the one this session was showing when
 * the daemon lost its own, else the save in `$.store` the first time and
 * after a solo run, else nothing, which makes it start a new game. Of two
 * sessions seeding at once the daemon adopts one.
 */
async function seed(host: Host, where: Link): Promise<void> {
  const shown = mode === 'daemon' ? parseSave(await host.readGame()) : null
  const migrated = (await host.storeGet(MIGRATED_KEY)) === true
  const save = shown ?? (migrated ? null : parseSave(await host.storeGet(SAVE_KEY)))
  const reply = await call<SeedReply>(host, where, 'POST', '/seed', { game: save }, ACTION_TIMEOUT_MS)
  if (reply.adopted) await host.storeSet(MIGRATED_KEY, true)
}

function isWorldReply(value: unknown): value is WorldReply {
  if (typeof value !== 'object' || value === null) return false
  const reply = value as Partial<WorldReply>
  return (
    typeof reply.epoch === 'string' &&
    typeof reply.seq === 'number' &&
    Number.isFinite(reply.seq) &&
    (reply.state === 'empty' || reply.state === 'loaded' || reply.state === 'locked')
  )
}

/**
 * Shows each new world until the daemon stops answering or a newer loop
 * takes over; `progress.isPolled` turns true at the first good reply.
 */
async function poll(host: Host, gen: number, where: Link, progress: { isPolled: boolean }): Promise<WorldReply['state']> {
  while (gen === generation) {
    const query = `/world?since=${cursor.seq}&epoch=${encodeURIComponent(cursor.epoch)}`
    const reply = await call<unknown>(host, where, 'GET', query, undefined, POLL_TIMEOUT_MS)
    if (gen !== generation) break
    if (!isWorldReply(reply)) throw new Error('not a world reply')
    progress.isPolled = true
    // A restarted daemon counts from zero again under a new epoch.
    if (reply.epoch !== cursor.epoch) cursor = { epoch: reply.epoch, seq: -1 }
    if (reply.seq <= cursor.seq) continue
    cursor = { epoch: reply.epoch, seq: reply.seq }
    if (reply.state !== 'loaded') return reply.state
    const shown = parseSave(reply.game)
    if (shown !== null) await host.updateGame(() => shown)
  }
  return 'loaded'
}

/**
 * The session's sync loop: find the daemon, seed it when empty, poll it, and
 * on failure back off, then play solo after three failures in a row. A
 * failure is a daemon that cannot be started, or one that answers `/hello`
 * but never gives a good world.
 */
async function run(host: Host, gen: number): Promise<void> {
  let failures = 0
  const fail = async (why: Failure): Promise<void> => {
    failures += 1
    if (why !== 'failed' || failures >= 3) {
      await enterSolo(host, why)
      await host.sleep(SOLO_RETRY_MS)
    } else {
      await host.sleep(1000 * failures)
    }
  }
  while (gen === generation) {
    const ensured = await ensureDaemon(host)
    if (gen !== generation) return
    if ('failure' in ensured) {
      await fail(ensured.failure)
      continue
    }
    const progress = { isPolled: false }
    try {
      let state = ensured.hello.state
      if (state === 'empty') {
        if (mode === 'solo') await saveSolo(host)
        await seed(host, ensured.link)
        state = 'loaded'
      }
      if (state === 'locked') {
        await enterLocked(host)
        await host.sleep(SOLO_RETRY_MS)
        continue
      }
      await leaveSolo(host)
      await setMode(host, 'daemon')
      void flush(host).catch(() => undefined)
      const ended = await poll(host, gen, ensured.link, progress)
      if (ended === 'locked') {
        await enterLocked(host)
        await host.sleep(SOLO_RETRY_MS)
        continue
      }
    } catch {
      // The daemon went away mid-poll: look for it again.
    }
    if (gen !== generation) return
    if (progress.isPolled) {
      failures = 0
      await host.sleep(250)
    } else {
      await fail('failed')
    }
  }
}

// ---------- actions ----------

function heroError(error: string): string {
  if (error === 'locked') return 'Terminal Tales: save do phiên bản mới hơn tạo, không thể thao tác.'
  if (error === 'not-ready' || error === 'bad-action') return 'Terminal Tales: trận chưa sẵn sàng, thử lại sau.'
  return error
}

/** Sends what the outbox holds, oldest first; a send that fails stays for the next try. */
async function flush(host: Host): Promise<void> {
  if (isFlushing) return
  isFlushing = true
  try {
    while (outbox.length > 0 && mode === 'daemon' && link !== null) {
      const action = outbox[0]!
      let reply: ActionReply
      inFlight = action
      try {
        reply = await call<ActionReply>(host, link, 'POST', '/action', action, ACTION_TIMEOUT_MS)
      } catch {
        // The session went solo while this was out: the drain left it to the
        // daemon, which did not take it, so the solo game does.
        if (isLocal()) await applyLocal(host, action)
        return
      } finally {
        inFlight = null
      }
      // The outbox may have moved on meanwhile (trimmed, or drained into a solo game).
      if (outbox[0] === action) outbox.shift()
      if (!reply.ok && action.kind === 'hero') host.toast(heroError(reply.error))
    }
  } finally {
    isFlushing = false
  }
}

async function applyLocal(host: Host, action: DaemonAction): Promise<void> {
  let error: string | undefined
  await host.updateGame(g => {
    if (g === null) return g
    const result = applyDaemonAction(g, action)
    error = result.error
    return result.state
  })
  if (error !== undefined && action.kind === 'hero') host.toast(error)
}

/** Takes an action from a hook or the pane and returns at once: the daemon gets it in the background. */
export async function submit(host: Host, action: DaemonAction): Promise<void> {
  if (isLocal()) return applyLocal(host, action)
  if (outbox.length >= MAX_OUTBOX) outbox.shift()
  sent += 1
  outbox.push({ ...action, id: `${sender}-${sent}` })
  void flush(host).catch(() => undefined)
}

// ---------- solo ----------

const SOLO_TOASTS: Record<Failure, string> = {
  'no-home': 'Terminal Tales: không tìm thấy thư mục nhà, phiên này chơi một mình.',
  'no-process': 'Terminal Tales: nơi này không chạy được tiến trình nền, phiên này chơi một mình.',
  'no-runtime': 'Terminal Tales: không tìm thấy node hay bun, phiên này chơi một mình.',
  failed: 'Terminal Tales: không khởi động được tiến trình nền, phiên này chơi một mình.',
}

function startSoloTimers(host: Host): void {
  for (const timer of soloTimers) timer.cancel()
  soloTimers = [
    host.every(STEP_MS, () => void host.updateGame(g => (g === null ? g : step(g))).catch(() => undefined)),
    host.every(SAVE_MS, () => void saveSolo(host).catch(() => undefined)),
  ]
}

/** Applies what never reached the daemon to the local game; the one on its way there is left to it. */
async function drainOutbox(host: Host): Promise<void> {
  const queued = outbox.filter(action => action !== inFlight)
  outbox = []
  for (const action of queued) await applyLocal(host, action)
}

/**
 * Runs this session's own game: on from the daemon's last world when one was
 * shown, else from the save in `$.store`.
 */
async function enterSolo(host: Host, why: Failure): Promise<void> {
  if (mode === 'solo') return
  // Whatever game this session goes on with, the save in the store is only
  // written over when this version can read it, or after keeping it aside.
  const raw = await host.storeGet(SAVE_KEY)
  const stored = parseSave(raw)
  isSoloWritable = !isNewerSave(raw)
  if (!isSoloWritable) {
    toastOnce(host, 'newer', 'Terminal Tales: save do phiên bản mới hơn tạo. Phiên này chơi tạm và không ghi đè save đó.')
  } else if (raw !== undefined && stored === null) {
    await host.storeSet(UNREADABLE_KEY, raw)
  }
  const loaded = (mode === 'daemon' ? await host.readGame() : null) ?? stored ?? newGame(Math.floor(await host.now()))
  await host.updateGame(() => loaded)
  await setMode(host, 'solo')
  await drainOutbox(host)
  startSoloTimers(host)
  toastOnce(host, `solo-${why}`, SOLO_TOASTS[why])
}

/** The daemon's world comes from a newer version: play a game here that is never written. */
async function enterLocked(host: Host): Promise<void> {
  if (mode === 'locked') return
  isSoloWritable = false
  const fresh = newGame(Math.floor(await host.now()))
  await host.updateGame(() => fresh)
  await setMode(host, 'locked')
  await drainOutbox(host)
  startSoloTimers(host)
  toastOnce(host, 'locked', 'Terminal Tales: save do phiên bản mới hơn tạo. Phiên này chơi tạm và không ghi đè save đó.')
}

async function leaveSolo(host: Host): Promise<void> {
  if (mode !== 'solo' && mode !== 'locked') return
  for (const timer of soloTimers) timer.cancel()
  soloTimers = []
}

/** Saves a solo game in `$.store`, and marks it for the daemon to adopt when it next starts empty. */
async function saveSolo(host: Host): Promise<void> {
  if (mode !== 'solo' || !isSoloWritable) return
  const g = await host.readGame()
  if (g === null) return
  await host.storeSet(SAVE_KEY, g)
  await host.storeSet(MIGRATED_KEY, false)
}

// ---------- lifecycle ----------

/** Starts this session's sync in the background; the caller never waits on it. */
export function startSync(host: Host): void {
  generation += 1
  // A loop cut short by the module unloading has nothing left to do.
  run(host, generation).catch(() => undefined)
}

/** At session end: a solo game is saved, and the outbox gets a last, short chance to go out. */
export async function endSync(host: Host): Promise<void> {
  if (mode === 'solo') {
    await saveSolo(host)
    return
  }
  await Promise.race([flush(host), host.sleep(1000)])
}
