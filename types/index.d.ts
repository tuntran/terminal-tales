export type HeroClass = 'warrior' | 'mage' | 'ranger'

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export type Slot = 'weapon' | 'armor' | 'trinket'

export type MonsterTier = 'normal' | 'elite' | 'rare' | 'boss'

export type Item = {
  id: string
  name: string
  slot: Slot
  rarity: Rarity
  /** Stage the item dropped at: sets its base power. */
  stage: number
  /** Times upgraded in the /hero pane. */
  level: number
}

export type Hero = {
  id: string
  name: string
  cls: HeroClass
  level: number
  exp: number
  hp: number
  gear: { weapon: Item | null; armor: Item | null; trinket: Item | null }
}

export type Monster = {
  name: string
  sprite: number
  tier: MonsterTier
  hp: number
  maxHp: number
  atk: number
}

export type GameStats = {
  kills: number
  toolCalls: number
  testPasses: number
  itemsFound: number
}

export type PendingRewards = { toolCalls: number; testPasses: number }

export type GameState = {
  version: 1
  seed: number
  nextId: number
  gold: number
  stage: number
  /** Kills in the current stage; the boss comes at KILLS_PER_STAGE. */
  stageKills: number
  heroes: Hero[]
  inventory: Item[]
  monster: Monster
  /** Steps left before a wiped party stands up again; 0 while fighting. */
  resting: number
  /** Animation frame, flipped every combat step. */
  frame: number
  log: string[]
  stats: GameStats
}

declare module 'claude-code' {
  interface PluginState {
    'terminal-tales': {
      game: GameState | null
      selectedHero: number
      /** The store revision this session's game builds on. */
      baseRev: number
      /** Activity rewards earned since the last save, replayed onto another session's newer save. */
      pending: PendingRewards
      /** True when the store holds a save from a newer version: this session never writes it. */
      isSaveLocked: boolean
    }
  }
}
