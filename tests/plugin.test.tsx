import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { GameState, Item } from '../types'

import { REV_KEY, SAVE_KEY, SAVE_MS, STEP_MS, UNREADABLE_KEY } from '../hooks/register'
import { FRAME_MS } from '../src/ui/animation'
import { newGame } from '../src/game/engine'

const SURFACES = ['terminal', 'desktop'] as const

type World = {
  clock: ReturnType<typeof mock.clock>
  store: Map<string, unknown>
  toasts: string[]
  opened: string[]
  commands: string[]
  /** The game as the plugin last wrote it to session state. */
  game: () => GameState
}

/** The engine beneath the plugin: the nouns it calls, answered from memory. */
function world(on: On, save?: unknown): World {
  const clock = mock.clock(on, { now: 1_000 })
  const store = new Map<string, unknown>(save === undefined ? [] : [['save', save]])
  let latest: GameState | null = null
  const w: World = {
    clock,
    store,
    toasts: [],
    opened: [],
    commands: [],
    game: () => {
      if (latest === null) throw new Error('the plugin wrote no game')
      return latest
    },
  }
  on('store.get', (_$, e) => ({ value: structuredClone(store.get(e.key)) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, structuredClone(e.value))
    return { value: undefined } as never
  })
  on('state.set', (_$, e, next) => {
    if (e.key === 'game') latest = e.value as GameState
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
  return w
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
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

describe('session', () => {
  test('a first session starts a new game, saves it and registers /hero', async ($, on) => {
    const w = world(on)
    await start($)
    expect(w.game().heroes).toHaveLength(1)
    expect(w.store.get('save')).toEqual(w.game())
    expect(w.commands).toContain('hero')
  })

  test('a later session loads the saved game', async ($, on) => {
    const w = world(on, { ...newGame(99), gold: 4321 })
    await start($)
    await w.clock.advance(STEP_MS)
    expect(w.game().gold).toBeGreaterThanOrEqual(4321)
    expect(w.game().heroes[0]!.name).toBe(newGame(99).heroes[0]!.name)
  })

  test('an unreadable save is kept aside before a fresh game starts', async ($, on) => {
    const w = world(on, { version: 1, heroes: 'garbage' })
    await start($)
    expect(w.game().gold).toBe(0)
    expect(w.store.get(UNREADABLE_KEY)).toEqual({ version: 1, heroes: 'garbage' })
    expect((w.store.get(SAVE_KEY) as GameState).version).toBe(1)
  })

  test("a newer version's save is never overwritten", async ($, on) => {
    const future = { version: 2, gold: 99_999 }
    const w = world(on, future)
    await start($)
    await w.clock.advance(SAVE_MS * 2)
    await $.session.end({ reason: 'other', sessionId: 's', resume: { kind: 'none' } } as never)
    expect(w.store.get(SAVE_KEY)).toEqual(future)
    expect(w.toasts.some(t => t.includes('mới hơn'))).toBe(true)
  })

  test("another session's newer save wins and this session's rewards are replayed onto it", async ($, on) => {
    const w = world(on, newGame(31))
    answerBash(on, 'Tests: 3 passed')
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    // Meanwhile another session saved a richer game.
    const theirs = { ...newGame(31), gold: 50_000, stage: 7 }
    w.store.set(SAVE_KEY, theirs)
    w.store.set(REV_KEY, 42)
    await w.clock.advance(SAVE_MS)
    const saved = w.store.get(SAVE_KEY) as GameState
    expect(w.store.get(REV_KEY)).toBe(43)
    expect(saved.stage).toBe(7)
    expect(saved.gold).toBeGreaterThan(50_000)
    expect(saved.stats.testPasses).toBe(1)
    expect(saved.stats.toolCalls).toBe(1)
    expect(w.game().stage).toBe(7)
  })

  test('saves in a row from one session bump the revision without conflict', async ($, on) => {
    const w = world(on)
    await start($)
    const first = w.store.get(REV_KEY) as number
    await w.clock.advance(SAVE_MS * 3)
    expect(w.store.get(REV_KEY)).toBe(first + 3)
  })

  test('combat runs on the clock and progress is saved', async ($, on) => {
    const w = world(on)
    await start($)
    const before = w.game()
    await w.clock.advance(STEP_MS * 40)
    expect(w.game().seed).not.toBe(before.seed)
    await w.clock.advance(SAVE_MS)
    expect((w.store.get('save') as GameState).seed).toBe(w.game().seed)
  })

  test('session end writes the save', async ($, on) => {
    const w = world(on)
    await start($)
    await w.clock.advance(STEP_MS * 3)
    await $.session.end({ reason: 'other', sessionId: 's', resume: { kind: 'none' } } as never)
    expect((w.store.get('save') as GameState).seed).toBe(w.game().seed)
  })
})

describe('coding activity', () => {
  test('a tool call rewards the party and runs unchanged', async ($, on) => {
    const w = world(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: { ok: true }, text: 'file' }) as never)
    await start($)
    const before = w.game()
    const ran = await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    expect(ran.text).toBe('file')
    expect(w.game().stats.toolCalls).toBe(before.stats.toolCalls + 1)
    expect(w.game().gold).toBeGreaterThan(before.gold)
  })

  test('a passing test run pays out, drops an item and toasts', async ($, on) => {
    const w = world(on)
    answerBash(on, 'Tests: 8 passed, 8 total')
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(w.game().stats.testPasses).toBe(1)
    expect(w.game().stats.toolCalls).toBe(1)
    expect(w.game().inventory.length).toBeGreaterThanOrEqual(1)
    expect(w.toasts.some(t => t.includes('test xanh'))).toBe(true)
  })

  test('a failing test run is no test pass', async ($, on) => {
    const w = world(on)
    answerBash(on, 'Exit code 1\nTests: 1 failed, 7 passed', true)
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(w.game().stats.testPasses).toBe(0)
    expect(w.game().stats.toolCalls).toBe(1)
  })

  test('a command that is not a test run is no test pass', async ($, on) => {
    const w = world(on)
    answerBash(on, 'ok')
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'ls -la' })
    expect(w.game().stats.testPasses).toBe(0)
  })
})

describe('band', () => {
  test('draws the party and the monster above the prompt at every width', async ($, on) => {
    const w = world(on)
    await start($)
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
    await start($)
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
    await start($)
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
    await start($)
    const ui = await $.ui.mount({ plugin: 'terminal-tales', surface: 'terminal', component: 'AbovePrompt', props: props(140, 20) })
    const mounted = (await ui.find({ type: 'Raster' }))!.props as { cells: string }
    await w.clock.advance(FRAME_MS * 30)
    expect(blits.length).toBeGreaterThanOrEqual(20)
    expect(blits.every(b => b.key === 'scene' && b.cells.length === mounted.cells.length)).toBe(true)
    expect(new Set(blits.map(b => b.cells)).size).toBeGreaterThan(5)
    await ui.unmount()
  })

  test('a short band and the desktop fall back to ASCII', async ($, on) => {
    world(on)
    await start($)
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
    await start($)
    const result = await $.command.run({ command: 'hero', args: '', origin: { kind: 'user' }, presentation: {} } as never)
    expect(w.opened).toEqual(['hero'])
    expect(result).toMatchObject({ text: expect.stringContaining('Terminal Tales') })
  })

  for (const surface of SURFACES) {
    test(`equip, upgrade, sell, recruit and select through its buttons (${surface})`, async ($, on) => {
      const rich = { ...newGame(5), gold: 100_000, inventory: [item('a', 'weapon'), item('b', 'armor')] }
      const w = world(on, rich)
      await start($)
      const ui = await openPane($, surface)

      await ui.press({ key: 'equip:a' })
      expect(w.game().heroes[0]!.gear.weapon?.id).toBe('a')

      await ui.press({ key: 'sell:b' })
      expect(w.game().inventory.some(it => it.id === 'b')).toBe(false)

      await ui.press({ key: 'upg:weapon' })
      expect(w.game().heroes[0]!.gear.weapon?.level).toBe(1)

      await ui.press({ key: 'rec:mage' })
      expect(w.game().heroes.map(hero => hero.cls)).toEqual(['warrior', 'mage'])

      await ui.press({ key: 'sel:1' })
      expect((await ui.find({ key: 'sel:1' }))?.props.variant).toBe('primary')
      await ui.unmount()
    })
  }

  test('an action short of gold toasts why and changes nothing', async ($, on) => {
    const w = world(on)
    await start($)
    const ui = await openPane($, 'terminal')
    const before = w.game()
    await ui.press({ key: 'rec:ranger' })
    expect(w.game().heroes).toHaveLength(before.heroes.length)
    expect(w.toasts.some(t => t.includes('vàng'))).toBe(true)
    await ui.unmount()
  })
})
