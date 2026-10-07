import type { HeroClass, MonsterTier, Rarity, Slot } from '../../types'

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

export type MonsterKind = { name: string; sprite: readonly string[] }

export const MONSTERS: readonly MonsterKind[] = [
  { name: 'Slime Bug', sprite: ['      ', ' .--. ', '(o  o)', ' `--` '] },
  { name: 'Goblin Lint', sprite: ['  ,,  ', ' (><) ', ' /||\\ ', '  /\\  '] },
  { name: 'Dơi Null', sprite: ['      ', '/\\  /\\', '\\(oo)/', '  vv  '] },
  { name: 'Xương Rò Rỉ', sprite: ['  __  ', ' (xx) ', ' -||- ', '  /\\  '] },
  { name: 'Nấm Race', sprite: [' .--. ', '(o..o)', ' |  | ', ' "--" '] },
]

export const BOSSES: readonly MonsterKind[] = [
  { name: 'Rồng Merge Conflict', sprite: ['  /\\_/\\', ' <(@@)>', '/|_vv_|', ' /    \\'] },
  { name: 'Quỷ Deadlock', sprite: [' )\\ /( ', ' (OwO) ', '<|###|>', ' /   \\ '] },
]

export const HERO_SPRITES: Record<HeroClass, readonly [readonly string[], readonly string[]]> = {
  warrior: [
    ['  o  ', ' /|\\ ', ' / \\ '],
    ['  o  ', ' /|--', ' / \\ '],
  ],
  mage: [
    ['  ^  ', ' (o) ', ' /|\\*'],
    ['  ^ *', ' (o)~', ' /|\\ '],
  ],
  ranger: [
    ['  o  ', ' (|) ', ' / \\ '],
    ['  o  ', ' (|>-', ' / \\ '],
  ],
}

export const DOWN_SPRITE: readonly string[] = ['     ', '     ', ' _o_ ']

export const KILLS_PER_STAGE = 10
export const MAX_PARTY = 3
export const MAX_INVENTORY = 24
export const REST_STEPS = 4
export const LOG_SIZE = 6
export const RECRUIT_COST: readonly number[] = [0, 150, 900]
