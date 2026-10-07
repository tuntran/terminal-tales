import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GameState } from '../types'

import { newGame } from '../src/game/engine'
import { dataFiles } from './data-dir'
import { buildId, compareVersions, parseAction, type Hello, type WorldReply } from './protocol'
import { startDaemon, type Daemon, type DaemonOptions } from './server'

const dirs: string[] = []
const running: Daemon[] = []

afterEach(async () => {
  for (const daemon of running.splice(0)) await daemon.stop('test over')
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tt-'))
  dirs.push(dir)
  return dir
}

async function start(dataDir: string, options: Partial<DaemonOptions> = {}): Promise<Daemon | null> {
  const daemon = await startDaemon({ dataDir, build: 'b1', version: '1.0.0', log: () => undefined, ...options })
  if (daemon !== null) running.push(daemon)
  return daemon
}

type Reply = { status: number; body: unknown }

function call(dataDir: string, method: string, path: string, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: dataFiles(dataDir).socket, path, method, headers: { connection: 'close' } }, res => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, body: text === '' ? undefined : JSON.parse(text) })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

async function world(dataDir: string, query = ''): Promise<WorldReply> {
  return (await call(dataDir, 'GET', `/world${query}`)).body as WorldReply
}

function seeded(dataDir: string, game: GameState = newGame(5)): string {
  writeFileSync(dataFiles(dataDir).world, JSON.stringify(game))
  return dataDir
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('protocol', () => {
  test('plain and hero actions parse; anything else is refused', () => {
    expect(parseAction({ kind: 'prompt' })).toEqual({ kind: 'prompt' })
    expect(parseAction({ kind: 'toolCall' })).toEqual({ kind: 'toolCall' })
    expect(parseAction({ kind: 'hero', op: 'sell', itemId: 'i3' })).toEqual({ kind: 'hero', op: 'sell', itemId: 'i3' })
    expect(parseAction({ kind: 'hero', op: 'upgrade', heroId: 'h1', slot: 'weapon' })).toEqual({
      kind: 'hero',
      op: 'upgrade',
      heroId: 'h1',
      slot: 'weapon',
    })
    expect(parseAction({ kind: 'hero', op: 'recruit', cls: 'mage' })).toEqual({ kind: 'hero', op: 'recruit', cls: 'mage' })
    expect(parseAction(null)).toBeNull()
    expect(parseAction([])).toBeNull()
    expect(parseAction({ kind: 'nuke' })).toBeNull()
    expect(parseAction({ kind: 'hero', op: 'delete' })).toBeNull()
    expect(parseAction({ kind: 'hero', op: 'recruit', cls: 'toString' })).toBeNull()
    expect(parseAction({ kind: 'hero', op: 'recruit', cls: '__proto__' })).toBeNull()
    expect(parseAction({ kind: 'hero', op: 'unequip', heroId: 'h1', slot: 'constructor' })).toBeNull()
    expect(parseAction({ kind: 'hero', op: 'sell', itemId: 'x'.repeat(65) })).toBeNull()
    expect(parseAction({ kind: 'hero', op: 'sell', itemId: 42 })).toBeNull()
    expect(parseAction(JSON.parse('{"__proto__": {"kind": "prompt"}}'))).toBeNull()
    expect(parseAction(Object.create({ kind: 'prompt' }))).toBeNull()
  })

  test('versions compare by number and builds hash the bundle', () => {
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0')).toBe(0)
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(buildId('a')).toMatch(/^[0-9a-f]{8}$/)
    expect(buildId('a')).not.toBe(buildId('b'))
  })
})

describe('world states', () => {
  test('with no world.json the daemon is empty, refuses actions and writes nothing', async () => {
    const dir = tempDir()
    await start(dir)
    const hello = (await call(dir, 'GET', '/hello')).body as Hello
    expect(hello.state).toBe('empty')
    expect(hello.build).toBe('b1')
    expect((await world(dir)).game).toBeNull()
    expect((await call(dir, 'POST', '/action', { kind: 'prompt' })).body).toEqual({ ok: false, error: 'not-ready' })
    expect(existsSync(dataFiles(dir).world)).toBe(false)
  })

  test('a seed with a save adopts it and writes world.json at once', async () => {
    const dir = tempDir()
    await start(dir)
    const save = { ...newGame(9), gold: 777 }
    expect((await call(dir, 'POST', '/seed', { game: save })).body).toEqual({ adopted: true, state: 'loaded' })
    expect((JSON.parse(readFileSync(dataFiles(dir).world, 'utf8')) as GameState).gold).toBe(777)
    expect((await world(dir)).game?.gold).toBe(777)
  })

  test('a seed without a save starts a new game', async () => {
    const dir = tempDir()
    await start(dir)
    expect((await call(dir, 'POST', '/seed', { game: null })).body).toEqual({ adopted: false, state: 'loaded' })
    expect((await world(dir)).game?.heroes).toHaveLength(1)
  })

  test('of two seeds at once exactly one is adopted', async () => {
    const dir = tempDir()
    await start(dir)
    const [a, b] = await Promise.all([
      call(dir, 'POST', '/seed', { game: { ...newGame(1), gold: 1 } }),
      call(dir, 'POST', '/seed', { game: { ...newGame(2), gold: 2 } }),
    ])
    const adopted = [a, b].filter(r => (r.body as { adopted: boolean }).adopted)
    expect(adopted).toHaveLength(1)
    const gold = (await world(dir)).game?.gold
    expect(gold === 1 || gold === 2).toBe(true)
  })

  test('an unreadable world.json is kept aside and never overwritten', async () => {
    const dir = tempDir()
    writeFileSync(dataFiles(dir).world, '{ not json')
    await start(dir)
    expect(((await call(dir, 'GET', '/hello')).body as Hello).state).toBe('empty')
    const kept = readdirSync(dir).filter(name => name.startsWith('world.unreadable-'))
    expect(kept).toHaveLength(1)
    expect(readFileSync(join(dir, kept[0]!), 'utf8')).toBe('{ not json')
  })

  test("a newer version's world.json locks the daemon, which never writes it", async () => {
    const dir = tempDir()
    const future = JSON.stringify({ version: 2, gold: 99_999 })
    writeFileSync(dataFiles(dir).world, future)
    const daemon = await start(dir, { stepMs: 10, saveMs: 10 })
    expect(((await call(dir, 'GET', '/hello')).body as Hello).state).toBe('locked')
    expect((await call(dir, 'POST', '/action', { kind: 'prompt' })).body).toEqual({ ok: false, error: 'locked' })
    expect((await call(dir, 'POST', '/seed', { game: newGame(1) })).body).toEqual({ adopted: false, state: 'locked' })
    await sleep(50)
    await daemon!.stop('test')
    expect(readFileSync(dataFiles(dir).world, 'utf8')).toBe(future)
  })
})

describe('actions', () => {
  test('an action applies exactly once and bumps the sequence', async () => {
    const dir = seeded(tempDir())
    await start(dir, { stepMs: 60_000 })
    const before = await world(dir)
    const reply = (await call(dir, 'POST', '/action', { kind: 'toolCall' })).body as { ok: boolean; seq: number }
    expect(reply).toEqual({ ok: true, seq: before.seq + 1 })
    expect((await world(dir)).game?.stats.toolCalls).toBe(1)
    await call(dir, 'POST', '/action', { kind: 'prompt' })
    expect((await world(dir)).game?.effects.map(e => e.kind)).toEqual(['rally'])
  })

  test("a hero op's own refusal comes back verbatim and changes nothing", async () => {
    const dir = seeded(tempDir())
    await start(dir, { stepMs: 60_000 })
    const before = await world(dir)
    const reply = (await call(dir, 'POST', '/action', { kind: 'hero', op: 'recruit', cls: 'mage' })).body
    expect(reply).toEqual({ ok: false, error: expect.stringContaining('vàng') })
    expect((await world(dir)).seq).toBe(before.seq)
  })

  test('bad bodies are refused and the daemon keeps serving', async () => {
    const dir = seeded(tempDir())
    await start(dir, { stepMs: 60_000 })
    expect((await call(dir, 'POST', '/action', '{"kind":"hero","op":"recruit","cls":"__proto__"}')).status).toBe(400)
    expect((await call(dir, 'POST', '/action', '{"__proto__":{"kind":"prompt"}}')).status).toBe(400)
    expect((await call(dir, 'POST', '/action', 'not json')).status).toBe(400)
    await call(dir, 'POST', '/action', { kind: 'hero', op: 'sell', itemId: 'x'.repeat(70 * 1024) }).catch(() => undefined)
    expect((await call(dir, 'GET', '/hello')).status).toBe(200)
    expect((await call(dir, 'GET', '/nope')).status).toBe(404)
  })

  test('combat runs on the clock and saves to world.json', async () => {
    const dir = seeded(tempDir())
    await start(dir, { stepMs: 10, saveMs: 30 })
    await sleep(120)
    const now = await world(dir)
    expect(now.seq).toBeGreaterThan(3)
    const saved = JSON.parse(readFileSync(dataFiles(dir).world, 'utf8')) as GameState
    expect(saved.seed).not.toBe(newGame(5).seed)
  })
})

describe('long-poll', () => {
  test('answers at once on another epoch or a newer sequence, else waits for a change', async () => {
    const dir = seeded(tempDir())
    await start(dir, { stepMs: 60_000, pollMs: 5000 })
    const first = await world(dir)
    const other = await world(dir, `?since=${first.seq}&epoch=other`)
    expect(other.epoch).toBe(first.epoch)
    const behind = await world(dir, `?since=${first.seq - 1}&epoch=${first.epoch}`)
    expect(behind.seq).toBe(first.seq)
    const t0 = Date.now()
    const waiting = world(dir, `?since=${first.seq}&epoch=${first.epoch}`)
    await sleep(100)
    await call(dir, 'POST', '/action', { kind: 'toolCall' })
    const woke = await waiting
    expect(woke.seq).toBe(first.seq + 1)
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  test('a quiet long-poll answers unchanged after pollMs', async () => {
    const dir = seeded(tempDir())
    await start(dir, { stepMs: 60_000, pollMs: 150 })
    const first = await world(dir)
    const t0 = Date.now()
    const same = await world(dir, `?since=${first.seq}&epoch=${first.epoch}`)
    expect(same.seq).toBe(first.seq)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140)
  })
})

describe('lock and lifecycle', () => {
  test('of two daemons racing for one directory exactly one serves', async () => {
    const dir = tempDir()
    const results = await Promise.all([start(dir), start(dir)])
    expect(results.filter(d => d !== null)).toHaveLength(1)
  })

  test('a second daemon sees the live one and steps aside', async () => {
    const dir = tempDir()
    const first = await start(dir)
    expect(first).not.toBeNull()
    expect(await start(dir)).toBeNull()
    expect(((await call(dir, 'GET', '/hello')).body as Hello).epoch).toBe(first!.epoch)
  })

  test('a stale lock naming a live but unrelated pid is taken over', async () => {
    const dir = tempDir()
    const files = dataFiles(dir)
    writeFileSync(files.lock, JSON.stringify({ pid: process.pid, epoch: 'old' }))
    writeFileSync(files.socket, '')
    const old = new Date(Date.now() - 60_000)
    utimesSync(files.lock, old, old)
    const daemon = await start(dir)
    expect(daemon).not.toBeNull()
    expect(JSON.parse(readFileSync(files.lock, 'utf8')).epoch).toBe(daemon!.epoch)
  })

  test('stopping saves, then removes the socket and the lock', async () => {
    const dir = seeded(tempDir())
    let exited = -1
    const daemon = await start(dir, { stepMs: 10, saveMs: 60_000, onExit: code => (exited = code) })
    await sleep(60)
    await daemon!.stop('test')
    const saved = JSON.parse(readFileSync(dataFiles(dir).world, 'utf8')) as GameState
    expect(saved.seed).not.toBe(newGame(5).seed)
    expect(existsSync(dataFiles(dir).socket)).toBe(false)
    expect(existsSync(dataFiles(dir).lock)).toBe(false)
    expect(exited).toBe(0)
  })

  test('a quiet daemon with no request open exits by itself', async () => {
    const dir = seeded(tempDir())
    let exited = -1
    await start(dir, { idleMs: 150, onExit: code => (exited = code) })
    await call(dir, 'GET', '/hello')
    await sleep(600)
    expect(exited).toBe(0)
    expect(existsSync(dataFiles(dir).socket)).toBe(false)
    running.splice(0)
  })

  test('an open long-poll keeps the daemon awake', async () => {
    const dir = seeded(tempDir())
    let exited = -1
    await start(dir, { stepMs: 60_000, idleMs: 150, pollMs: 700, onExit: code => (exited = code) })
    const first = await world(dir)
    const polling = world(dir, `?since=${first.seq}&epoch=${first.epoch}`)
    await sleep(500)
    expect(exited).toBe(-1)
    await polling
    await sleep(500)
    expect(exited).toBe(0)
    running.splice(0)
  })

  test('shutdown is refused from the same build or an older version, and accepted otherwise', async () => {
    const dir = seeded(tempDir())
    let exited = -1
    await start(dir, { onExit: code => (exited = code) })
    expect((await call(dir, 'POST', '/shutdown?build=b1&version=9.0.0')).body).toEqual({ ok: false, reason: 'same-build' })
    expect((await call(dir, 'POST', '/shutdown?build=b2&version=0.9.0')).body).toEqual({ ok: false, reason: 'older-version' })
    expect((await call(dir, 'POST', '/shutdown?build=b2&version=1.0.0')).body).toEqual({ ok: true })
    await sleep(100)
    expect(exited).toBe(0)
    running.splice(0)
  })

  test('the data directory must be ours and closed', async () => {
    const dir = tempDir()
    expect(startDaemon({ dataDir: 'relative/dir', build: 'b', version: '1.0.0', log: () => undefined })).rejects.toThrow()
    await start(dir)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(dataFiles(dir).socket).mode & 0o777).toBe(0o600)
  })
})

describe('bundle', () => {
  test('dist/launch.js detaches a daemon that answers on the socket and exits when idle', async () => {
    const dir = tempDir()
    const launched = await new Promise<string>((resolve, reject) => {
      const child = spawn('node', [join(import.meta.dir, '..', 'dist', 'launch.js'), '--detach', dir], {
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TT_IDLE_MS: '400' },
      })
      let out = ''
      child.stdout.on('data', (c: Buffer) => (out += c.toString()))
      child.on('exit', code => (code === 0 ? resolve(out) : reject(new Error(`launch exited ${code}`))))
    })
    expect(JSON.parse(launched).launched).toBeGreaterThan(0)
    let hello: Hello | null = null
    for (let i = 0; i < 30 && hello === null; i += 1) {
      await sleep(100)
      hello = await call(dir, 'GET', '/hello').then(r => r.body as Hello, () => null)
    }
    expect(hello?.state).toBe('empty')
    await sleep(1800)
    expect(existsSync(dataFiles(dir).socket)).toBe(false)
    expect(existsSync(dataFiles(dir).lock)).toBe(false)
  })
})
