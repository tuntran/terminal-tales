import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { GameState, HeroClass, PendingRewards, Slot } from '../types'

import {
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
import { isPassingRun, isTestCommand } from '../src/game/test-command'
import { band } from '../src/ui/band'
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

const game = atom({ plugin: 'terminal-tales', key: 'game' } as const, null)
const selectedHero = atom({ plugin: 'terminal-tales', key: 'selectedHero' } as const, 0)
const baseRev = atom({ plugin: 'terminal-tales', key: 'baseRev' } as const, 0)
const pending = atom({ plugin: 'terminal-tales', key: 'pending' } as const, NO_PENDING)
const isSaveLocked = atom({ plugin: 'terminal-tales', key: 'isSaveLocked' } as const, false)

// The timers this copy of the module started; a second session.start in the
// same copy replaces them rather than doubling the pace.
let timers: Timer[] = []

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if ((await read($, game)) === null) await load($)
    await $.command.register({
      name: 'hero',
      description: 'Terminal Tales: xem đội hình, trang bị và nâng cấp',
    })
    for (const timer of timers) timer.cancel()
    timers = [$.clock.every(STEP_MS, () => void change($, step)), $.clock.every(SAVE_MS, () => void saveTick($))]
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
    if (ran.deny !== undefined) return ran
    await earn($, rewardToolCall, 'toolCalls')
    if (e.tool === 'Bash' && isTestCommand(e.command)) {
      const isBackgrounded =
        typeof ran.result === 'object' &&
        ran.result !== null &&
        'backgroundTaskId' in ran.result &&
        ran.result.backgroundTaskId !== undefined
      if (!isBackgrounded && isPassingRun(ran.text ?? '', ran.isError === true)) {
        await earn($, rewardTestPass, 'testPasses')
        $.ui.toast('Terminal Tales: test xanh! Cả đội nhận thưởng lớn và một món đồ.')
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const g = await read($, game)
    if (e.props.hasSurvey || g === null) return next(e)
    return band({ kit: $.ui.resolve(e), game: g, columns: e.props.bodyColumns, rows: e.props.maxRows })
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
