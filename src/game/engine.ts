import type { Effect, EffectKind, GameAction, GameState, Hero, HeroClass, Item, Monster, MonsterTier, Rarity, Slot } from '../../types'

import {
  ACTION_EFFECT,
  BOSSES,
  CLASSES,
  EFFECTS,
  ITEM_NAMES,
  KILLS_PER_STAGE,
  LOG_SIZE,
  MAX_INVENTORY,
  MAX_PARTY,
  MONSTERS,
  RARITIES,
  RARITY_ORDER,
  RECRUIT_COST,
  REST_STEPS,
  SLOT_ORDER,
  TIERS,
} from './catalog'

// Every function here is pure: it takes a state and returns a new one, and
// draws its randomness from the seed the state carries, so a game replays
// exactly under the same seed.

/** One step of mulberry32: the next seed and a float in [0, 1). */
function nextRandom(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296]
}

/** A random draw over a mutable copy of the state, advancing its seed. */
function rand(g: GameState): number {
  const [seed, value] = nextRandom(g.seed)
  g.seed = seed
  return value
}

function pick<T>(g: GameState, list: readonly T[]): T {
  return list[Math.floor(rand(g) * list.length)] as T
}

function clone(g: GameState): GameState {
  return JSON.parse(JSON.stringify(g)) as GameState
}

function say(g: GameState, line: string): void {
  g.log = [...g.log, line].slice(-LOG_SIZE)
}

function newId(g: GameState, prefix: string): string {
  g.nextId += 1
  return `${prefix}${g.nextId}`
}

// ---------- stats ----------

export function itemPower(item: Item): number {
  return Math.round((4 + item.stage * 2.5) * RARITIES[item.rarity].power * (1 + 0.15 * item.level))
}

export function itemValue(item: Item): number {
  return Math.max(1, Math.round(itemPower(item) * 1.5))
}

export function upgradeCost(item: Item): number {
  return itemValue(item) * (item.level + 2)
}

export type HeroStats = { maxHp: number; atk: number; crit: number }

export function heroStats(hero: Hero): HeroStats {
  const info = CLASSES[hero.cls]
  const lv = hero.level - 1
  let maxHp = info.baseHp + info.hpPerLevel * lv
  let atk = info.baseAtk + info.atkPerLevel * lv
  let crit = info.crit
  const { weapon, armor, trinket } = hero.gear
  if (weapon) atk += itemPower(weapon)
  if (armor) maxHp += itemPower(armor) * 4
  if (trinket) {
    atk += itemPower(trinket) * 0.4
    crit += Math.min(0.25, itemPower(trinket) / 200)
  }
  return { maxHp: Math.round(maxHp), atk: Math.round(atk), crit: Math.min(0.75, crit) }
}

export function expToNext(level: number): number {
  return Math.round(20 * Math.pow(level, 1.5))
}

// ---------- creation ----------

function makeHero(g: GameState, cls: HeroClass): Hero {
  const taken = new Set(g.heroes.map(h => h.name))
  const free = CLASSES[cls].names.filter(n => !taken.has(n))
  const hero: Hero = {
    id: newId(g, 'h'),
    name: pick(g, free.length > 0 ? free : CLASSES[cls].names),
    cls,
    level: 1,
    exp: 0,
    hp: 0,
    gear: { weapon: null, armor: null, trinket: null },
  }
  hero.hp = heroStats(hero).maxHp
  return hero
}

function spawnMonster(g: GameState): Monster {
  let tier: MonsterTier = 'normal'
  if (g.stageKills >= KILLS_PER_STAGE) {
    tier = 'boss'
  } else {
    const roll = rand(g)
    if (roll < 0.04) tier = 'rare'
    else if (roll < 0.19) tier = 'elite'
  }
  const kinds = tier === 'boss' ? BOSSES : MONSTERS
  const sprite = Math.floor(rand(g) * kinds.length)
  const kind = kinds[sprite] ?? MONSTERS[0]!
  const scale = Math.pow(1.22, g.stage - 1)
  const maxHp = Math.round(30 * scale * TIERS[tier].hp)
  return {
    name: kind.name,
    sprite,
    tier,
    hp: maxHp,
    maxHp,
    atk: Math.max(1, Math.round(4 * Math.pow(1.17, g.stage - 1) * TIERS[tier].atk)),
  }
}

export function newGame(seed: number): GameState {
  const g: GameState = {
    version: 1,
    seed: seed | 0,
    nextId: 0,
    gold: 0,
    stage: 1,
    stageKills: 0,
    heroes: [],
    inventory: [],
    monster: { name: '', sprite: 0, tier: 'normal', hp: 1, maxHp: 1, atk: 1 },
    resting: 0,
    frame: 0,
    log: [],
    stats: { kills: 0, toolCalls: 0, testPasses: 0, itemsFound: 0 },
    effects: [],
  }
  g.heroes.push(makeHero(g, 'warrior'))
  g.monster = spawnMonster(g)
  say(g, `${g.heroes[0]!.name} lên đường. Gặp ${g.monster.name}!`)
  return g
}

// ---------- loot ----------

export function rollRarity(g: GameState, luck: number): Rarity {
  const total = RARITY_ORDER.reduce((sum, r) => sum + RARITIES[r].weight, 0)
  let best = 0
  for (let i = 0; i <= luck; i += 1) {
    let roll = rand(g) * total
    let index = 0
    for (const r of RARITY_ORDER) {
      roll -= RARITIES[r].weight
      if (roll < 0) break
      index += 1
    }
    best = Math.max(best, Math.min(index, RARITY_ORDER.length - 1))
  }
  return RARITY_ORDER[best]!
}

function makeItem(g: GameState, luck: number): Item {
  const slot = pick(g, SLOT_ORDER)
  return {
    id: newId(g, 'i'),
    name: pick(g, ITEM_NAMES[slot]),
    slot,
    rarity: rollRarity(g, luck),
    stage: g.stage,
    level: 0,
  }
}

function gainItem(g: GameState, item: Item): void {
  g.stats.itemsFound += 1
  g.inventory = [...g.inventory, item]
  if (g.inventory.length > MAX_INVENTORY) {
    // A full bag sells its weakest piece so loot never stops.
    const weakest = g.inventory.reduce((low, it) => (itemValue(it) < itemValue(low) ? it : low))
    g.inventory = g.inventory.filter(it => it.id !== weakest.id)
    g.gold += itemValue(weakest)
  }
  say(g, `Nhặt được [${RARITIES[item.rarity].label}] ${item.name}`)
}

// ---------- progression ----------

function gainExp(g: GameState, amount: number): void {
  for (const hero of g.heroes) {
    hero.exp += amount
    while (hero.exp >= expToNext(hero.level)) {
      hero.exp -= expToNext(hero.level)
      hero.level += 1
      hero.hp = heroStats(hero).maxHp
      say(g, `${hero.name} lên cấp ${hero.level}!`)
    }
  }
}

function killMonster(g: GameState): void {
  const m = g.monster
  const tier = TIERS[m.tier]
  const scale = Math.pow(1.15, g.stage - 1)
  const gold = Math.round(5 * scale * tier.reward)
  const exp = Math.round(6 * scale * tier.reward)
  g.gold += gold
  g.stats.kills += 1
  say(g, `Hạ ${m.name} (+${gold} vàng, +${exp} EXP)`)
  gainExp(g, exp)
  if (rand(g) < tier.dropChance) gainItem(g, makeItem(g, tier.luck))
  if (m.tier === 'boss') {
    g.stage += 1
    g.stageKills = 0
    say(g, `Qua ải! Tiến vào ải ${g.stage}.`)
  } else {
    g.stageKills += 1
  }
  g.monster = spawnMonster(g)
}

// ---------- effects ----------

function hasEffect(g: GameState, kind: EffectKind): boolean {
  return g.effects.some(e => e.kind === kind)
}

/** Spends one charge of a shield; true when there was one to spend. */
function useCharge(g: GameState, kind: EffectKind): boolean {
  const effect = g.effects.find(e => e.kind === kind && e.charges > 0)
  if (!effect) return false
  g.effects = g.effects
    .map(e => (e === effect ? { ...e, charges: e.charges - 1 } : e))
    .filter(e => e.steps > 0 || e.charges > 0)
  return true
}

/** Counts every timed effect down by one step and drops those that ran out. */
function tickEffects(g: GameState): void {
  g.effects = g.effects
    .map(e => (e.steps > 0 ? { ...e, steps: e.steps - 1 } : e))
    .filter(e => e.steps > 0 || e.charges > 0)
}

/** A hero's chance to crit in a combat step, with the party's buffs. */
export function critChance(hero: Hero, g: GameState): number {
  const { crit } = heroStats(hero)
  return hasEffect(g, 'trust') ? Math.min(0.75, crit + EFFECTS.trust.power) : crit
}

// ---------- combat ----------

/**
 * The party strikes once; true when the monster fell. Only combat steps feel
 * effects: the free strike of a tool call ignores them, so a burst of calls
 * never burns a buff before the user can see it.
 */
function partyAttacks(g: GameState, withEffects: boolean): boolean {
  for (const hero of g.heroes) {
    if (hero.hp <= 0) continue
    const { atk, crit } = heroStats(hero)
    const damage = rand(g) < (withEffects ? critChance(hero, g) : crit) ? atk * 2 : atk
    g.monster.hp = Math.max(0, g.monster.hp - damage)
    if (g.monster.hp === 0) {
      killMonster(g)
      return true
    }
  }
  return false
}

function stepCombat(state: GameState): GameState {
  const g = clone(state)
  g.frame = g.frame === 0 ? 1 : 0
  if (g.resting > 0) {
    g.resting -= 1
    if (g.resting === 0) {
      for (const hero of g.heroes) hero.hp = heroStats(hero).maxHp
      say(g, 'Cả đội hồi phục, chiến tiếp!')
    }
    return g
  }
  // Stoneskin blocks the party's whole turn, rally's extra volley included.
  if (!useCharge(g, 'stoneskin')) {
    if (partyAttacks(g, true)) return g
    if (hasEffect(g, 'rally') && rand(g) < EFFECTS.rally.power && partyAttacks(g, true)) return g
  }
  const alive = g.heroes.filter(h => h.hp > 0)
  if (alive.length > 0) {
    const target = pick(g, alive)
    if (!useCharge(g, 'milestone')) {
      const atk = hasEffect(g, 'enrage') ? Math.round(g.monster.atk * (1 + EFFECTS.enrage.power)) : g.monster.atk
      target.hp = Math.max(0, target.hp - atk)
    }
  }
  for (const hero of g.heroes) {
    if (hero.hp > 0) hero.hp = Math.min(heroStats(hero).maxHp, hero.hp + Math.ceil(heroStats(hero).maxHp * 0.03))
  }
  if (g.heroes.every(h => h.hp <= 0)) {
    g.resting = REST_STEPS
    g.monster.hp = g.monster.maxHp
    say(g, `Cả đội gục trước ${g.monster.name}... nghỉ một chút.`)
  }
  return g
}

/** One combat step: the party strikes, the monster answers, the frame flips, effects count down. */
export function step(state: GameState): GameState {
  const g = stepCombat(state)
  tickEffects(g)
  return g
}

// ---------- coding activity ----------

/** Any finished tool call: a little gold and EXP and one free strike. */
export function rewardToolCall(state: GameState): GameState {
  const g = clone(state)
  g.stats.toolCalls += 1
  g.gold += 1 + Math.floor(g.stage / 2)
  gainExp(g, 2 + g.stage)
  if (g.resting === 0) partyAttacks(g, false)
  return g
}

/**
 * Something the user did: a good action buffs the party, a bad one the
 * monster. An instant effect applies now; a lasting one replaces any of its
 * kind at full length, so the same action refreshes rather than stacks.
 */
export function applyAction(state: GameState, action: GameAction): GameState {
  const g = clone(state)
  const kind = ACTION_EFFECT[action]
  const info = EFFECTS[kind]
  if (kind === 'secondWind' || kind === 'calm') {
    for (const hero of g.heroes) {
      if (hero.hp <= 0) continue
      const max = heroStats(hero).maxHp
      hero.hp = Math.min(max, hero.hp + Math.round(max * info.power))
    }
  } else if (kind === 'regen') {
    g.monster.hp = Math.min(g.monster.maxHp, g.monster.hp + Math.round(g.monster.maxHp * info.power))
  } else {
    g.effects = [...g.effects.filter(e => e.kind !== kind), { kind, steps: info.steps, charges: info.charges }]
  }
  say(g, info.line)
  return g
}

/** A passing test run: a big purse, EXP and a guaranteed lucky drop. */
export function rewardTestPass(state: GameState): GameState {
  const g = clone(state)
  g.stats.testPasses += 1
  const gold = 20 + 10 * g.stage
  const exp = 30 + 8 * g.stage
  g.gold += gold
  say(g, `Test xanh! +${gold} vàng, +${exp} EXP`)
  gainExp(g, exp)
  gainItem(g, makeItem(g, 2))
  return g
}

// ---------- /hero actions ----------

export type ActionResult = { state: GameState; error?: string }

export function equip(state: GameState, heroId: string, itemId: string): ActionResult {
  const g = clone(state)
  const hero = g.heroes.find(h => h.id === heroId)
  const item = g.inventory.find(it => it.id === itemId)
  if (!hero || !item) return { state, error: 'Không tìm thấy anh hùng hoặc vật phẩm.' }
  const old = hero.gear[item.slot]
  const before = heroStats(hero).maxHp
  hero.gear[item.slot] = item
  g.inventory = g.inventory.filter(it => it.id !== itemId)
  if (old) g.inventory = [...g.inventory, old]
  // A fallen hero stays down until the rest; a standing one never drops to 0
  // from a swap, so a swap alone can neither revive nor wipe the party.
  hero.hp = hero.hp <= 0 ? 0 : Math.max(1, Math.min(heroStats(hero).maxHp, hero.hp + heroStats(hero).maxHp - before))
  say(g, `${hero.name} trang bị ${item.name}`)
  return { state: g }
}

export function unequip(state: GameState, heroId: string, slot: Slot): ActionResult {
  const g = clone(state)
  const hero = g.heroes.find(h => h.id === heroId)
  const item = hero?.gear[slot]
  if (!hero || !item) return { state, error: 'Ô trang bị đang trống.' }
  if (g.inventory.length >= MAX_INVENTORY) return { state, error: 'Túi đồ đã đầy.' }
  hero.gear[slot] = null
  g.inventory = [...g.inventory, item]
  hero.hp = Math.min(hero.hp, heroStats(hero).maxHp)
  return { state: g }
}

export function sell(state: GameState, itemId: string): ActionResult {
  const g = clone(state)
  const item = g.inventory.find(it => it.id === itemId)
  if (!item) return { state, error: 'Không tìm thấy vật phẩm.' }
  g.inventory = g.inventory.filter(it => it.id !== itemId)
  g.gold += itemValue(item)
  say(g, `Bán ${item.name} được ${itemValue(item)} vàng`)
  return { state: g }
}

export function upgrade(state: GameState, heroId: string, slot: Slot): ActionResult {
  const g = clone(state)
  const hero = g.heroes.find(h => h.id === heroId)
  const item = hero?.gear[slot]
  if (!hero || !item) return { state, error: 'Ô trang bị đang trống.' }
  const cost = upgradeCost(item)
  if (g.gold < cost) return { state, error: `Cần ${cost} vàng để nâng cấp.` }
  g.gold -= cost
  item.level += 1
  say(g, `${item.name} lên +${item.level}`)
  return { state: g }
}

export function recruitCost(state: GameState): number | null {
  return state.heroes.length >= MAX_PARTY ? null : (RECRUIT_COST[state.heroes.length] ?? null)
}

export function recruit(state: GameState, cls: HeroClass): ActionResult {
  const cost = recruitCost(state)
  if (cost === null) return { state, error: `Đội đã đủ ${MAX_PARTY} người.` }
  if (state.gold < cost) return { state, error: `Cần ${cost} vàng để chiêu mộ.` }
  const g = clone(state)
  g.gold -= cost
  const hero = makeHero(g, cls)
  g.heroes = [...g.heroes, hero]
  say(g, `${hero.name} (${CLASSES[cls].label}) gia nhập đội!`)
  return { state: g }
}

// ---------- save ----------

const SLOTS_SET = new Set<string>(SLOT_ORDER)

function isItem(value: unknown): value is Item {
  if (typeof value !== 'object' || value === null) return false
  const it = value as Partial<Item>
  return (
    typeof it.id === 'string' &&
    typeof it.name === 'string' &&
    typeof it.slot === 'string' &&
    SLOTS_SET.has(it.slot) &&
    typeof it.rarity === 'string' &&
    Object.hasOwn(RARITIES, it.rarity) &&
    Number.isFinite(it.stage) &&
    Number.isFinite(it.level)
  )
}

function isHero(value: unknown): value is Hero {
  if (typeof value !== 'object' || value === null) return false
  const h = value as Partial<Hero>
  const gear = h.gear as Record<string, unknown> | undefined
  return (
    typeof h.id === 'string' &&
    typeof h.name === 'string' &&
    typeof h.cls === 'string' &&
    Object.hasOwn(CLASSES, h.cls) &&
    Number.isFinite(h.level) &&
    Number.isFinite(h.exp) &&
    Number.isFinite(h.hp) &&
    typeof gear === 'object' &&
    gear !== null &&
    SLOT_ORDER.every(slot => gear[slot] === null || (isItem(gear[slot]) && (gear[slot] as Item).slot === slot))
  )
}

function isMonster(value: unknown): value is Monster {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Partial<Monster>
  return (
    typeof m.name === 'string' &&
    typeof m.tier === 'string' &&
    Object.hasOwn(TIERS, m.tier) &&
    Number.isFinite(m.sprite) &&
    Number.isFinite(m.hp) &&
    Number.isFinite(m.maxHp) &&
    Number.isFinite(m.atk)
  )
}

function isEffect(value: unknown): value is Effect {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Partial<Effect>
  return (
    typeof e.kind === 'string' &&
    Object.hasOwn(EFFECTS, e.kind) &&
    typeof e.steps === 'number' &&
    Number.isFinite(e.steps) &&
    e.steps >= 0 &&
    typeof e.charges === 'number' &&
    Number.isFinite(e.charges) &&
    e.charges >= 0
  )
}

/**
 * Reads a stored save, or null when it is missing or not one this version
 * understands. Effects are short-lived, so a bad one is dropped rather than
 * failing the whole save, and a save from before effects loads with none.
 */
export function parseSave(raw: unknown): GameState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const g = raw as Partial<GameState>
  const stats = g.stats as Partial<GameState['stats']> | undefined
  const isValid =
    g.version === 1 &&
    Number.isFinite(g.seed) &&
    Number.isFinite(g.nextId) &&
    Number.isFinite(g.gold) &&
    Number.isFinite(g.stage) &&
    Number.isFinite(g.stageKills) &&
    Number.isFinite(g.resting) &&
    Number.isFinite(g.frame) &&
    Array.isArray(g.heroes) &&
    g.heroes.length > 0 &&
    g.heroes.every(isHero) &&
    Array.isArray(g.inventory) &&
    g.inventory.every(isItem) &&
    isMonster(g.monster) &&
    Array.isArray(g.log) &&
    g.log.every(line => typeof line === 'string') &&
    typeof stats === 'object' &&
    stats !== null &&
    Number.isFinite(stats.kills) &&
    Number.isFinite(stats.toolCalls) &&
    Number.isFinite(stats.testPasses) &&
    Number.isFinite(stats.itemsFound)
  if (!isValid) return null
  const effects = Array.isArray(g.effects) ? g.effects.filter(isEffect) : []
  return { ...(raw as GameState), effects }
}

/** True for a save written by a newer version of the game: never overwrite it. */
export function isNewerSave(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const version = (raw as { version?: unknown }).version
  return typeof version === 'number' && version > 1
}
