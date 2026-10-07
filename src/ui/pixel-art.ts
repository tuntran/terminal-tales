import type { HeroClass } from '../../types'

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
    '....qR......',
    '...KKKKK..W.',
    '..KLAAAaK.W.',
    '..KDDDDDK.W.',
    '..KSKSKsK.W.',
    '...KsSsK.KYK',
    '.KKKAAAKKSK.',
    'KbYBKARaK...',
    'KBYBKAQaK...',
    '.KBKKyYyK...',
    '...KaKKaK...',
    '..KNNKKNNK..',
  ],
  mage: [
    '.....K...eE.',
    '....KpK.eWEe',
    '...KpYVK.eN.',
    '..KpPPPVK.N.',
    '.KKKKKKKKKN.',
    '..KSKSKsK.N.',
    '..KHsSsHKSN.',
    '..KVPpPVKSN.',
    '.KVPPpPPVKN.',
    '.KPPYpYPPKN.',
    '.KVPPpPPVKN.',
    '.KKKnKKnKKn.',
  ],
  ranger: [
    '...KKKK.....',
    '..KFGGgK..n.',
    '.KFGGGGgK.WN',
    '.KGHSKSK..WN',
    '.KFsSSsK..WN',
    '..KKKKK...WN',
    '.KFGNGFKS.WN',
    'KSGGNGGKS.WN',
    '.KYYYYyK..WN',
    '.KFGKFGK..n.',
    '.KFFKFFK....',
    'KNNKKNNK....',
  ],
}

/** Attack poses, drawn over the idle sprite's slot: they may reach past it. */
export const PIXEL_HERO_ATTACKS: Record<HeroClass, Sprite> = {
  warrior: [
    '....qR........',
    '...KKKKK......',
    '..KLAAAaK.....',
    '..KDDDDDK.....',
    '..KSKSKsK.....',
    '...KsSsKK.KKK.',
    '.KKKAAAKSYLLLW',
    'KbYBKARaKKKKK.',
    'KBYBKAQaK.....',
    '.KBKKyYyK.....',
    '...KaKKaK.....',
    '..KNNKKNNK....',
  ],
  mage: [
    '.....K..eEWEe',
    '....KpK.EWWWE',
    '...KpYVK.eNe.',
    '..KpPPPVK.N..',
    '.KKKKKKKKKN..',
    '..KSKSKsK.N..',
    '..KHsSsHKSN..',
    '..KVPpPVKSN..',
    '.KVPPpPPVKN..',
    '.KPPYpYPPKN..',
    '.KVPPpPPVKN..',
    '.KKKnKKnKKn..',
  ],
  ranger: [
    '...KKKK......',
    '..KFGGgK..n..',
    '.KFGGGGgK.NW.',
    '.KGHSKSK..N.W',
    '.KFsSSsK..N.W',
    '..KKKKK...N.W',
    '.KFGNGFKSWNNNY',
    'KSGGNGGK..N.W',
    '.KYYYYyK..N.W',
    '.KFGKFGK..NW.',
    '.KFFKFFK..n..',
    'KNNKKNNK.....',
  ],
}

/** Two stride poses that replace each hero's last two rows while walking. */
export const PIXEL_HERO_STRIDES: Record<HeroClass, readonly [Sprite, Sprite]> = {
  warrior: [
    ['..KaK..KaK..', '.KNNK..KNNK.'],
    ['....KaaK....', '...KNNNNK...'],
  ],
  mage: [
    ['.KVPPpPPVKN.', 'KKnK...KnKn.'],
    ['..KVPpPVK.N.', '...KnnnK..n.'],
  ],
  ranger: [
    ['KFFK..KFFK..', 'NNK....KNNK.'],
    ['..KFFFFK....', '..KNNNNK....'],
  ],
}

/** Monsters in the order of the catalog's MONSTERS list. */
export const PIXEL_MONSTERS: readonly Sprite[] = [
  // Slime Bug
  [
    '....K..K....',
    '.....KK.....',
    '....KbbK....',
    '...KbWbbK...',
    '..KbWbbbbK..',
    '.KbKWbbKWbK.',
    '.KbKKbbKKbK.',
    'KBbbbbqqbbBK',
    'KCBBBBBBBBCK',
    '.KKKKKKKKKK.',
  ],
  // Goblin Lint
  [
    '....KKKK....',
    'KK.KGGGGK.KK',
    'KgKGIKGIKGgK',
    '.KGGGGGGGGK.',
    '..KGKWKWKK.N',
    '...KKFFKK.NN',
    '..KoOOOOK.N.',
    '.KGKOOOoKGK.',
    '...KoooK....',
    '...KFKFK....',
    '..KnK.KnK...',
  ],
  // Dơi Null
  [
    'K....KK....K',
    'KPK.KVVK.KPK',
    'KPPKIVVIKPPK',
    'KPpPKWWKPpPK',
    '.KPPKVVKPPK.',
    '..KK.KK.KK..',
  ],
  // Xương Rò Rỉ
  [
    '..KKKKK...',
    '.KZZZZZK..',
    '.KZKZKZK..',
    '.KZRZRZK..',
    '..KZKZK...',
    '...KKK....',
    '.KKZZZKK..',
    'KZKZZZKZK.',
    '...KZK..b.',
    '..KZKZK...',
    '..KK.KK.b.',
  ],
  // Nấm Race
  [
    '...KKKKKK...',
    '.KKRqRRWRKK.',
    'KRWWRRRRWRRK',
    'KRWRRRRRRRRK',
    'KQRRRWWRRRQK',
    '.KKKKKKKKKK.',
    '..KZZZZZZK..',
    '..KZKZZKZK..',
    '..KzZqqZzK..',
    '...KKKKKK...',
  ],
]

/** Bosses in the order of the catalog's BOSSES list. */
export const PIXEL_BOSSES: readonly Sprite[] = [
  // Rồng Merge Conflict
  [
    '.K............K.',
    'KYK..........KYK',
    'KyRKKKKKKKKKKRyK',
    '.KRRRRRRRRRRRRK.',
    '.KRIKRRRRRRIKRK.',
    '.KRRRRRRRRRRRRK.',
    '.KRWKWKWKWKWRRK.',
    'KQRROOOOOOOORRQK',
    'KRROOoOOOOoOORRK',
    'KQRROOOOOOOORRQK',
    '.KRRKKKKKKKKRRK.',
    '.KKK........KKK.',
  ],
  // Quỷ Deadlock
  [
    '.K............K.',
    'KRK..........KRK',
    'KQRKKKKKKKKKKRQK',
    '.KVPPPPPPPPPPVK.',
    '.KPIIKPPPPKIIPK.',
    '.KPPPPPPPPPPPPK.',
    '.KPKWKWKWKWKPPK.',
    'AAKVPPPPPPPPVKAA',
    'aAKPPYYPPYYPPKAa',
    '..KVPPPPPPPPVK..',
    '..KPPK....KPPK..',
    '..KKKK....KKKK..',
  ],
]

/** A 3x5 pixel font for damage numbers: digits and 'k' for thousands. */
export const DIGITS: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  k: ['100', '101', '110', '101', '101'],
}

/** A pixel canvas: `null` is transparent, drawn in the terminal's own background. */
export type Canvas = { width: number; height: number; px: (number | null)[] }

export type PixelScene = { columns: number; rows: number; cells: string }

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
export function encodeCells(canvas: Canvas): string {
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
