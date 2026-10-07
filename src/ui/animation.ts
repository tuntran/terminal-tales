import type { GameState, Monster, MonsterTier } from '../../types'

import { heroStats } from '../game/engine'
import {
  type Canvas,
  DIGITS,
  PALETTE,
  PIXEL_BOSSES,
  PIXEL_HEROES,
  PIXEL_HERO_ATTACKS,
  PIXEL_HERO_STRIDES,
  PIXEL_MONSTERS,
  type PixelScene,
  type Sprite,
  encodeCells,
} from './pixel-art'

// The band's animation runs on its own clock, one frame every FRAME_MS, and
// follows the game rather than driving it: `observe` turns what changed
// between two game states into timed effects (a volley, a counterattack, a
// death, a walk to the next monster), and `compose` draws one frame of them.

export const FRAME_MS = 100
const WALK_FRAMES = 8
const DEATH_FRAMES = 6
const NUMBER_FRAMES = 8

// When each part of a volley plays, in frames after it starts.
const WARRIOR_SWING = [1, 3] as const
const MAGE_CAST = [2, 4] as const
const RANGER_SHOT = [3, 5] as const
const ORB_FLIGHT = [2, 6] as const
const ARROW_FLIGHT = [3, 6] as const
const MONSTER_FLASH = [3, 4, 6] as const
const NUMBER_DELAY = 3
const COUNTER_DELAY = 7

type Snapshot = { seed: number; kills: number; monster: Monster; heroHp: number[] }

export type Anim = {
  t: number
  /** Ground scroll, moved only while the party walks. */
  ground: number
  prev: Snapshot | null
  volleyAt: number | null
  counterAt: number | null
  hitHero: number | null
  dying: { monster: Monster; at: number } | null
  enterAt: number
  numbers: { value: number; at: number }[]
}

export function newAnim(): Anim {
  return { t: 0, ground: 0, prev: null, volleyAt: null, counterAt: null, hitHero: null, dying: null, enterAt: 0, numbers: [] }
}

function snapshot(g: GameState): Snapshot {
  return { seed: g.seed, kills: g.stats.kills, monster: g.monster, heroHp: g.heroes.map(h => h.hp) }
}

function isWalking(a: Anim): boolean {
  return a.t >= a.enterAt && a.t < a.enterAt + WALK_FRAMES
}

/** Reads what happened between the last game state seen and this one. */
export function observe(a: Anim, g: GameState): Anim {
  const prev = a.prev
  const next: Anim = { ...a, prev: snapshot(g), numbers: a.numbers.filter(n => a.t < n.at + NUMBER_FRAMES) }
  if (prev === null) return next
  if (g.stats.kills > prev.kills) {
    next.dying = { monster: { ...prev.monster, hp: 0 }, at: a.t }
    next.numbers = [...next.numbers, { value: prev.monster.hp, at: a.t }]
    next.enterAt = a.t + DEATH_FRAMES
    next.volleyAt = null
    next.counterAt = null
    return next
  }
  const isBusy = isWalking(a) || a.t < a.enterAt
  if (g.seed !== prev.seed && g.monster.hp < prev.monster.hp && !isBusy) {
    next.volleyAt = a.t
    next.numbers = [...next.numbers, { value: prev.monster.hp - g.monster.hp, at: a.t + NUMBER_DELAY }]
  }
  const hit = g.heroes.findIndex((h, i) => h.hp < (prev.heroHp[i] ?? h.hp))
  if (hit >= 0 && !isBusy) {
    next.counterAt = next.volleyAt === a.t ? a.t + COUNTER_DELAY : a.t
    next.hitHero = hit
  }
  return next
}

/** Moves the animation one frame on. */
export function tick(a: Anim): Anim {
  return { ...a, t: a.t + 1, ground: isWalking(a) ? a.ground + 1 : a.ground }
}

/** An animation that has seen this game and has nothing to play: a still frame. */
export function stillAnim(g: GameState): Anim {
  return { ...newAnim(), t: 100, enterAt: -100, prev: snapshot(g) }
}

// ---------- drawing ----------

const HERO_SLOT = 12
const HERO_GAP = 3
const VS_GAP = 6
const MONSTER_SLOT = 16
const RIGHT_MARGIN = 2
const HEADROOM = 2
const SPRITE_ROWS = 12
const GROUND_Y = HEADROOM + SPRITE_ROWS
const BAR_Y = GROUND_Y + 1
const HEIGHT = BAR_Y + 1

const WHITE = 0xffffff
const HIT_RED = 0xff5a5a
const BAR_EMPTY = 0x3a3f58
const HERO_BAR = 0x4fbf5a
const MONSTER_BAR = 0xc23b4f
const GROUND = [0x2a6b3a, 0x2a6b3a, 0x4fbf5a, 0x2a6b3a, 0x5a3a1e, 0x2a6b3a] as const

const TIER_OUTLINE: Partial<Record<MonsterTier, number>> = { elite: 0x2fb7c9, rare: 0xb55088 }

function within(t: number | null, at: number, [from, to]: readonly [number, number]): boolean {
  return t !== null && at - t >= from && at - t <= to
}

function spriteWidth(sprite: Sprite): number {
  return Math.max(...sprite.map(row => row.length))
}

function monsterSprite(m: Monster): Sprite {
  return m.tier === 'boss' ? (PIXEL_BOSSES[m.sprite] ?? PIXEL_BOSSES[0]!) : (PIXEL_MONSTERS[m.sprite] ?? PIXEL_MONSTERS[0]!)
}

function gray(color: number): number {
  const v = Math.round((((color >> 16) & 255) * 0.3 + ((color >> 8) & 255) * 0.59 + (color & 255) * 0.11) * 0.6)
  return (v << 16) | (v << 8) | v
}

function mix(color: number, toward: number, amount: number): number {
  const channel = (shift: number) =>
    Math.round(((color >> shift) & 255) * (1 - amount) + ((toward >> shift) & 255) * amount) << shift
  return channel(16) | channel(8) | channel(0)
}

function put(c: Canvas, x: number, y: number, color: number): void {
  if (x >= 0 && y >= 0 && x < c.width && y < c.height) c.px[y * c.width + x] = color
}

function stamp(c: Canvas, sprite: Sprite, left: number, bottom: number, tint?: (key: string, color: number, x: number, y: number) => number | null): void {
  const top = bottom - sprite.length
  sprite.forEach((row, y) => {
    Array.from(row).forEach((key, x) => {
      const color = PALETTE[key]
      if (color === undefined) return
      const painted = tint ? tint(key, color, x, y) : color
      if (painted !== null) put(c, left + x, top + y, painted)
    })
  })
}

function bar(c: Canvas, left: number, width: number, ratio: number, fill: number): void {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * width)
  for (let x = 0; x < width; x += 1) put(c, left + x, BAR_Y, x < filled ? fill : BAR_EMPTY)
}

function compact(n: number): string {
  return n >= 10_000 ? `${Math.floor(n / 1000)}k` : String(Math.max(0, Math.round(n)))
}

function number(c: Canvas, value: number, centerX: number, top: number): void {
  const text = compact(value)
  let x = centerX - Math.floor((text.length * 4 - 1) / 2)
  for (const ch of text) {
    const glyph = DIGITS[ch] ?? DIGITS['0']!
    glyph.forEach((row, gy) =>
      Array.from(row).forEach((bit, gx) => {
        if (bit !== '1') return
        put(c, x + gx + 1, top + gy + 1, PALETTE.K!)
        put(c, x + gx, top + gy, WHITE)
      }),
    )
    x += 4
  }
}

/** A stable per-pixel threshold, so a dying monster crumbles the same way each frame. */
function crumble(x: number, y: number): number {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100 / 100
}

function canvasWidth(g: GameState): number {
  return g.heroes.length * (HERO_SLOT + HERO_GAP) + VS_GAP + MONSTER_SLOT + RIGHT_MARGIN
}

/** Draws one frame of the fight. Its size depends on the party alone, so frames can be blitted. */
export function compose(g: GameState, a: Anim): PixelScene {
  const width = canvasWidth(g)
  const c: Canvas = { width, height: HEIGHT, px: Array(width * HEIGHT).fill(null) }
  const walking = isWalking(a)
  const t = a.t

  for (let x = 0; x < width; x += 1) put(c, x, GROUND_Y, GROUND[(x + a.ground) % GROUND.length]!)

  const slotX = g.heroes.length * (HERO_SLOT + HERO_GAP) + VS_GAP
  const monsterCenter = slotX + MONSTER_SLOT / 2

  g.heroes.forEach((hero, i) => {
    const left = i * (HERO_SLOT + HERO_GAP)
    const idle = PIXEL_HEROES[hero.cls]
    const isDown = hero.hp <= 0 || g.resting > 0
    let sprite = idle
    let dx = 0
    if (!isDown && walking) {
      const stride = PIXEL_HERO_STRIDES[hero.cls][(t >> 1) & 1] ?? []
      sprite = [...idle.slice(0, idle.length - stride.length), ...stride]
    } else if (!isDown) {
      const window = hero.cls === 'warrior' ? WARRIOR_SWING : hero.cls === 'mage' ? MAGE_CAST : RANGER_SHOT
      if (within(a.volleyAt, t, window)) {
        sprite = PIXEL_HERO_ATTACKS[hero.cls]
        if (hero.cls === 'warrior') dx = 2
      }
    }
    const isHit = a.hitHero === i && within(a.counterAt, t, [1, 2])
    stamp(c, sprite, left + dx, GROUND_Y, (_, color) => (isDown ? gray(color) : isHit ? mix(color, HIT_RED, 0.6) : color))
    bar(c, left, HERO_SLOT - 1, hero.hp / heroStats(hero).maxHp, HERO_BAR)

    if (isDown || walking || a.volleyAt === null) return
    const rel = t - a.volleyAt
    if (hero.cls === 'mage' && rel >= ORB_FLIGHT[0] && rel <= ORB_FLIGHT[1]) {
      const p = (rel - ORB_FLIGHT[0]) / (ORB_FLIGHT[1] - ORB_FLIGHT[0])
      const x = Math.round(left + 11 + (monsterCenter - left - 11) * p)
      const y = Math.round(HEADROOM + 1 + (GROUND_Y - 6 - HEADROOM - 1) * p)
      put(c, x, y, WHITE)
      put(c, x - 1, y, PALETTE.E!)
      put(c, x + 1, y, PALETTE.E!)
      put(c, x, y - 1, PALETTE.E!)
      put(c, x, y + 1, PALETTE.e!)
      put(c, x - 2, y, PALETTE.e!)
    }
    if (hero.cls === 'ranger' && rel >= ARROW_FLIGHT[0] && rel <= ARROW_FLIGHT[1]) {
      const p = (rel - ARROW_FLIGHT[0]) / (ARROW_FLIGHT[1] - ARROW_FLIGHT[0])
      const x = Math.round(left + 13 + (monsterCenter - left - 13) * p)
      const y = HEADROOM + 6
      for (let k = 0; k < 4; k += 1) put(c, x - k, y, PALETTE.N!)
      put(c, x + 1, y, PALETTE.Y!)
      put(c, x - 4, y - 1, WHITE)
      put(c, x - 4, y + 1, WHITE)
    }
  })

  const outline = TIER_OUTLINE[g.monster.tier]
  if (a.dying !== null && t < a.dying.at + DEATH_FRAMES) {
    const rel = t - a.dying.at
    const sprite = monsterSprite(a.dying.monster)
    const left = slotX + Math.floor((MONSTER_SLOT - spriteWidth(sprite)) / 2)
    const gone = rel < 3 ? 0 : (rel - 2) / (DEATH_FRAMES - 2)
    if (rel >= 3 || rel % 2 === 0) {
      stamp(c, sprite, left, GROUND_Y, (_, color, x, y) => (crumble(x, y) < gone ? null : rel < 3 ? WHITE : color))
    }
  } else if (t >= a.enterAt) {
    const sprite = monsterSprite(g.monster)
    const home = slotX + Math.floor((MONSTER_SLOT - spriteWidth(sprite)) / 2)
    let left = home
    let bob = 0
    if (walking) {
      const p = (t - a.enterAt) / (WALK_FRAMES - 1)
      left = Math.round(width + (home - width) * p)
      bob = (t & 1) === 1 ? 1 : 0
    } else if (within(a.counterAt, t, [0, 1])) {
      left -= 2
    }
    const isFlashing = !walking && a.volleyAt !== null && MONSTER_FLASH.includes((t - a.volleyAt) as never)
    stamp(c, sprite, left, GROUND_Y - bob, (key, color) => (isFlashing && key !== 'K' ? WHITE : key === 'K' && outline !== undefined ? outline : color))
    if (!walking) bar(c, slotX, MONSTER_SLOT, g.monster.hp / g.monster.maxHp, MONSTER_BAR)
  }

  for (const n of a.numbers) {
    const rel = t - n.at
    if (rel >= 0 && rel < NUMBER_FRAMES) number(c, n.value, monsterCenter, HEADROOM + 2 - Math.min(rel, 3))
  }

  return { columns: width, rows: HEIGHT / 2, cells: encodeCells(c) }
}

/** A still frame of the fight, as the band shows before any animation runs. */
export function pixelScene(g: GameState): PixelScene {
  return compose(g, stillAnim(g))
}
