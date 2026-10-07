import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { GameAction, HeroClass, Slot } from '../types'

import type { DaemonAction } from '../daemon/protocol'
import { isFailedRun, isGitCommit, isPassingRun, isRejectedCall, isTestCommand } from '../src/game/test-command'
import { endSync, startSync, submit, type Host } from '../src/sync/client'
import { FRAME_MS, type Anim, compose, newAnim, observe, tick } from '../src/ui/animation'
import { band, fitsPixels } from '../src/ui/band'
import { heroPane } from '../src/ui/hero-pane'

export { MIGRATED_KEY, SAVE_KEY, SAVE_MS, STEP_MS, UNREADABLE_KEY } from '../src/sync/client'

const PANE = 'hero'

/** What a toast says when an action buffs the monster, so the user sees why it grew stronger. */
const MONSTER_TOASTS: Partial<Record<GameAction, string>> = {
  turnAborted: 'Terminal Tales: Esc! Quái nổi giận.',
  permissionDenied: 'Terminal Tales: từ chối quyền, quái khoác giáp đá.',
  bashFailed: 'Terminal Tales: lệnh lỗi, quái tái sinh.',
}

const game = atom({ plugin: 'terminal-tales', key: 'game' } as const, null)
const selectedHero = atom({ plugin: 'terminal-tales', key: 'selectedHero' } as const, 0)
const syncMode = atom({ plugin: 'terminal-tales', key: 'syncMode' } as const, 'starting')

// The timers this copy of the module started; a second session.start in the
// same copy replaces them rather than doubling the pace.
let timers: Timer[] = []

// The band's animation and where its pixel scene is mounted. Both are only
// for drawing: a reload starts them over with a walk-in, nothing is lost.
let anim: Anim = newAnim()
let bandSite: { requestId: string; columns: number; rows: number } | null = null

// Calls the engine's own check put to the mode's decider, by tool_use_id: the
// dialog asks the user, but auto mode's classifier answers some without one.
// A classic PermissionRequest no hook beneath answered means the dialog
// showed, which moves the call to `dialogCalls`; its tool.call result then
// tells the user's answer.
const askedCalls = new Map<string, string>()
const dialogCalls = new Set<string>()

function callKey(tool: string, input: unknown): string {
  return JSON.stringify([tool, input])
}

/** The engine as the sync client uses it: every call spelled on `$` here, where the module can follow it. */
function host($: EngineInterface): Host {
  return {
    root: $.plugin.root,
    fetch: (url, init) => $.http.fetch(url, init),
    run: (argv, init) => $.process.run(argv, init),
    readFile: path => $.fs.read(path),
    exists: path => $.fs.exists(path),
    home: () => $.env.get('HOME'),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    now: () => $.clock.now(),
    sleep: ms => $.clock.sleep(ms),
    every: (ms, fn) => $.clock.every(ms, fn),
    toast: text => $.ui.toast(text),
    readGame: () => read($, game),
    updateGame: async fn => {
      await update($, game, fn)
    },
    setMode: async mode => {
      await update($, syncMode, () => mode)
    },
  }
}

/** Sends an action the user's activity caused, and says so when it helps the monster. */
async function perform($: EngineInterface, action: GameAction): Promise<void> {
  await submit(host($), { kind: action })
  const toast = MONSTER_TOASTS[action]
  if (toast !== undefined) $.ui.toast(toast)
}

function hero($: EngineInterface, op: DaemonAction & { kind: 'hero' }): void {
  void submit(host($), op)
}

/** One animation frame: follow the game, then repaint the mounted scene in place. */
async function animate($: EngineInterface): Promise<void> {
  const g = await read($, game)
  if (g === null) return
  anim = tick(observe(anim, g))
  const site = bandSite
  if (site === null) return
  const scene = compose(g, anim)
  if (scene.columns !== site.columns || scene.rows !== site.rows) {
    // The party changed size: the band draws a new Raster.
    $.ui.invalidate('ui.render')
    return
  }
  const result = await $.ui.blit({ requestId: site.requestId, key: 'scene', cells: scene.cells })
  if (result.deny !== undefined) bandSite = null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hero',
      description: 'Terminal Tales: xem đội hình, trang bị và nâng cấp',
    })
    for (const timer of timers) timer.cancel()
    timers = [$.clock.every(FRAME_MS, () => void animate($))]
    startSync(host($))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await endSync(host($))
    return next(e)
  })

  on('command.run', { command: 'hero' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Terminal Tales', focus: true, closeOnEscape: true })
    return { text: 'Đã mở bảng anh hùng Terminal Tales.' }
  })

  // The game only watches tool calls: every call runs exactly as it would
  // without the plugin, and the reward follows its result. A failing reward
  // never refuses the call: the handler hands back what next settled to.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const id = e.tool_use_id
    const wasDialog = id !== undefined && dialogCalls.delete(id)
    if (id !== undefined) askedCalls.delete(id)
    const text = ran.text ?? ''
    if (wasDialog) await perform($, isRejectedCall(text, ran.isError === true) ? 'permissionDenied' : 'permissionAllowed')
    if (ran.deny !== undefined) return ran
    await submit(host($), { kind: 'toolCall' })
    if (e.tool === 'Bash') {
      const isBackgrounded =
        typeof ran.result === 'object' &&
        ran.result !== null &&
        'backgroundTaskId' in ran.result &&
        ran.result.backgroundTaskId !== undefined
      if (!isBackgrounded && isTestCommand(e.command) && isPassingRun(text, ran.isError === true)) {
        await submit(host($), { kind: 'testPass' })
        $.ui.toast('Terminal Tales: test xanh! Cả đội nhận thưởng lớn và một món đồ.')
      }
      if (!isBackgrounded && ran.isError !== true && isGitCommit(e.command)) await perform($, 'commit')
      if (isFailedRun(text, ran.isError === true)) await perform($, 'bashFailed')
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id !== undefined) askedCalls.set(e.tool_use_id, callKey(e.tool, e.input))
    return verdict
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    const answer = await next(e)
    if (answer.decision === undefined) {
      const key = callKey(e.tool_name, e.tool_input)
      for (const [id, asked] of askedCalls) {
        if (asked !== key) continue
        askedCalls.delete(id)
        dialogCalls.add(id)
        break
      }
    }
    return answer
  }).catch(($, e, next) => next(e))

  // Only the user's own Enter at the prompt rallies the party: not a plugin's
  // prompt, a notification, a peer session or a schedule.
  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    if (e.origin.kind === 'composer' && entered.drop === undefined) await perform($, 'prompt')
    return entered
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      if (e.reason === 'answer') await perform($, 'turnDone')
      else if (e.reason === 'aborted') await perform($, 'turnAborted')
    }
    return done
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.trigger === 'manual' && e.agentId === undefined && compacted.skip === undefined) await perform($, 'compact')
    return compacted
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const g = await read($, game)
    if (e.props.hasSurvey || g === null) return next(e)
    const raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined
    const scene = compose(g, anim)
    const columns = e.props.bodyColumns
    const rows = e.props.maxRows
    bandSite =
      raster !== undefined && fitsPixels(scene, columns, rows)
        ? { requestId: e.requestId, columns: scene.columns, rows: scene.rows }
        : null
    return band({ kit: $.ui.resolve(e), raster, scene, game: g, columns, rows })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const g = await read($, game)
    if (g === null) {
      return (
        <Box>
          <Text dimColor>Đang tải tiến trình…</Text>
        </Box>
      )
    }
    return heroPane({
      kit: { Box, Text, Button },
      game: g,
      selected: await read($, selectedHero),
      rows: e.props.scroll.bodyRows,
      actions: {
        select: (index: number) => void update($, selectedHero, () => index),
        equip: (heroId: string, itemId: string) => hero($, { kind: 'hero', op: 'equip', heroId, itemId }),
        unequip: (heroId: string, slot: Slot) => hero($, { kind: 'hero', op: 'unequip', heroId, slot }),
        upgrade: (heroId: string, slot: Slot) => hero($, { kind: 'hero', op: 'upgrade', heroId, slot }),
        sell: (itemId: string) => hero($, { kind: 'hero', op: 'sell', itemId }),
        recruit: (cls: HeroClass) => hero($, { kind: 'hero', op: 'recruit', cls }),
      },
    })
  })
}
