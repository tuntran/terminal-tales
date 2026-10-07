import type { EffectKind, GameAction, HeroClass, Monster, MonsterTier, Rarity, Slot } from '../../types'

export type ClassInfo = {
  label: string
  baseHp: number
  baseAtk: number
  crit: number
  hpPerLevel: number
  atkPerLevel: number
  names: readonly string[]
}

export const CLASSES: Record<HeroClass, ClassInfo> = {
  warrior: {
    label: 'Kiếm Sĩ',
    baseHp: 120,
    baseAtk: 10,
    crit: 0.05,
    hpPerLevel: 18,
    atkPerLevel: 2.2,
    names: ['Thạch Sanh', 'Gióng', 'Bảo Long', 'Thiết Hổ'],
  },
  mage: {
    label: 'Pháp Sư',
    baseHp: 70,
    baseAtk: 16,
    crit: 0.08,
    hpPerLevel: 10,
    atkPerLevel: 3.4,
    names: ['Mây Tím', 'Lam Nguyệt', 'Huyền Vũ', 'Tinh Sương'],
  },
  ranger: {
    label: 'Xạ Thủ',
    baseHp: 90,
    baseAtk: 12,
    crit: 0.25,
    hpPerLevel: 13,
    atkPerLevel: 2.6,
    names: ['Lạc Phong', 'Hạc Xám', 'Tên Gió', 'Ưng Vàng'],
  },
}

export const CLASS_ORDER: readonly HeroClass[] = ['warrior', 'mage', 'ranger']

export type RarityInfo = { label: string; power: number; weight: number; color: string }

export const RARITIES: Record<Rarity, RarityInfo> = {
  common: { label: 'Thường', power: 1, weight: 60, color: 'gray' },
  uncommon: { label: 'Khá', power: 1.4, weight: 25, color: 'green' },
  rare: { label: 'Hiếm', power: 2, weight: 10, color: 'blue' },
  epic: { label: 'Sử Thi', power: 3, weight: 4, color: 'magenta' },
  legendary: { label: 'Huyền Thoại', power: 4.5, weight: 1, color: 'yellow' },
}

export const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

export const SLOT_LABEL: Record<Slot, string> = {
  weapon: 'Vũ khí',
  armor: 'Giáp',
  trinket: 'Bùa',
}

export const SLOT_ORDER: readonly Slot[] = ['weapon', 'armor', 'trinket']

export const ITEM_NAMES: Record<Slot, readonly string[]> = {
  weapon: ['Kiếm Gỉ', 'Gậy Sồi', 'Cung Tre', 'Rìu Đá', 'Dao Găm', 'Thương Sắt'],
  armor: ['Áo Vải', 'Giáp Da', 'Khiên Gỗ', 'Áo Lưới', 'Mũ Đồng', 'Giáp Vảy'],
  trinket: ['Nhẫn Đồng', 'Bùa Hạt', 'Ngọc Bích', 'Lông Phượng', 'Vỏ Ốc', 'Chuông Bạc'],
}

export type TierInfo = {
  label: string
  hp: number
  atk: number
  reward: number
  dropChance: number
  /** Rolls added toward rarer loot: each one keeps the best of extra rolls. */
  luck: number
  color: string
}

export const TIERS: Record<MonsterTier, TierInfo> = {
  normal: { label: 'Thường', hp: 1, atk: 1, reward: 1, dropChance: 0.12, luck: 0, color: 'white' },
  elite: { label: 'Tinh Anh', hp: 2.5, atk: 1.4, reward: 3, dropChance: 0.35, luck: 1, color: 'cyan' },
  rare: { label: 'Hiếm', hp: 4, atk: 1.6, reward: 6, dropChance: 0.7, luck: 2, color: 'magenta' },
  boss: { label: 'Boss', hp: 8, atk: 2, reward: 12, dropChance: 1, luck: 2, color: 'red' },
}

/** The sprite sheet a monster is drawn from: an id of the atlas built from assets/source. */
export type MonsterAsset = 'skeleton' | 'goblin' | 'mushroom' | 'flying-eye' | 'evil-wizard' | 'evil-wizard-2' | 'evil-wizard-3'

export type MonsterKind = { name: string; asset: MonsterAsset }

// A save keeps a monster's index into these lists: append, never reorder.
export const MONSTERS: readonly MonsterKind[] = [
  { name: 'Xương Rò Rỉ', asset: 'skeleton' },
  { name: 'Goblin Lint', asset: 'goblin' },
  { name: 'Nấm Race', asset: 'mushroom' },
  { name: 'Mắt Bay Null', asset: 'flying-eye' },
]

export const BOSSES: readonly MonsterKind[] = [
  { name: 'Pháp Sư Deadlock', asset: 'evil-wizard' },
  { name: 'Pháp Sư Merge Conflict', asset: 'evil-wizard-2' },
  { name: 'Pháp Sư Race Condition', asset: 'evil-wizard-3' },
]

/**
 * The kind a monster is drawn as. Its index wraps, so a save from an older,
 * longer list still draws one of today's kinds.
 */
export function monsterKind(m: Pick<Monster, 'sprite' | 'tier'>): MonsterKind {
  const kinds = m.tier === 'boss' ? BOSSES : MONSTERS
  const n = kinds.length
  const i = Number.isFinite(m.sprite) ? ((Math.trunc(m.sprite) % n) + n) % n : 0
  return kinds[i]!
}

export const KILLS_PER_STAGE = 10
export const MAX_PARTY = 3
export const MAX_INVENTORY = 24
export const REST_STEPS = 4
export const LOG_SIZE = 6
export const RECRUIT_COST: readonly number[] = [0, 150, 900]

export type EffectInfo = {
  side: 'heroes' | 'monster'
  label: string
  icon: string
  /** Combat steps it lasts; 0 for an instant effect or a shield. */
  steps: number
  /** Volleys or hits a shield blocks; 0 for anything else. */
  charges: number
  /** Chance, bonus or share of max HP, depending on the kind. */
  power: number
  line: string
}

export const EFFECTS: Record<EffectKind, EffectInfo> = {
  rally: { side: 'heroes', label: 'Hô khiến', icon: '>>', steps: 20, charges: 0, power: 0.2, line: 'Hô khiến! Cả đội hăng hái.' },
  secondWind: { side: 'heroes', label: 'Tiếp sức', icon: '+', steps: 0, charges: 0, power: 0.15, line: 'Tiếp sức! Cả đội hồi máu.' },
  trust: { side: 'heroes', label: 'Tin tưởng', icon: '*', steps: 20, charges: 0, power: 0.1, line: 'Tin tưởng! Đòn chí mạng sắc hơn.' },
  milestone: { side: 'heroes', label: 'Cột mốc', icon: '[]', steps: 0, charges: 1, power: 0, line: 'Cột mốc! Khiên chặn đòn kế tiếp của quái.' },
  calm: { side: 'heroes', label: 'Tĩnh tâm', icon: '~', steps: 0, charges: 0, power: 1, line: 'Tĩnh tâm! Cả đội hồi đầy máu.' },
  enrage: { side: 'monster', label: 'Nổi giận', icon: '!!', steps: 20, charges: 0, power: 0.25, line: 'Quái nổi giận!' },
  stoneskin: { side: 'monster', label: 'Giáp đá', icon: '##', steps: 0, charges: 2, power: 0, line: 'Quái khoác giáp đá!' },
  regen: { side: 'monster', label: 'Tái sinh', icon: '^', steps: 0, charges: 0, power: 0.2, line: 'Quái tái sinh!' },
}

export const ACTION_EFFECT: Record<GameAction, EffectKind> = {
  prompt: 'rally',
  turnDone: 'secondWind',
  permissionAllowed: 'trust',
  commit: 'milestone',
  compact: 'calm',
  turnAborted: 'enrage',
  permissionDenied: 'stoneskin',
  bashFailed: 'regen',
}
