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

/** Something the user did that buffs one side of the fight. */
export type GameAction =
  | 'prompt'
  | 'turnDone'
  | 'permissionAllowed'
  | 'commit'
  | 'compact'
  | 'turnAborted'
  | 'permissionDenied'
  | 'bashFailed'

export type EffectKind =
  | 'rally'
  | 'secondWind'
  | 'trust'
  | 'milestone'
  | 'calm'
  | 'enrage'
  | 'stoneskin'
  | 'regen'

/** A lasting effect: `steps` counts down each combat step, `charges` each blocked volley or hit. */
export type Effect = { kind: EffectKind; steps: number; charges: number }

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
  /** Lasting buffs from the user's actions; one of each kind at most. */
  effects: Effect[]
}

export type SyncMode = 'starting' | 'daemon' | 'solo' | 'locked'

declare module 'claude-code' {
  interface PluginState {
    'terminal-tales': {
      game: GameState | null
      selectedHero: number
      /**
       * Where the game runs: `starting` until the daemon answers or is given up
       * on, `daemon` while the shared fight shows, `solo` when this session
       * runs its own and saves it in `$.store`, `locked` when the save comes
       * from a newer version and this session plays a game it never writes.
       */
      syncMode: SyncMode
    }
  }
}
