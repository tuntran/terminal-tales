import type { GameState, HeroClass, MonsterTier } from '../../types'

import { heroStats } from '../game/engine'

// Pixel sprites. Each row is a string of palette keys, '.' transparent. Two
// pixel rows share one terminal cell through the half block '▀': its
// foreground paints the upper pixel and its background the lower one.

export const PALETTE: Record<string, number> = {
  K: 0x1a1c2c, // outline
  D: 0x333c57, // visor
  L: 0xe8eef4, // steel light
  A: 0xa8bccb, // steel
  a: 0x6a7f97, // steel shade
  d: 0x44546b, // steel dark
  S: 0xf6cba4, // skin
  s: 0xd2916b, // skin shade
  H: 0x7a4a2a, // hair
  q: 0xf27e7e, // red light
  R: 0xc23b4f, // red
  Q: 0x7d2340, // red dark
  Y: 0xffe08a, // gold
  y: 0xd6a142, // gold shade
  I: 0xfff36b, // glowing eye
  B: 0x4a7bd8, // blue
  b: 0x8fc1ff, // blue light
  C: 0x24407a, // blue dark
  N: 0x8b5a2b, // wood
  n: 0x5a3a1e, // wood dark
  W: 0xffffff, // white
  P: 0x6b3fa0, // purple
  p: 0x9d6fd6, // purple light
  V: 0x3b1f5e, // purple dark
  E: 0x73eff7, // arcane glow
  e: 0x2fb7c9, // arcane glow shade
  G: 0x4fbf5a, // green
  g: 0x9be37a, // green light
  F: 0x2a6b3a, // green dark
  O: 0xf08a3c, // orange
  o: 0xb85a1e, // orange dark
  Z: 0xe8dcc0, // bone
  z: 0xb0a080, // bone shade
}

export type Sprite = readonly string[]

export const PIXEL_HEROES: Record<HeroClass, Sprite> = {
  warrior: [
    '......qRR........',
    '.....KKKKKK...W..',
    '....KLLAAAaK.KLK.',
    '...KLAAAAAAaKKLK.',
    '...KAAAAAAaaKKAK.',
    '...KDDDDDDDDKKAK.',
    '...KSSKSSKSsKKAK.',
    '....KsSSSSsKKYYYK',
    '..KKKKAAAAKKKKyK.',
    '.KbBBKLAAAAaKSnK.',
    'KbBYBKAAqRAaaKK..',
    'KBYYYBKARRQaaK...',
    'KBBYBBKAAQAaaK...',
    'KCBBBCKyYYYyyK...',
    '.KCBCKKaAAAaaK...',
    '..KCK.KaAKAadK...',
    '......KdaKdadK...',
    '.....KNNnKNNnK...',
    '.....KNnnKNnnnK..',
    '.....KKKKKKKKKK..',
  ],
  mage: [
    '........K.....eE.',
    '.......KpK...eEWE',
    '......KpPVK..eEEe',
    '.....KpPYPVK..eN.',
    '....KpPPPPPVK..N.',
    '..KKKKKKKKKKKK.N.',
    '...KHSSKSSKSHK.N.',
    '...KHSSKSSKSHK.N.',
    '....KHsSSSsHK.SN.',
    '....KVPPpPPVKSSN.',
    '...KVPPPpPPPVK.N.',
    '...KPPPPpPPPPK.N.',
    '..KVPPPYpYPPPVKN.',
    '..KPPPPPpPPPPPKN.',
    '..KVPPPPpPPPPVKN.',
    '..KVPPPPpPPPPVKN.',
    '.KVPPPPPpPPPPPKN.',
    '.KVVPPPPpPPPPVVKN',
    '.KKVVVVVVVVVVVKN.',
    '..KKnK...KnKK.nN.',
  ],
  ranger: [
    '.....KKKKK.......',
    '....KFGGGgK...n..',
    '...KFGGGGGgK.WN..',
    '...KFGGGGGGKKWN..',
    '...KGHHSKSSK.WN..',
    '...KGSSSKSSK.WN..',
    '...KFKsSSSsK.WN..',
    '....KKKKKKK..WN..',
    '...KFGGNGGFKSWN..',
    '..KFGGGNGGGFKSN..',
    '..KFGgGNGGgFKWN..',
    '..KSKGGNGGFKKWN..',
    '..KSKYYYYYyK.WN..',
    '...KKFGGGGFK.WN..',
    '....KFGKFGFK.WN..',
    '....KFGKFGFK.WN..',
    '....KFFKFFFK.Wn..',
    '...KNNnKNNnK..n..',
    '...KNnnKNnnnK....',
    '...KKKKKKKKKK....',
  ],
}

/** Monsters in the order of the catalog's MONSTERS list. */
export const PIXEL_MONSTERS: readonly Sprite[] = [
  // Slime Bug
  [
    '................',
    '.....K....K.....',
    '......K..K......',
    '.......KK.......',
    '.....KKbbKK.....',
    '....KbWWbbbK....',
    '...KbWbbbbbbK...',
    '..KbbbbbbbbbbK..',
    '..KbbKWbbKWbbK..',
    '.KbbbKKbbKKbbbK.',
    '.KbbbbbbbbbbbbK.',
    'KBbbbbbqqbbbbbBK',
    'KBBbbbbbbbbbbBBK',
    'KCBBBBBBBBBBBBCK',
    '.KCCCCCCCCCCCCK.',
    '..KKKKKKKKKKKK..',
  ],
  // Goblin Lint
  [
    '................',
    '......KKKK......',
    '.KK..KGGGGK..KK.',
    'KgGKKGGGGGGKKGgK',
    '.KgGGIKGGIKGGgK.',
    '..KGGGGGGGGGGK..',
    '...KGGKWKWKGK...',
    '....KKFFFFKK.Nn.',
    '...KoOOOOOOK.NN.',
    '..KGKoOOOOoKGNK.',
    '..KGKOOOOOOKKN..',
    '...KKoooooK.....',
    '....KFFKFFK.....',
    '....KFFKFFK.....',
    '...KnnK.KnnK....',
    '...KKKK.KKKK....',
  ],
  // Dơi Null
  [
    '................',
    '................',
    '................',
    'K......KK......K',
    'KK....KVVK....KK',
    'KPK..KVpVVK..KPK',
    'KPPK.KIKVIK.KPPK',
    'KPpPKKVVVVKKPpPK',
    'KPPpPKVWVWKPpPPK',
    '.KPPpPKVVKPpPPK.',
    '..KPKPPKKPPKPK..',
    '...K.KPK.KPK.K..',
    '......K...K.....',
    '................',
    '................',
    '................',
  ],
  // Xương Rò Rỉ
  [
    '................',
    '.....KKKKK......',
    '....KZZZZZK.....',
    '...KZZZZZZZK....',
    '...KZKKZKKZK....',
    '...KZKRZKRZK....',
    '...KzZZKZZzK....',
    '....KZKZKZK.....',
    '.....KKKKK......',
    '...KK.KZK.KK....',
    '..KZZKZZZKZZK...',
    '..KzKKZKZKKzK.b.',
    '..KZK.KZK.KZK...',
    '......KZK.......',
    '.....KZKZK....b.',
    '....KZK.KZK.....',
  ],
  // Nấm Race
  [
    '................',
    '.....KKKKKK.....',
    '...KKRqRRRRKK...',
    '..KRRWWRRRqRRK..',
    '.KRRWWRRRRWWRRK.',
    '.KRRRRRRRRWWRRK.',
    'KRRWWRRRRRRRRRRK',
    'KQRWWRRRRRWWRRQK',
    'KKQQRRRRRRRRQQKK',
    '..KKKKKKKKKKKK..',
    '...KZZZZZZZZK...',
    '...KZKZZZZKZK...',
    '...KZZZZZZZZK...',
    '...KzZZqqZZzK...',
    '...KzzZZZZzzK...',
    '....KKKKKKKK....',
  ],
]

/** Bosses in the order of the catalog's BOSSES list. */
export const PIXEL_BOSSES: readonly Sprite[] = [
  // Rồng Merge Conflict
  [
    '..K..............K..',
    '.KYK............KYK.',
    '.KyYK..........KYyK.',
    '..KyRKKKKKKKKKKRyK..',
    '...KRRRRRRRRRRRRK...',
    '..KRRRRRRRRRRRRRRK..',
    '..KRRIKRRRRRRIKRRK..',
    '..KRRKKRRRRRRKKRRK..',
    '..KRRRRRRRRRRRRRRK..',
    '...KRRWKWKWKWKRRK...',
    '...KQRRRRRRRRRRQK.K.',
    '..KQRROOOOOOOORRQKRK',
    '.KRRROOoOOOOoOORRRRK',
    '.KRRROOOOOOOOOORRRK.',
    'KRQRROOoOOOOoOORRQRK',
    'KRQRRROOOOOOOORRRQRK',
    '.KQRRRRRRRRRRRRRRQK.',
    '..KRRQKKKKKKKKQRRK..',
    '..KRRK........KRRK..',
    '..KKKK........KKKK..',
  ],
  // Quỷ Deadlock
  [
    '..K..............K..',
    '.KRK............KRK.',
    '.KRQK..........KQRK.',
    '..KQRKKKKKKKKKKRQK..',
    '...KVVVVVVVVVVVVK...',
    '..KVPPPPPPPPPPPPVK..',
    '..KPPIIKPPPPKIIPPK..',
    '..KPPPKKPPPPKKPPPK..',
    '..KPPPPPPPPPPPPPPK..',
    '...KPKWKWKWKWKPK....',
    'AA.KVPPPPPPPPPPVK.AA',
    'aAAKPPPpPPPPpPPPKAAa',
    '.aKVPPPPPPPPPPPPVKa.',
    '..KPPPYYPPPPYYPPPK..',
    '..KVPPPPPPPPPPPPVK..',
    '..KVPPPPPPPPPPPPVK..',
    '...KVVVVKKKKVVVVK...',
    '...KPPK......KPPK...',
    '..KPPPK......KPPPK..',
    '..KKKKK......KKKKK..',
  ],
]

// ---------- composing a scene ----------

/** A pixel canvas: `null` is transparent, drawn in the terminal's own background. */
type Canvas = { width: number; height: number; px: (number | null)[] }

const GROUND_GAP = 2
const HERO_GAP = 1
const VS_GAP = 5
/** Pixel rows under the sprites: one for the gap, two for the HP bars. */
const BAR_ROWS = 2

const TIER_OUTLINE: Partial<Record<MonsterTier, number>> = {
  elite: 0x2fb7c9,
  rare: 0xb55088,
}

function width(sprite: Sprite): number {
  return Math.max(...sprite.map(row => row.length))
}

function gray(color: number): number {
  const v = Math.round(((color >> 16) & 255) * 0.3 + ((color >> 8) & 255) * 0.59 + (color & 255) * 0.11) * 0.6
  const c = Math.round(v)
  return (c << 16) | (c << 8) | c
}

function stamp(canvas: Canvas, sprite: Sprite, left: number, bottom: number, tint: (key: string, color: number) => number): void {
  const top = bottom - sprite.length
  sprite.forEach((row, y) => {
    Array.from(row).forEach((key, x) => {
      const color = PALETTE[key]
      const cx = left + x
      const cy = top + y
      if (color === undefined || cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) return
      canvas.px[cy * canvas.width + cx] = tint(key, color)
    })
  })
}

function hpBar(canvas: Canvas, left: number, w: number, y: number, ratio: number, fill: number): void {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * w)
  for (let x = 0; x < w; x += 1) canvas.px[y * canvas.width + left + x] = x < filled ? fill : 0x3a3f58
}

export type PixelScene = { columns: number; rows: number; cells: string }

/** Lays the party and the monster out as one half-block picture. */
export function pixelScene(game: GameState): PixelScene {
  const heroes = game.heroes.map(hero => PIXEL_HEROES[hero.cls])
  const monster =
    game.monster.tier === 'boss'
      ? (PIXEL_BOSSES[game.monster.sprite] ?? PIXEL_BOSSES[0]!)
      : (PIXEL_MONSTERS[game.monster.sprite] ?? PIXEL_MONSTERS[0]!)
  const lunge = game.frame === 1 && game.resting === 0 ? 1 : 0
  const heroesWidth = heroes.reduce((sum, s) => sum + width(s) + HERO_GAP, 0)
  const canvasWidth = heroesWidth + VS_GAP + width(monster) + 1
  const spriteHeight = Math.max(...heroes.map(s => s.length), monster.length)
  // An even height, so every cell row holds two whole pixel rows.
  const canvasHeight = Math.ceil((spriteHeight + GROUND_GAP + BAR_ROWS) / 2) * 2
  const canvas: Canvas = { width: canvasWidth, height: canvasHeight, px: Array(canvasWidth * canvasHeight).fill(null) }
  const ground = spriteHeight
  const barY = canvasHeight - 1

  let left = 0
  game.heroes.forEach((hero, i) => {
    const sprite = heroes[i]!
    const isDown = hero.hp <= 0
    stamp(canvas, sprite, left + (isDown ? 0 : lunge), ground, (_, color) => (isDown ? gray(color) : color))
    hpBar(canvas, left + 1, width(sprite) - 2, barY, hero.hp / heroStats(hero).maxHp, 0x4fbf5a)
    left += width(sprite) + HERO_GAP
  })

  const monsterLeft = heroesWidth + VS_GAP
  const outline = TIER_OUTLINE[game.monster.tier]
  stamp(canvas, monster, monsterLeft - lunge, ground - lunge, (key, color) => (key === 'K' && outline !== undefined ? outline : color))
  hpBar(canvas, monsterLeft + 1, width(monster) - 2, barY, game.monster.hp / game.monster.maxHp, 0xc23b4f)

  return { columns: canvas.width, rows: canvas.height / 2, cells: encodeCells(canvas) }
}

// ---------- the Raster's cells ----------

const DEFAULT_COLOR = 0x01000000
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const SPACE = 0x20

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

/** Packs the canvas as `[codePoint, foreground, background]` u32 triplets, little-endian, base64. */
function encodeCells(canvas: Canvas): string {
  const rows = canvas.height / 2
  const words = new Uint32Array(canvas.width * rows * 3)
  for (let row = 0; row < rows; row += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const top = canvas.px[row * 2 * canvas.width + x] ?? null
      const bottom = canvas.px[(row * 2 + 1) * canvas.width + x] ?? null
      const at = (row * canvas.width + x) * 3
      if (top === null && bottom === null) words.set([SPACE, DEFAULT_COLOR, DEFAULT_COLOR], at)
      else if (top === null) words.set([LOWER_HALF, bottom!, DEFAULT_COLOR], at)
      else words.set([UPPER_HALF, top, bottom ?? DEFAULT_COLOR], at)
    }
  }
  return base64(new Uint8Array(words.buffer))
}

/** Reads cells back: what a preview outside Claude Code draws from. */
export function decodeCells(scene: PixelScene): { ch: string; fg: number | null; bg: number | null }[][] {
  const bin = Array.from(scene.cells.replace(/=+$/, '')).map(ch => B64.indexOf(ch))
  const bytes: number[] = []
  for (let i = 0; i < bin.length; i += 4) {
    const n = (bin[i]! << 18) | ((bin[i + 1] ?? 0) << 12) | ((bin[i + 2] ?? 0) << 6) | (bin[i + 3] ?? 0)
    bytes.push((n >> 16) & 255)
    if (i + 2 < bin.length) bytes.push((n >> 8) & 255)
    if (i + 3 < bin.length) bytes.push(n & 255)
  }
  const words = new Uint32Array(new Uint8Array(bytes).buffer)
  const color = (c: number) => (c === DEFAULT_COLOR ? null : c)
  return Array.from({ length: scene.rows }, (_, row) =>
    Array.from({ length: scene.columns }, (_, x) => {
      const at = (row * scene.columns + x) * 3
      return { ch: String.fromCodePoint(words[at]!), fg: color(words[at + 1]!), bg: color(words[at + 2]!) }
    }),
  )
}
