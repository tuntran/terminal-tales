import type { EffectKind, GameState, HeroClass, Monster, MonsterTier } from '../../types'

import { monsterKind } from '../game/catalog'
import { heroStats } from '../game/engine'
import type { Atlases, Clip, Picture } from './atlas'
import { ATLAS, type AtlasId } from './atlas-manifest'
import { type Frame, type Tint, backdrop, blit, fill, newFrame, put, text, wash } from './frame-buffer'

// The band's animation runs on its own clock, one frame every FRAME_MS, and
// follows the game rather than driving it: `observe` turns what changed
// between two game states into timed events (a volley, a counterattack, a
// heal, a fall, a death, a walk to the next monster), and `compose` paints
// one frame of them over the stage's background.

export const FRAME_MS = 100
const WALK_FRAMES = 8
const NUMBER_FRAMES = 8
const HEAL_FRAMES = 8
/** Frames after a volley starts that its blows land: arrows and orbs fly until then. */
const IMPACT = 5
const PROJECTILE_FLIGHT = [2, IMPACT] as const
/** Frames after a volley starts that the monster answers it. */
const COUNTER_DELAY = 8
/** Frames into the monster's attack that it lands on a hero. */
const COUNTER_IMPACT = 4
/** A pause between a monster's last death frame and the next one walking in. */
const AFTER_DEATH = 2

type Snapshot = {
  seed: number
  kills: number
  monster: Monster
  heroHp: number[]
  heroMaxHp: number[]
  /** Each standing hero's attack: what a volley without a crit deals. */
  heroAtk: number[]
  charges: Partial<Record<EffectKind, number>>
  hasRally: boolean
}

export type DamageNumber = { value: number; at: number; kind: 'hit' | 'crit' | 'blocked' }

export type Anim = {
  t: number
  /** Background scroll, moved only while the party walks. */
  ground: number
  prev: Snapshot | null
  volleyAt: number | null
  /** The current volley had at least one critical hit. */
  crit: boolean
  /** The current volley hit stoneskin and did nothing. */
  blocked: boolean
  counterAt: number | null
  /** The hero the counterattack hit; null when the milestone shield took it. */
  hitHero: number | null
  /** When each side last healed by more than the party's own regeneration. */
  healAt: { heroes: number | null; monster: number | null }
  /** When each hero fell, by party index; null for one standing or fallen before the band saw it. */
  downAt: (number | null)[]
  dying: { monster: Monster; at: number } | null
  enterAt: number
  numbers: DamageNumber[]
}

export function newAnim(): Anim {
  return {
    t: 0,
    ground: 0,
    prev: null,
    volleyAt: null,
    crit: false,
    blocked: false,
    counterAt: null,
    hitHero: null,
    healAt: { heroes: null, monster: null },
    downAt: [],
    dying: null,
    enterAt: 0,
    numbers: [],
  }
}

function snapshot(g: GameState): Snapshot {
  const charges: Partial<Record<EffectKind, number>> = {}
  for (const e of g.effects) charges[e.kind] = e.charges
  return {
    seed: g.seed,
    kills: g.stats.kills,
    monster: g.monster,
    heroHp: g.heroes.map(h => h.hp),
    heroMaxHp: g.heroes.map(h => heroStats(h).maxHp),
    heroAtk: g.heroes.filter(h => h.hp > 0).map(h => heroStats(h).atk),
    charges,
    hasRally: g.effects.some(e => e.kind === 'rally'),
  }
}

function isWalking(a: Anim): boolean {
  return a.t >= a.enterAt && a.t < a.enterAt + WALK_FRAMES
}

function deathFrames(m: Monster): number {
  return ATLAS[monsterKind(m).asset].clips.death.frames
}

/**
 * True when `damage` is more than whole plain volleys deal. The game keeps no
 * record of crits, but a crit doubles one hero's blow, so it adds an attack
 * the party's plain sum lacks. This holds while a crit is the only thing that
 * grows a blow; the rally's second volley, the one other way a step deals
 * more, is allowed for.
 */
export function hasCrit(damage: number, heroAtk: readonly number[], hasRally: boolean): boolean {
  const plain = heroAtk.reduce((sum, atk) => sum + atk, 0)
  const near = (v: number) => Math.abs(damage - v) < 0.01
  return damage > 0 && !near(plain) && !(hasRally && near(plain * 2))
}

/** HP a hero regains by itself each step: a rise beyond it is a heal. */
function regeneration(maxHp: number): number {
  return Math.ceil(maxHp * 0.03)
}

/** Reads what happened between the last game state seen and this one. */
export function observe(a: Anim, g: GameState): Anim {
  const prev = a.prev
  const next: Anim = {
    ...a,
    prev: snapshot(g),
    numbers: a.numbers.filter(n => a.t < n.at + NUMBER_FRAMES),
    downAt: g.heroes.map((h, i) => (h.hp > 0 ? null : (a.downAt[i] ?? null))),
  }
  if (prev === null) return next

  g.heroes.forEach((h, i) => {
    if (h.hp <= 0 && (prev.heroHp[i] ?? 0) > 0) next.downAt[i] = a.t
  })
  if (g.heroes.some((h, i) => h.hp > (prev.heroHp[i] ?? h.hp) + regeneration(prev.heroMaxHp[i] ?? 0))) {
    next.healAt = { ...next.healAt, heroes: a.t }
  }

  if (g.stats.kills > prev.kills) {
    // The party's blow lands, then the monster plays its whole death before the next walks in.
    const at = a.t + IMPACT
    next.volleyAt = a.t
    next.crit = false
    next.blocked = false
    next.counterAt = null
    next.dying = { monster: { ...prev.monster, hp: 0 }, at }
    next.numbers = [...next.numbers, { value: prev.monster.hp, at, kind: 'hit' }]
    next.enterAt = at + deathFrames(prev.monster) + AFTER_DEATH
    return next
  }

  if (isWalking(a) || a.t < a.enterAt) return next

  if (g.monster.hp > prev.monster.hp && g.resting === 0) next.healAt = { ...next.healAt, monster: a.t }

  const stepped = g.seed !== prev.seed
  const isBlocked = stepped && (g.effects.find(e => e.kind === 'stoneskin')?.charges ?? 0) < (prev.charges.stoneskin ?? 0)
  const damage = prev.monster.hp - g.monster.hp
  // A free strike from a tool call can land in the same read as a blocked step: the damage wins.
  if (isBlocked && damage <= 0) {
    next.volleyAt = a.t
    next.crit = false
    next.blocked = true
    next.numbers = [...next.numbers, { value: 0, at: a.t + IMPACT, kind: 'blocked' }]
  } else if (stepped && damage > 0) {
    const crit = hasCrit(damage, prev.heroAtk, prev.hasRally)
    next.volleyAt = a.t
    next.crit = crit
    next.blocked = false
    next.numbers = [...next.numbers, { value: damage, at: a.t + IMPACT, kind: crit ? 'crit' : 'hit' }]
  }

  // Only a combat step counterattacks: gear swapped in /hero can lower HP too.
  if (!stepped) return next
  const hit = g.heroes.findIndex((h, i) => h.hp < (prev.heroHp[i] ?? h.hp))
  const isShielded = (g.effects.find(e => e.kind === 'milestone')?.charges ?? 0) < (prev.charges.milestone ?? 0)
  if (hit >= 0 || isShielded) {
    next.counterAt = next.volleyAt === a.t ? a.t + COUNTER_DELAY : a.t
    next.hitHero = hit >= 0 ? hit : null
  }
  return next
}

/** Moves the animation one frame on. */
export function tick(a: Anim): Anim {
  return { ...a, t: a.t + 1, ground: isWalking(a) ? a.ground + 1 : a.ground }
}

/** An animation that has seen this game and has nothing to play: a still frame. */
export function stillAnim(g: GameState): Anim {
  return { ...observe(newAnim(), g), t: 100, enterAt: -100 }
}

// ---------- painting ----------

export const BACKGROUNDS = ['bg-plains', 'bg-forest', 'bg-dead-forest', 'bg-snowy-mountains', 'bg-cave'] as const satisfies readonly AtlasId[]

const HERO_ASSET: Record<HeroClass, AtlasId> = { warrior: 'hero-knight', mage: 'wizard', ranger: 'huntress' }

/** Where each party member's feet are, the first in front. */
const HERO_X = [140, 90, 40] as const
const MONSTER_X = 300
/** Where a monster starts its walk in: just past the right edge. */
const WALK_FROM_X = 420
/** Pixels the background slides each walking frame. */
const SCROLL_STEP = 6
/** How far above the ground a flying monster hovers. */
const HOVER = 14
const HERO_BAR_WIDTH = 24
const MONSTER_BAR_WIDTH = 36

const WHITE = 0xffffff
const HIT_RED = 0xff3b3b
const BAR_EMPTY = 0x3a3f58
const HERO_BAR = 0x4fbf5a
const MONSTER_BAR = 0xc23b4f
const GOLD = 0xffe08a
const ARCANE = 0x73eff7
const HEAL_GREEN = 0x9be37a
const SHIELD_BLUE = 0x8fc1ff
const ENRAGE_RED = 0xff2a2a
const BLOCKED_GRAY = 0x9a9a9a

const TIER_OUTLINE: Partial<Record<MonsterTier, number>> = { elite: 0x2fb7c9, rare: 0xd065b0 }

function since(at: number | null, t: number): number | null {
  return at === null || t < at ? null : t - at
}

function frameAt(clip: Clip, rel: number, loop: boolean): Picture {
  const n = clip.frames.length
  const i = Math.floor((rel * FRAME_MS) / clip.frameMs)
  return clip.frames[loop ? ((i % n) + n) % n : Math.min(n - 1, i)]!
}

/** Plays a clip once from `rel`; null once it is over. */
function playing(clip: Clip, rel: number | null): Picture | null {
  if (rel === null || rel < 0 || (rel * FRAME_MS) / clip.frameMs >= clip.frames.length) return null
  return frameAt(clip, rel, false)
}

function stamp(f: Frame, clip: Clip, picture: Picture, x: number, ground: number, options?: { tint?: Tint; outline?: number }): void {
  blit(f, picture, Math.round(x) - clip.anchorX, Math.round(ground) - clip.anchorY, options)
}

function bar(f: Frame, centerX: number, y: number, width: number, ratio: number, color: number): void {
  const left = Math.round(centerX - width / 2)
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * width)
  fill(f, left, y, width, 2, BAR_EMPTY)
  fill(f, left, y, filled, 2, color)
}

function compact(n: number): string {
  return n >= 10_000 ? `${Math.floor(n / 1000)}k` : String(Math.max(0, Math.round(n)))
}

/** Green sparks drifting up over a character that just healed. */
function healSparks(f: Frame, x: number, ground: number, height: number, rel: number): void {
  for (let k = 0; k < 4; k += 1) {
    const sx = Math.round(x - 10 + k * 7)
    const sy = Math.round(ground - 4 - ((rel * 5 + k * 11) % Math.max(12, height)))
    put(f, sx, sy, HEAL_GREEN)
    put(f, sx, sy - 1, HEAL_GREEN, 0.6)
    put(f, sx - 1, sy, HEAL_GREEN, 0.4)
    put(f, sx + 1, sy, HEAL_GREEN, 0.4)
  }
}

/** Paints one frame of the fight, always FRAME_WIDTH × FRAME_HEIGHT, whatever the party's size. */
export function compose(g: GameState, a: Anim, atlases: Atlases): Frame {
  const f = newFrame()
  const t = a.t
  const walking = isWalking(a)
  const bgId = BACKGROUNDS[(((g.stage - 1) % BACKGROUNDS.length) + BACKGROUNDS.length) % BACKGROUNDS.length]!
  const ground = ATLAS[bgId].groundY
  backdrop(f, atlases[bgId].scene!.frames[0]!, a.ground * SCROLL_STEP)

  const has = (kind: EffectKind) => g.effects.some(e => e.kind === kind)
  const volley = walking ? null : since(a.volleyAt, t)
  const counter = walking ? null : since(a.counterAt, t)

  // ---- the monster, behind the numbers and projectiles ----
  const isDying = a.dying !== null && t < a.enterAt
  const shown = isDying ? a.dying!.monster : g.monster
  const kind = monsterKind(shown)
  const monster = atlases[kind.asset]
  const lift = kind.asset === 'flying-eye' ? HOVER : 0
  const monsterTop = ground - lift - monster.idle!.anchorY
  const outline = TIER_OUTLINE[shown.tier]
  if (a.dying !== null && isDying) {
    const rel = t - a.dying.at
    if (rel < 0) {
      stamp(f, monster.idle!, frameAt(monster.idle!, t, true), MONSTER_X, ground - lift, { outline })
    } else {
      const picture = playing(monster.death!, rel)
      if (picture !== null) stamp(f, monster.death!, picture, MONSTER_X, ground - lift, { tint: rel === 0 ? { mix: WHITE, amount: 0.8 } : undefined })
    }
  } else if (t >= a.enterAt) {
    let x = MONSTER_X
    let clip = monster.idle!
    let picture = frameAt(clip, t, true)
    let tint: Tint | undefined
    if (walking) {
      const p = (t - a.enterAt) / (WALK_FRAMES - 1)
      x = WALK_FROM_X + (MONSTER_X - WALK_FROM_X) * p
      clip = monster.run!
      picture = frameAt(clip, t, true)
    } else {
      const attack = playing(monster.attack!, counter)
      const hurt = volley !== null && !a.blocked ? playing(monster.hit!, volley - IMPACT) : null
      if (attack !== null) {
        clip = monster.attack!
        picture = attack
      } else if (hurt !== null) {
        clip = monster.hit!
        picture = hurt
      }
      if (volley === IMPACT && !a.blocked) tint = { mix: WHITE, amount: 0.85 }
      else if (has('stoneskin')) tint = { gray: 0.85 }
      else if (has('enrage') && ((t >> 1) & 1) === 0) tint = { mix: ENRAGE_RED, amount: 0.45 }
    }
    stamp(f, clip, picture, x, ground - lift, { tint, outline })
    if (!walking) {
      bar(f, MONSTER_X, ground + 2, MONSTER_BAR_WIDTH, g.monster.hp / g.monster.maxHp, MONSTER_BAR)
      const healed = since(a.healAt.monster, t)
      if (healed !== null && healed < HEAL_FRAMES) healSparks(f, MONSTER_X, ground - lift, monster.idle!.anchorY, healed)
    }
  }

  // ---- the party ----
  const standing = g.resting === 0
  g.heroes.forEach((hero, i) => {
    const x = HERO_X[i] ?? HERO_X[HERO_X.length - 1]!
    const atlas = atlases[HERO_ASSET[hero.cls]]
    const idle = atlas.idle!
    const height = idle.anchorY
    const isDown = hero.hp <= 0 || !standing
    if (isDown) {
      const death = atlas.death!
      const fell = since(a.downAt[i] ?? null, t)
      const falling = playing(death, fell)
      if (falling !== null) stamp(f, death, falling, x, ground)
      else stamp(f, death, death.frames[death.frames.length - 1]!, x, ground, { tint: { gray: 0.7 } })
    } else {
      let clip = idle
      let picture = frameAt(idle, t, true)
      let tint: Tint | undefined
      const hurt = a.hitHero === i && counter !== null ? playing(atlas.hit!, counter - COUNTER_IMPACT) : null
      const swing = playing(atlas.attack!, volley)
      if (walking) {
        clip = atlas.run!
        picture = frameAt(clip, t, true)
      } else if (hurt !== null) {
        clip = atlas.hit!
        picture = hurt
        if (counter! - COUNTER_IMPACT < 2) tint = { mix: HIT_RED, amount: 0.55 }
      } else if (swing !== null) {
        clip = atlas.attack!
        picture = swing
      }
      stamp(f, clip, picture, x, ground, { tint })
      if (has('trust')) {
        // A glint at the weapon hand.
        const hx = x + 12
        const hy = ground - Math.round(height * 0.55)
        const glow = ((t >> 1) & 1) === 0 ? 1 : 0.6
        put(f, hx, hy, WHITE, glow)
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) put(f, hx + dx, hy + dy, SHIELD_BLUE, 0.8 * glow)
      }
      if (has('rally') && ((t >> 1) & 1) === 0) {
        // Two short gold streaks over the head.
        const top = ground - height - 5
        for (let k = 0; k < 3; k += 1) {
          put(f, x - 4 + k, top - k, GOLD)
          put(f, x + 4 - k, top - k, GOLD)
        }
      }
      const healed = since(a.healAt.heroes, t)
      if (healed !== null && healed < HEAL_FRAMES) healSparks(f, x, ground, height, healed)
    }
    bar(f, x, ground + 2, HERO_BAR_WIDTH, hero.hp / heroStats(hero).maxHp, HERO_BAR)

    // Projectiles, from the hand to the monster's middle.
    if (isDown || volley === null || volley < PROJECTILE_FLIGHT[0] || volley > PROJECTILE_FLIGHT[1]) return
    const p = (volley - PROJECTILE_FLIGHT[0]) / (PROJECTILE_FLIGHT[1] - PROJECTILE_FLIGHT[0])
    const fromX = x + 14
    const fromY = ground - Math.round(height * 0.55)
    const toY = monsterTop + Math.round(monster.idle!.anchorY * 0.5)
    const px = fromX + (MONSTER_X - 10 - fromX) * p
    const py = fromY + (toY - fromY) * p
    if (hero.cls === 'mage') {
      const orb = atlases.orb.move!
      stamp(f, orb, frameAt(orb, t, true), px, py)
    } else if (hero.cls === 'ranger') {
      const arrow = atlases.arrow.move!
      stamp(f, arrow, frameAt(arrow, t, true), px, py)
    }
  })

  // ---- the shield of a milestone, in front of the party ----
  if (has('milestone')) {
    const cx = (HERO_X[0] + MONSTER_X) / 2 - 50
    for (let y = ground - 46; y <= ground; y += 1) {
      const dy = (y - (ground - 23)) / 23
      const bulge = Math.round(6 * Math.sqrt(Math.max(0, 1 - dy * dy)))
      fill(f, cx - bulge, y, bulge * 2 + 1, 1, SHIELD_BLUE, 0.22)
      put(f, cx + bulge, y, WHITE, 0.6)
    }
  }

  // ---- zZz over a resting party ----
  if (!standing) {
    g.heroes.forEach((_, i) => {
      const x = HERO_X[i] ?? HERO_X[HERO_X.length - 1]!
      for (let k = 0; k < 3; k += 1) {
        const rise = (t + k * 6 + i * 3) % 18
        text(f, k === 2 ? 'Z' : 'z', x + 6 + k * 4 + Math.floor(rise / 6), ground - 30 - rise, WHITE, 1)
      }
    })
  }

  // ---- numbers, and a flash for a critical volley ----
  const numberTop = Math.max(2, monsterTop - 10)
  for (const n of a.numbers) {
    const rel = t - n.at
    if (rel < 0 || rel >= NUMBER_FRAMES) continue
    const top = Math.max(1, numberTop - Math.min(rel, 3) * 2)
    if (n.kind === 'crit') text(f, compact(n.value), MONSTER_X, top - 4, GOLD, 2)
    else text(f, compact(n.value), MONSTER_X, top, n.kind === 'blocked' ? BLOCKED_GRAY : WHITE, 1)
    if (n.kind === 'crit' && rel === 0) wash(f, WHITE, 0.55)
  }

  return f
}

/** A still frame of the fight, as the band shows before any animation runs. */
export function stillScene(g: GameState, atlases: Atlases): Frame {
  return compose(g, stillAnim(g), atlases)
}
