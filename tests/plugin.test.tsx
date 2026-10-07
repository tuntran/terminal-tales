import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { GameState, Item } from '../types'

import { applyDaemonAction, buildId, parseAction, type WorldState } from '../daemon/protocol'
import { MIGRATED_KEY, SAVE_KEY, SAVE_MS, STEP_MS, UNREADABLE_KEY } from '../hooks/register'
import { FRAME_MS } from '../src/ui/animation'
import { newGame, step } from '../src/game/engine'
import { SOLO_RETRY_MS } from '../src/sync/client'

const SURFACES = ['terminal', 'desktop'] as const
const HOME = '/home/tt'
const BUNDLE = 'console.log("daemon")'

/** The daemon beneath the plugin, in memory: what it holds and what it was asked. */
type FakeDaemon = {
  isRunning: boolean
  state: WorldState
  game: GameState | null
  epoch: string
  seq: number
  build: string
  version: string
  /** True to leave every `/action` unanswered, as a hung daemon would. */
  isHung: boolean
  seeds: unknown[]
  actions: unknown[]
  openPolls: number
  /** Changes the world as a combat step or another session would. */
  change: (fn: (g: GameState) => GameState) => void
  /** Starts over as a new process: a new epoch, counting from zero. */
  restart: (game: GameState | null) => void
}

type World = {
  clock: ReturnType<typeof mock.clock>
  store: Map<string, unknown>
  daemon: FakeDaemon
  /** The commands the plugin ran, with how. */
  runs: { argv: readonly string[]; cwd?: string }[]
  /** The files the plugin wrote. */
  writes: string[]
  toasts: string[]
  opened: string[]
  commands: string[]
  /** The game as the plugin last wrote it to session state. */
  game: () => GameState
  /** The game the plugin shows once what it set going has settled. */
  shown: () => Promise<GameState>
  mode: () => unknown
}

type WorldOptions = {
  /** What `$.store` holds under the save key at the start. */
  save?: unknown
  /** A daemon already running with this world; absent, none runs until launched. */
  running?: GameState | null
  /** False when neither node nor bun can be found. */
  hasRuntime?: boolean
}

/** The engine beneath the plugin: the nouns it calls, answered from memory. */
function world(on: On, options: WorldOptions = {}): World {
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { HOME })
  const store = new Map<string, unknown>(options.save === undefined ? [] : [[SAVE_KEY, options.save]])
  let latest: GameState | null = null
  let latestMode: unknown = undefined
  // Long-polls waiting for the world to change.
  const waiting = new Set<() => void>()
  const wake = () => {
    for (const resolve of waiting) resolve()
    waiting.clear()
  }
  let epochs = 0
  const daemon: FakeDaemon = {
    isRunning: options.running !== undefined,
    state: options.running ? 'loaded' : 'empty',
    game: options.running ?? null,
    epoch: 'e0',
    seq: 0,
    build: buildId(BUNDLE),
    version: '0.1.0',
    isHung: false,
    seeds: [],
    actions: [],
    openPolls: 0,
    change: fn => {
      if (daemon.game === null) return
      daemon.game = fn(daemon.game)
      daemon.seq += 1
      wake()
    },
    restart: game => {
      epochs += 1
      daemon.isRunning = true
      daemon.epoch = `e${epochs}`
      daemon.seq = 0
      daemon.game = game
      daemon.state = game === null ? 'empty' : 'loaded'
      wake()
    },
  }
  void (async () => {
    for (;;) {
      await clock.sleep(STEP_MS)
      if (daemon.isRunning && daemon.state === 'loaded') daemon.change(step)
    }
  })()
  const w: World = {
    clock,
    store,
    daemon,
    runs: [],
    writes: [],
    toasts: [],
    opened: [],
    commands: [],
    game: () => {
      if (latest === null) throw new Error('the plugin wrote no game')
      return latest
    },
    shown: async () => {
      await clock.settle()
      return w.game()
    },
    mode: () => latestMode,
  }
  on('store.get', (_$, e) => ({ value: structuredClone(store.get(e.key)) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, structuredClone(e.value))
    return { value: undefined } as never
  })
  on('state.set', (_$, e, next) => {
    if (e.key === 'game') latest = e.value as GameState
    if (e.key === 'syncMode') latestMode = e.value
    return next(e)
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => {
    w.commands.push(e.name)
    return { value: undefined } as never
  })
  on('ui.open', (_$, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/dist/server.js')) return { value: BUNDLE } as never
    if (e.path.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ version: '0.1.0' }) } as never
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.write', (_$, e) => {
    w.writes.push(e.path)
    return { value: undefined } as never
  })
  on('process.run', (_$, e) => {
    w.runs.push({ argv: e.argv, cwd: e.init?.cwd })
    const [cmd, arg] = e.argv
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (cmd === 'mkdir') return ok()
    if (cmd === 'which') {
      return options.hasRuntime === false ? ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never) : ok(`/usr/bin/${arg}\n`)
    }
    if (arg?.endsWith('/dist/launch.js')) {
      if (!daemon.isRunning) daemon.restart(daemon.game)
      return ok('{"launched":4242}\n')
    }
    throw new Error(`unexpected command ${e.argv.join(' ')}`)
  })
  on('http.fetch', async (_$, e) => {
    if (!daemon.isRunning) throw new Error(`connect ENOENT ${e.init?.socketPath}`)
    const url = new URL(e.url)
    const reply = (body: unknown, status = 200) =>
      ({ value: { status, ok: status === 200, headers: {}, text: JSON.stringify(body) } }) as never
    const route = `${e.init?.method ?? 'GET'} ${url.pathname}`
    switch (route) {
      case 'GET /hello':
        return reply({ build: daemon.build, version: daemon.version, pid: 1, epoch: daemon.epoch, state: daemon.state })
      case 'POST /seed': {
        const sent = (JSON.parse(e.init?.body ?? '{}') as { game: GameState | null }).game
        daemon.seeds.push(sent)
        if (daemon.state !== 'empty') return reply({ adopted: false, state: daemon.state })
        daemon.state = 'loaded'
        daemon.game = sent ?? newGame(77)
        daemon.seq += 1
        wake()
        return reply({ adopted: sent !== null, state: daemon.state })
      }
      case 'POST /action': {
        if (daemon.isHung) return new Promise<never>(() => undefined)
        const action = parseAction(JSON.parse(e.init?.body ?? 'null'))
        daemon.actions.push(action)
        if (action === null) return reply({ ok: false, error: 'bad-action' }, 400)
        if (daemon.game === null) return reply({ ok: false, error: 'not-ready' })
        const result = applyDaemonAction(daemon.game, action)
        if (result.error !== undefined) return reply({ ok: false, error: result.error })
        daemon.change(() => result.state)
        return reply({ ok: true, seq: daemon.seq })
      }
      case 'GET /world': {
        const since = Number(url.searchParams.get('since'))
        if (url.searchParams.get('epoch') === daemon.epoch && since >= daemon.seq) {
          daemon.openPolls += 1
          await Promise.race([new Promise<void>(resolve => waiting.add(resolve)), clock.sleep(10_000)])
          daemon.openPolls -= 1
          if (!daemon.isRunning) throw new Error('socket hang up')
        }
        return reply({ epoch: daemon.epoch, seq: daemon.seq, state: daemon.state, game: daemon.game })
      }
      case 'POST /shutdown':
        return reply({ ok: false, reason: 'same-build' })
      default:
        return reply({ error: 'not-found' }, 404)
    }
  })
  return w
}

/** Starts a session and lets it find, or start, the daemon and show its world. */
async function start($: Engine, w?: World): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  if (w !== undefined) await w.clock.advance(1000)
}

async function end($: Engine): Promise<void> {
  await $.session.end({ reason: 'other', sessionId: 's', resume: { kind: 'none' } } as never)
}

function item(id: string, slot: Item['slot']): Item {
  return { id, name: `Đồ ${id}`, slot, rarity: 'rare', stage: 1, level: 0 }
}

/** A Bash call whose result the test's own hook answers. */
function answerBash(on: On, text: string, isError = false): void {
  on('tool.call', { tool: 'Bash' }, () =>
    isError
      ? { isError: true as const, result: text, text }
      : { result: { stdout: text, stderr: '', interrupted: false }, text },
  )
}

describe('daemon', () => {
  test('a first session launches the daemon from its data directory and shows the new game', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(w.commands).toContain('hero')
    const launch = w.runs.find(r => r.argv[1]?.endsWith('/dist/launch.js'))
    expect(launch?.argv[0]).toBe('/usr/bin/node')
    const dataDir = launch?.argv[3] ?? ''
    expect(dataDir).toMatch(new RegExp(`^${HOME}/\\.claude/tt/[0-9a-f]{8}$`))
    expect(launch?.argv).toEqual(['/usr/bin/node', expect.stringContaining('/dist/launch.js'), '--detach', dataDir])
    // Never the session's directory: bun would run its bunfig preload.
    expect(w.runs.every(r => r.cwd === dataDir || r.cwd === '/')).toBe(true)
    expect(w.daemon.seeds).toEqual([null])
    expect(w.game().heroes).toHaveLength(1)
    expect(w.game()).toEqual(w.daemon.game!)
    expect(w.mode()).toBe('daemon')
    expect(w.writes).toEqual([])
  })

  test('a running daemon is reused: nothing is launched or seeded', async ($, on) => {
    const running = { ...newGame(5), gold: 4321 }
    const w = world(on, { running })
    await start($, w)
    expect(w.runs.some(r => r.argv[1]?.endsWith('/dist/launch.js'))).toBe(false)
    expect(w.daemon.seeds).toEqual([])
    expect(w.game().gold).toBe(4321)
  })

  test('the old save is handed to the daemon exactly once', async ($, on) => {
    const save = { ...newGame(99), gold: 4321 }
    const w = world(on, { save })
    await start($, w)
    expect(w.daemon.seeds).toEqual([save])
    expect(w.game().gold).toBe(4321)
    expect(w.store.get(MIGRATED_KEY)).toBe(true)
    expect(w.store.get(SAVE_KEY)).toEqual(save)
    // The daemon comes back empty: the save it already took is not sent again.
    w.daemon.isRunning = false
    w.daemon.restart(null)
    await w.clock.advance(1000)
    expect(w.daemon.seeds).toEqual([save, null])
  })

  test('the world follows the daemon, and a restarted one counts again from zero', async ($, on) => {
    const w = world(on, { running: newGame(5) })
    await start($, w)
    w.daemon.change(g => ({ ...g, gold: 10 }))
    w.daemon.change(g => ({ ...g, gold: 20 }))
    expect((await w.shown()).gold).toBe(20)
    w.daemon.restart({ ...newGame(6), gold: 7 })
    await w.clock.advance(1000)
    expect(w.game().gold).toBe(7)
  })

  test('a second session.start leaves one poll loop', async ($, on) => {
    const w = world(on, { running: newGame(5) })
    await start($, w)
    await start($, w)
    // The first loop's poll was already out; once it answers, that loop stops.
    await w.clock.advance(STEP_MS * 3)
    expect(w.daemon.openPolls).toBe(1)
  })

  test('a killed daemon is started again', async ($, on) => {
    const w = world(on)
    await start($, w)
    const gold = w.game().gold
    w.daemon.isRunning = false
    w.daemon.change(g => g)
    await w.clock.advance(1000)
    expect(w.runs.filter(r => r.argv[1]?.endsWith('/dist/launch.js'))).toHaveLength(2)
    expect(w.daemon.isRunning).toBe(true)
    expect(w.game().gold).toBe(gold)
  })

  test('the tool.call hook returns at once while the daemon hangs', async ($, on) => {
    const w = world(on, { running: newGame(5) })
    answerBash(on, 'ok')
    await start($, w)
    w.daemon.isHung = true
    // The clock stands still: a hook that waited on the daemon would never return.
    const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(ran.text).toBe('ok')
  })

  test("a newer version's world locks this session: a toast, and nothing is written", async ($, on) => {
    const w = world(on, { running: null })
    w.daemon.state = 'locked'
    await start($, w)
    expect(w.mode()).toBe('locked')
    expect(w.toasts.some(t => t.includes('mới hơn'))).toBe(true)
    await w.clock.advance(SAVE_MS * 2)
    await end($)
    expect(w.store.get(SAVE_KEY)).toBeUndefined()
    expect(w.daemon.seeds).toEqual([])
  })
})

describe('solo', () => {
  test('without node or bun the session plays its own game from the store and says so once', async ($, on) => {
    const save = { ...newGame(99), gold: 4321 }
    const w = world(on, { save, hasRuntime: false })
    await start($, w)
    expect(w.mode()).toBe('solo')
    expect(w.game().heroes[0]!.name).toBe(save.heroes[0]!.name)
    expect(w.toasts.filter(t => t.includes('node hay bun'))).toHaveLength(1)
    const before = w.game()
    await w.clock.advance(SAVE_MS)
    expect(w.game().seed).not.toBe(before.seed)
    expect((w.store.get(SAVE_KEY) as GameState).seed).not.toBe(save.seed)
    expect(w.store.get(MIGRATED_KEY)).toBe(false)
    expect(w.writes.some(path => path.endsWith('world.json'))).toBe(false)
    await w.clock.advance(SOLO_RETRY_MS)
    expect(w.toasts.filter(t => t.includes('node hay bun'))).toHaveLength(1)
  })

  test('an unreadable save is kept aside before a fresh solo game starts', async ($, on) => {
    const w = world(on, { save: { version: 1, heroes: 'garbage' }, hasRuntime: false })
    await start($, w)
    expect(w.game().gold).toBe(0)
    expect(w.store.get(UNREADABLE_KEY)).toEqual({ version: 1, heroes: 'garbage' })
    await w.clock.advance(SAVE_MS)
    expect((w.store.get(SAVE_KEY) as GameState).version).toBe(1)
  })

  test("a newer version's save is never overwritten by a solo game", async ($, on) => {
    const future = { version: 2, gold: 99_999 }
    const w = world(on, { save: future, hasRuntime: false })
    await start($, w)
    await w.clock.advance(SAVE_MS * 2)
    await end($)
    expect(w.store.get(SAVE_KEY)).toEqual(future)
    expect(w.toasts.some(t => t.includes('mới hơn'))).toBe(true)
  })

  test('actions apply to the solo game, and session end saves it', async ($, on) => {
    const w = world(on, { hasRuntime: false })
    answerBash(on, 'ok')
    await start($, w)
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(w.game().stats.toolCalls).toBe(1)
    await end($)
    expect((w.store.get(SAVE_KEY) as GameState).stats.toolCalls).toBe(1)
  })

  test('a solo session that finds the daemon later hands it the solo game', async ($, on) => {
    const options: WorldOptions = { hasRuntime: false }
    const w = world(on, options)
    answerBash(on, 'ok')
    await start($, w)
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    options.hasRuntime = true
    await w.clock.advance(SOLO_RETRY_MS + 1000)
    expect(w.mode()).toBe('daemon')
    expect((w.daemon.seeds[0] as GameState).stats.toolCalls).toBe(1)
    expect(w.game().stats.toolCalls).toBe(1)
  })
})

describe('coding activity', () => {
  test('a tool call rewards the party and runs unchanged', async ($, on) => {
    const w = world(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: { ok: true }, text: 'file' }) as never)
    await start($, w)
    const before = (await w.shown())
    const ran = await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    expect(ran.text).toBe('file')
    expect((await w.shown()).stats.toolCalls).toBe(before.stats.toolCalls + 1)
    expect((await w.shown()).gold).toBeGreaterThan(before.gold)
  })

  test('a passing test run pays out, drops an item and toasts', async ($, on) => {
    const w = world(on)
    answerBash(on, 'Tests: 8 passed, 8 total')
    await start($, w)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect((await w.shown()).stats.testPasses).toBe(1)
    expect((await w.shown()).stats.toolCalls).toBe(1)
    expect((await w.shown()).inventory.length).toBeGreaterThanOrEqual(1)
    expect(w.toasts.some(t => t.includes('test xanh'))).toBe(true)
  })

  test('a failing test run is no test pass', async ($, on) => {
    const w = world(on)
    answerBash(on, 'Exit code 1\nTests: 1 failed, 7 passed', true)
    await start($, w)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect((await w.shown()).stats.testPasses).toBe(0)
    expect((await w.shown()).stats.toolCalls).toBe(1)
  })

  test('a command that is not a test run is no test pass', async ($, on) => {
    const w = world(on)
    answerBash(on, 'ok')
    await start($, w)
    await $.tool.call({ tool: 'Bash', command: 'ls -la' })
    expect((await w.shown()).stats.testPasses).toBe(0)
  })
})

describe('user actions', () => {
  const effects = (g: GameState) => g.effects.map(e => e.kind)

  test("the user's own prompt rallies the party; a plugin's or a peer's does not", async ($, on) => {
    const w = world(on)
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    await start($, w)
    await $.prompt.submit({ text: 'hi', origin: { kind: 'sdk' } } as never)
    expect(effects((await w.shown()))).toEqual([])
    await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as never)
    expect(effects((await w.shown()))).toEqual(['rally'])
  })

  test('a finished main turn heals the party; an aborted one enrages the monster and toasts', async ($, on) => {
    const w = world(on)
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await start($, w)
    const hurt = (await w.shown())
    await $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
    expect((await w.shown()).log.at(-1)).toContain('Tiếp sức')
    await $.turn.complete({ turnId: 't2', reason: 'answer', answer: '', durationMs: 1, isAborted: false, agentId: 'a1' })
    expect((await w.shown()).log.filter(l => l.includes('Tiếp sức'))).toHaveLength(1)
    await $.turn.complete({ turnId: 't3', reason: 'aborted', answer: '', durationMs: 1, isAborted: true })
    expect(effects((await w.shown()))).toEqual(['enrage'])
    expect(w.toasts.some(t => t.includes('nổi giận'))).toBe(true)
    expect(hurt.gold).toBeLessThanOrEqual((await w.shown()).gold)
  })

  test('a manual compact calms the party; an automatic one does not', async ($, on) => {
    const w = world(on)
    const transcript = [{ role: 'user', text: 'hi', toolUses: [] }]
    on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'tóm tắt', toolUses: [] }] }))
    await start($, w)
    await $.session.compact({ trigger: 'auto', messages: transcript } as never)
    expect((await w.shown()).log.some(l => l.includes('Tĩnh tâm'))).toBe(false)
    await $.session.compact({ trigger: 'manual', messages: transcript } as never)
    expect((await w.shown()).log.at(-1)).toContain('Tĩnh tâm')
  })

  test('a successful git commit raises a milestone shield', async ($, on) => {
    const w = world(on)
    answerBash(on, '[main abc123] feat: x')
    await start($, w)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })
    expect(effects((await w.shown()))).toEqual(['milestone'])
  })

  test('a failing command regenerates the monster; an interrupted one does not', async ($, on) => {
    const w = world(on)
    let text = 'Exit code 1\nboom'
    on('tool.call', { tool: 'Bash' }, () => ({ isError: true as const, result: text, text }))
    await start($, w)
    await $.tool.call({ tool: 'Bash', command: 'false' })
    expect((await w.shown()).log.at(-1)).toContain('tái sinh')
    expect(w.toasts.some(t => t.includes('tái sinh'))).toBe(true)
    text = 'Exit code 137\n[Request interrupted by user for tool use]'
    const before = (await w.shown()).log.filter(l => l.includes('tái sinh')).length
    await $.tool.call({ tool: 'Bash', command: 'ping -c 40 127.0.0.1' })
    expect((await w.shown()).log.filter(l => l.includes('tái sinh'))).toHaveLength(before)
  })

  /**
   * A Bash call the engine's check puts to the mode's decider, answered as
   * `text` says; with `dialog` the decider is the user's dialog, without it
   * auto mode's classifier, which raises no PermissionRequest.
   */
  function answerAsked(on: On, text: string, isError: boolean): void {
    on('tool.check', () => ({ decision: 'ask' as const }))
    on('classic.PermissionRequest', () => ({}))
    on('tool.call', { tool: 'Bash' }, () =>
      isError ? { isError: true as const, result: text, text } : { result: { stdout: text, stderr: '', interrupted: false }, text },
    )
  }

  async function askedBash($: Engine, dialog = true): Promise<void> {
    const input = { command: 'mkdir x' }
    await $.tool.check({ tool: 'Bash', input, tool_use_id: 'toolu_1' } as never)
    if (dialog) await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: input } as never)
    await $.tool.call({ tool: 'Bash', ...input, tool_use_id: 'toolu_1' } as never)
  }

  test('allowing a call in the dialog grants trust', async ($, on) => {
    const w = world(on)
    answerAsked(on, 'ok', false)
    await start($, w)
    await askedBash($)
    expect(effects((await w.shown()))).toEqual(['trust'])
  })

  test('rejecting a call grants the monster stoneskin, and only that', async ($, on) => {
    const w = world(on)
    answerAsked(on, "The user doesn't want to proceed with this tool use. The tool use was rejected", true)
    await start($, w)
    await askedBash($)
    expect(effects((await w.shown()))).toEqual(['stoneskin'])
    expect((await w.shown()).log.some(l => l.includes('tái sinh'))).toBe(false)
  })

  test('a call the auto mode decided without a dialog grants nothing', async ($, on) => {
    const w = world(on)
    answerAsked(on, 'ok', false)
    await start($, w)
    await askedBash($, false)
    expect(effects((await w.shown()))).toEqual([])
  })

  test('the band shows both sides\' effects', async ($, on) => {
    const w = world(on)
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await start($, w)
    await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as never)
    await $.turn.complete({ turnId: 't', reason: 'aborted', answer: '', durationMs: 1, isAborted: true })
    expect(effects((await w.shown()))).toEqual(['rally', 'enrage'])
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'terminal-tales',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 140, scroll: { top: 0, bodyRows: 19, contentRows: 0 }, view: {} } as never,
      })
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
      expect(texts, surface).toContain('Hô khiến')
      expect(texts, surface).toContain('Nổi giận')
      await ui.unmount()
    }
  })
})

describe('band', () => {
  test('draws the party and the monster above the prompt at every width', async ($, on) => {
    const w = world(on)
    await start($, w)
    const g = w.game()
    for (const surface of SURFACES) {
      for (const [bodyColumns, maxRows] of [[120, 10], [60, 10], [30, 10], [120, 3]] as const) {
        const ui = await $.ui.mount({
          plugin: 'terminal-tales',
          surface,
          component: 'AbovePrompt',
          props: {
            hasSurvey: false,
            isWorking: false,
            maxRows,
            bodyColumns,
            scroll: { top: 0, bodyRows: 9, contentRows: 0 },
            view: {},
          } as never,
        })
        const found = await ui.findAll({ type: 'Text' })
        const texts = found.map(t => t.text).join('\n')
        if (maxRows < 5) expect(found.length, 'short band draws one line').toBe(1)
        expect(texts, `${surface} ${bodyColumns}`).toContain(g.monster.name)
        expect(texts, `${surface} ${bodyColumns}`).toContain(g.heroes[0]!.name)
        await ui.unmount()
      }
    }
  })
})

describe('pixel band', () => {
  const props = (bodyColumns: number, maxRows: number) =>
    ({
      hasSurvey: false,
      isWorking: false,
      maxRows,
      bodyColumns,
      scroll: { top: 0, bodyRows: maxRows - 1, contentRows: 0 },
      view: {},
    }) as never

  test('the terminal draws the fight as one pixel picture with the info beside it', async ($, on) => {
    const w = world(on)
    await start($, w)
    const ui = await $.ui.mount({ plugin: 'terminal-tales', surface: 'terminal', component: 'AbovePrompt', props: props(140, 20) })
    const picture = await ui.find({ type: 'Raster' })
    expect(picture).toBeDefined()
    const { columns, rows, cells } = picture!.props as { columns: number; rows: number; cells: string }
    expect(columns).toBeLessThanOrEqual(140)
    expect(cells.length).toBe(Math.ceil((columns * rows * 12) / 3) * 4)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(texts).toContain(w.game().monster.name)
    await ui.unmount()
  })

  test('a narrower terminal puts one summary line under the picture', async ($, on) => {
    const w = world(on)
    await start($, w)
    const ui = await $.ui.mount({ plugin: 'terminal-tales', surface: 'terminal', component: 'AbovePrompt', props: props(90, 20) })
    expect(await ui.find({ type: 'Raster' })).toBeDefined()
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('')).toContain(w.game().heroes[0]!.name)
    await ui.unmount()
  })

  test('the mounted picture animates in place through blits of the same size', async ($, on) => {
    const w = world(on)
    const blits: { key: string; cells: string }[] = []
    on('ui.blit', (_$, e) => {
      if ('cells' in e) blits.push({ key: e.key, cells: e.cells })
      return { value: {} } as never
    })
    await start($, w)
    const ui = await $.ui.mount({ plugin: 'terminal-tales', surface: 'terminal', component: 'AbovePrompt', props: props(140, 20) })
    const mounted = (await ui.find({ type: 'Raster' }))!.props as { cells: string }
    await w.clock.advance(FRAME_MS * 30)
    expect(blits.length).toBeGreaterThanOrEqual(20)
    expect(blits.every(b => b.key === 'scene' && b.cells.length === mounted.cells.length)).toBe(true)
    expect(new Set(blits.map(b => b.cells)).size).toBeGreaterThan(5)
    await ui.unmount()
  })

  test('a short band and the desktop fall back to ASCII', async ($, on) => {
    const w = world(on)
    await start($, w)
    for (const [surface, maxRows] of [['terminal', 8], ['desktop', 20]] as const) {
      const ui = await $.ui.mount({ plugin: 'terminal-tales', surface, component: 'AbovePrompt', props: props(140, maxRows) })
      expect(await ui.find({ type: 'Raster' }), `${surface} ${maxRows}`).toBeUndefined()
      await ui.unmount()
    }
  })
})

describe('/hero pane', () => {
  function openPane($: Engine, surface: (typeof SURFACES)[number]) {
    return $.ui.mount({
      plugin: 'terminal-tales',
      surface,
      component: 'Pane',
      requestId: 'hero',
      props: {
        title: 'Terminal Tales',
        isFocused: true,
        bodyColumns: 80,
        placement: 'inline',
        scroll: { top: 0, bodyRows: 30, contentRows: 0 },
        view: {},
      } as never,
    })
  }

  test('the command opens the pane', async ($, on) => {
    const w = world(on)
    await start($, w)
    const result = await $.command.run({ command: 'hero', args: '', origin: { kind: 'user' }, presentation: {} } as never)
    expect(w.opened).toEqual(['hero'])
    expect(result).toMatchObject({ text: expect.stringContaining('Terminal Tales') })
  })

  for (const surface of SURFACES) {
    test(`equip, upgrade, sell, recruit and select through its buttons (${surface})`, async ($, on) => {
      const rich = { ...newGame(5), gold: 100_000, inventory: [item('a', 'weapon'), item('b', 'armor')] }
      const w = world(on, { running: rich })
      await start($, w)
      const ui = await openPane($, surface)

      await ui.press({ key: 'equip:a' })
      expect((await w.shown()).heroes[0]!.gear.weapon?.id).toBe('a')

      await ui.press({ key: 'sell:b' })
      expect((await w.shown()).inventory.some(it => it.id === 'b')).toBe(false)

      await ui.press({ key: 'upg:weapon' })
      expect((await w.shown()).heroes[0]!.gear.weapon?.level).toBe(1)

      await ui.press({ key: 'rec:mage' })
      expect((await w.shown()).heroes.map(hero => hero.cls)).toEqual(['warrior', 'mage'])

      await ui.press({ key: 'sel:1' })
      expect((await ui.find({ key: 'sel:1' }))?.props.variant).toBe('primary')
      await ui.unmount()
    })
  }

  test('an action short of gold toasts why and changes nothing', async ($, on) => {
    const w = world(on)
    await start($, w)
    const ui = await openPane($, 'terminal')
    const before = (await w.shown())
    await ui.press({ key: 'rec:ranger' })
    expect((await w.shown()).heroes).toHaveLength(before.heroes.length)
    expect(w.toasts.some(t => t.includes('vàng'))).toBe(true)
    await ui.unmount()
  })
})
