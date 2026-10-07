import type { GameState, Hero, HeroClass, Monster } from '../../types'

import { BOSSES, DOWN_SPRITE, HERO_SPRITES, MONSTERS } from '../game/catalog'

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

export function heroSprite(hero: Hero, frame: number): readonly string[] {
  return hero.hp <= 0 ? DOWN_SPRITE : HERO_SPRITES[hero.cls][frame === 1 ? 1 : 0]
}

export function monsterSprite(monster: Monster): readonly string[] {
  const kinds = monster.tier === 'boss' ? BOSSES : MONSTERS
  return (kinds[monster.sprite] ?? MONSTERS[0]!).sprite
}

/** A one-line summary for a band too narrow for the scene. */
export function summaryLine(g: GameState): string {
  const party = g.heroes.map(h => `${h.name} ${h.level}`).join(', ')
  return `Ải ${g.stage} · ${formatNumber(g.gold)} vàng · ${party} vs ${g.monster.name} ${bar(g.monster.hp, g.monster.maxHp, 6)}`
}
