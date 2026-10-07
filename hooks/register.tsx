import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { GameAction, GameState, HeroClass, PendingRewards, Slot } from '../types'

import {
  applyAction,
  equip,
  isNewerSave,
  newGame,
  parseSave,
  recruit,
  rewardTestPass,
  rewardToolCall,
  sell,
  step,
  unequip,
  upgrade,
  type ActionResult,
} from '../src/game/engine'
import { isFailedRun, isGitCommit, isPassingRun, isRejectedCall, isTestCommand } from '../src/game/test-command'
import { FRAME_MS, type Anim, compose, newAnim, observe, tick } from '../src/ui/animation'
import { band, fitsPixels } from '../src/ui/band'
import { heroPane } from '../src/ui/hero-pane'

const PANE = 'hero'
export const SAVE_KEY = 'save'
export const REV_KEY = 'rev'
export const UNREADABLE_KEY = 'save-unreadable'
export const STEP_MS = 1500
export const SAVE_MS = 10_000
/** Most rewards of each kind replayed onto another session's save in one go. */
const MAX_REPLAY = 2000

const NO_PENDING: PendingRewards = { toolCalls: 0, testPasses: 0 }

/** What a toast says when an action buffs the monster, so the user sees why it grew stronger. */
const MONSTER_TOASTS: Partial<Record<GameAction, string>> = {
  turnAborted: 'Terminal Tales: Esc! Quái nổi giận.',
  permissionDenied: 'Terminal Tales: từ chối quyền, quái khoác giáp đá.',
  bashFailed: 'Terminal Tales: lệnh lỗi, quái tái sinh.',
}

const game = atom({ plugin: 'terminal-tales', key: 'game' } as const, null)
const selectedHero = atom({ plugin: 'terminal-tales', key: 'selectedHero' } as const, 0)
const baseRev = atom({ plugin: 'terminal-tales', key: 'baseRev' } as const, 0)
const pending = atom({ plugin: 'terminal-tales', key: 'pending' } as const, NO_PENDING)
const isSaveLocked = atom({ plugin: 'terminal-tales', key: 'isSaveLocked' } as const, false)

// The timers this copy of the module started; a second session.start in the
// same copy replaces them rather than doubling the pace.
let timers: Timer[] = []

// The band's animation and where its pixel scene is mounted. Both are only
// for drawing: a reload starts them over with a walk-in, nothing is lost.
let anim: Anim = newAnim()

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
let bandSite: { requestId: string; columns: number; rows: number } | null = null

function revOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function replay(g: GameState, rewards: PendingRewards): GameState {
  let out = g
  for (let i = 0; i < Math.min(rewards.toolCalls, MAX_REPLAY); i += 1) out = rewardToolCall(out)
  for (let i = 0; i < Math.min(rewards.testPasses, MAX_REPLAY); i += 1) out = rewardTestPass(out)
  return out
}

async function change($: EngineInterface, fn: (g: GameState) => GameState): Promise<void> {
  await update($, game, g => (g === null ? g : fn(g)))
}

async function earn($: EngineInterface, fn: (g: GameState) => GameState, reward: keyof PendingRewards): Promise<void> {
  await change($, fn)
  await update($, pending, p => ({ ...p, [reward]: p[reward] + 1 }))
}

async function perform($: EngineInterface, action: GameAction): Promise<void> {
  await change($, g => applyAction(g, action))
  const toast = MONSTER_TOASTS[action]
  if (toast !== undefined) $.ui.toast(toast)
}

async function act($: EngineInterface, fn: (g: GameState) => ActionResult): Promise<void> {
  let error: string | undefined
  await change($, g => {
    const result = fn(g)
    error = result.error
    return result.state
  })
  if (error !== undefined) $.ui.toast(error)
}

/**
 * Writes the game under the next revision. When another session wrote since
 * this one last loaded or saved, its game wins and this session's activity
 * rewards since then are replayed onto it; only this session's combat steps
 * and pane actions in that window are lost.
 */
async function save($: EngineInterface): Promise<void> {
  if (await read($, isSaveLocked)) return
  const ours = await read($, game)
  if (ours === null) return
  const storedRev = revOf(await $.store.get(REV_KEY))
  const sent = await read($, pending)
  let next = ours
  if (storedRev !== (await read($, baseRev))) {
    const theirs = parseSave(await $.store.get(SAVE_KEY))
    if (theirs !== null) {
      next = replay(theirs, sent)
      await update($, game, () => next)
    }
  }
  const rev = storedRev + 1
  await $.store.set(SAVE_KEY, next)
  await $.store.set(REV_KEY, rev)
  await update($, baseRev, () => rev)
  await update($, pending, p => ({
    toolCalls: p.toolCalls - sent.toolCalls,
    testPasses: p.testPasses - sent.testPasses,
  }))
}

async function load($: EngineInterface): Promise<void> {
  const raw = await $.store.get(SAVE_KEY)
  const rev = revOf(await $.store.get(REV_KEY))
  const loaded = parseSave(raw)
  if (loaded !== null) {
    await update($, game, () => loaded)
    await update($, baseRev, () => rev)
    return
  }
  const fresh = newGame(Math.floor(await $.clock.now()))
  await update($, game, () => fresh)
  if (isNewerSave(raw)) {
    await update($, isSaveLocked, () => true)
    $.ui.toast('Terminal Tales: save do phiên bản mới hơn tạo. Phiên này chơi tạm và không ghi đè save đó.')
    return
  }
  // Keep what could not be read, so a fix can still recover it.
  if (raw !== undefined) await $.store.set(UNREADABLE_KEY, raw)
  await update($, baseRev, () => rev)
  await save($)
}

async function saveTick($: EngineInterface): Promise<void> {
  await save($)
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
    if ((await read($, game)) === null) await load($)
    await $.command.register({
      name: 'hero',
      description: 'Terminal Tales: xem đội hình, trang bị và nâng cấp',
    })
    for (const timer of timers) timer.cancel()
    timers = [
      $.clock.every(STEP_MS, () => void change($, step)),
      $.clock.every(SAVE_MS, () => void saveTick($)),
      $.clock.every(FRAME_MS, () => void animate($)),
    ]
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await save($)
    return next(e)
  })

  on('command.run', { command: 'hero' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Terminal Tales', focus: true, closeOnEscape: true })
    return { text: 'Đã mở bảng anh hùng Terminal Tales.' }
  })

  // The game only watches tool calls: every call runs exactly as it would
  // without the plugin, and the reward follows its result. A failing reward
  // never refuses the call: the handler replays what next settled to.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const id = e.tool_use_id
    const wasDialog = id !== undefined && dialogCalls.delete(id)
    if (id !== undefined) askedCalls.delete(id)
    const text = ran.text ?? ''
    if (wasDialog) await perform($, isRejectedCall(text, ran.isError === true) ? 'permissionDenied' : 'permissionAllowed')
    if (ran.deny !== undefined) return ran
    await earn($, rewardToolCall, 'toolCalls')
    if (e.tool === 'Bash') {
      const isBackgrounded =
        typeof ran.result === 'object' &&
        ran.result !== null &&
        'backgroundTaskId' in ran.result &&
        ran.result.backgroundTaskId !== undefined
      if (!isBackgrounded && isTestCommand(e.command) && isPassingRun(text, ran.isError === true)) {
        await earn($, rewardTestPass, 'testPasses')
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
        equip: (heroId: string, itemId: string) => void act($, s => equip(s, heroId, itemId)),
        unequip: (heroId: string, slot: Slot) => void act($, s => unequip(s, heroId, slot)),
        upgrade: (heroId: string, slot: Slot) => void act($, s => upgrade(s, heroId, slot)),
        sell: (itemId: string) => void act($, s => sell(s, itemId)),
        recruit: (cls: HeroClass) => void act($, s => recruit(s, cls)),
      },
    })
  })
}
