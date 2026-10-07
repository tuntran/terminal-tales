import type { Effect, GameState, HeroClass } from '../../types'

import { EFFECTS } from '../game/catalog'

export const CLASS_COLOR: Record<HeroClass, string> = {
  warrior: 'red',
  mage: 'magenta',
  ranger: 'green',
}

export function pad(text: string, width: number): string {
  const chars = Array.from(text)
  return chars.length >= width ? chars.slice(0, width).join('') : text + ' '.repeat(width - chars.length)
}

export function bar(current: number, max: number, width: number): string {
  const ratio = max > 0 && Number.isFinite(current) ? Math.min(1, Math.max(0, current / max)) : 0
  const filled = Math.round(ratio * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function formatNumber(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** A one-line summary under the scene, for a band too narrow for the info column. */
export function summaryLine(g: GameState): string {
  const party = g.heroes.map(h => `${h.name} ${h.level}`).join(', ')
  return `Ải ${g.stage} · ${formatNumber(g.gold)} vàng · ${party} vs ${g.monster.name} ${bar(g.monster.hp, g.monster.maxHp, 6)}`
}

/** Seconds a combat step lasts, for showing an effect's time left. */
const STEP_SECONDS = 1.5

function effectLabel(effect: Effect): string {
  const info = EFFECTS[effect.kind]
  const left = effect.charges > 0 ? `x${effect.charges}` : `${Math.ceil(effect.steps * STEP_SECONDS)}s`
  return `${info.icon} ${info.label} ${left}`
}

/** One side's lasting effects, or null when it has none. */
export function effectsOf(g: GameState, side: 'heroes' | 'monster'): string | null {
  const labels = g.effects.filter(e => EFFECTS[e.kind].side === side).map(effectLabel)
  return labels.length > 0 ? labels.join(' · ') : null
}
