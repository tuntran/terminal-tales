// Turns the sprite sheets and backgrounds under assets/source/ into the files
// the band draws from: one assets/build/<id>.bin per character, projectile and
// background, and src/ui/atlas-manifest.ts saying where each clip lies in it.
//
// The hook module has no PNG decoder, so decoding happens here. Each .bin is
// little-endian:
//   'TTA1' | u16 paletteSize | paletteSize × RGBA | u8 palette index per pixel
// Index 0 is transparent. The pixels of every frame of every clip follow one
// another in manifest order, `width * height` bytes a frame.
//
//   bun scripts/build-assets.ts            writes assets/build and the manifest
//   bun scripts/build-assets.ts --out DIR  writes DIR/build and DIR/atlas-manifest.ts

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PNG } from 'pngjs'

const SOURCE = 'assets/source'
/** The band's picture: every background is cut to this. */
const SCENE_WIDTH = 384
const SCENE_HEIGHT = 88
/** `$.fs.read` refuses a file over 4 MiB. */
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_COLORS = 255
const DEFAULT_FRAME_MS = 100

type ClipSpec = { name: string; file: string; frames: number; frameMs?: number }

type SpriteSpec = {
  id: string
  dir: string
  /** 1, or 0.5 for a pack drawn at twice the others' scale; nearest neighbor only. */
  scale: 1 | 0.5
  /** Monsters face left, toward the party. */
  flip: boolean
  /** Where the anchor sits: `feet` for a character, `center` for a projectile. */
  anchor: 'feet' | 'center'
  clips: ClipSpec[]
}

type BackgroundSpec = {
  id: string
  dir: string
  /** Layers from back to front. */
  layers: string[]
  /** The first source row of the 88-pixel strip. */
  cropTop: number
  /** The strip's row the characters stand on. */
  groundY: number
}

const HERO_CLIPS = (idle: number, run: number, attack: [string, number], hit: [string, number], death: number) => [
  { name: 'idle', file: 'Idle', frames: idle },
  { name: 'run', file: 'Run', frames: run },
  { name: 'attack', file: attack[0], frames: attack[1] },
  { name: 'hit', file: hit[0], frames: hit[1] },
  { name: 'death', file: 'Death', frames: death },
]

const SPRITES: SpriteSpec[] = [
  {
    id: 'hero-knight',
    dir: 'heroes/hero-knight',
    scale: 1,
    flip: false,
    anchor: 'feet',
    clips: HERO_CLIPS(11, 8, ['Attack1', 7], ['Take Hit', 4], 11),
  },
  {
    id: 'wizard',
    dir: 'heroes/wizard-pack',
    scale: 0.5,
    flip: false,
    anchor: 'feet',
    clips: HERO_CLIPS(6, 8, ['Attack1', 8], ['Hit', 4], 7),
  },
  {
    id: 'huntress',
    dir: 'heroes/huntress-2',
    scale: 1,
    flip: false,
    anchor: 'feet',
    clips: HERO_CLIPS(10, 8, ['Attack', 6], ['Get Hit', 3], 10),
  },
  {
    id: 'arrow',
    dir: 'heroes/huntress-2/arrow',
    scale: 1,
    flip: false,
    anchor: 'center',
    clips: [{ name: 'move', file: 'Move', frames: 2 }],
  },
  {
    id: 'orb',
    dir: 'bosses/evil-wizard-3/projectile',
    scale: 1,
    flip: false,
    anchor: 'center',
    clips: [{ name: 'move', file: 'Moving', frames: 4 }],
  },
  {
    id: 'skeleton',
    dir: 'monsters/skeleton',
    scale: 1,
    flip: true,
    anchor: 'feet',
    clips: HERO_CLIPS(4, 4, ['Attack', 8], ['Take Hit', 4], 4).map(c => (c.name === 'run' ? { ...c, file: 'Walk' } : c)),
  },
  {
    id: 'goblin',
    dir: 'monsters/goblin',
    scale: 1,
    flip: true,
    anchor: 'feet',
    clips: HERO_CLIPS(4, 8, ['Attack', 8], ['Take Hit', 4], 4),
  },
  {
    id: 'mushroom',
    dir: 'monsters/mushroom',
    scale: 1,
    flip: true,
    anchor: 'feet',
    clips: HERO_CLIPS(4, 8, ['Attack', 8], ['Take Hit', 4], 4),
  },
  {
    id: 'flying-eye',
    dir: 'monsters/flying-eye',
    scale: 1,
    flip: true,
    anchor: 'feet',
    // It never lands: flight is both its idle and its way in.
    clips: [
      { name: 'idle', file: 'Flight', frames: 8 },
      { name: 'run', file: 'Flight', frames: 8 },
      { name: 'attack', file: 'Attack', frames: 8 },
      { name: 'hit', file: 'Take Hit', frames: 4 },
      { name: 'death', file: 'Death', frames: 4 },
    ],
  },
  {
    id: 'evil-wizard',
    dir: 'bosses/evil-wizard',
    scale: 1,
    flip: true,
    anchor: 'feet',
    clips: HERO_CLIPS(8, 8, ['Attack', 8], ['Take Hit', 4], 5).map(c => (c.name === 'run' ? { ...c, file: 'Move' } : c)),
  },
  {
    id: 'evil-wizard-2',
    dir: 'bosses/evil-wizard-2',
    scale: 0.5,
    flip: true,
    anchor: 'feet',
    clips: HERO_CLIPS(8, 8, ['Attack1', 8], ['Take hit', 3], 7),
  },
  {
    id: 'evil-wizard-3',
    dir: 'bosses/evil-wizard-3',
    scale: 1,
    flip: true,
    anchor: 'feet',
    clips: HERO_CLIPS(10, 8, ['Attack', 13], ['Get hit', 3], 18),
  },
]

/** Admurin's layers are numbered front to back, so the highest goes down first. */
const numbered = (count: number) => Array.from({ length: count }, (_, i) => String(count - 1 - i))

const BACKGROUNDS: BackgroundSpec[] = [
  { id: 'bg-plains', dir: 'backgrounds/plains', layers: numbered(9), cropTop: 128, groundY: 80 },
  {
    id: 'bg-forest',
    dir: 'backgrounds/forest',
    layers: ['parallax-forest-back-trees', 'parallax-forest-lights', 'parallax-forest-middle-trees', 'parallax-forest-front-trees'],
    cropTop: 72,
    groundY: 80,
  },
  { id: 'bg-dead-forest', dir: 'backgrounds/dead-forest', layers: numbered(7), cropTop: 124, groundY: 80 },
  { id: 'bg-snowy-mountains', dir: 'backgrounds/snowy-mountains', layers: numbered(6), cropTop: 124, groundY: 82 },
  { id: 'bg-cave', dir: 'backgrounds/cave', layers: numbered(8), cropTop: 118, groundY: 80 },
]

// ---------- images ----------

type Image = { width: number; height: number; data: Uint8Array }

function newImage(width: number, height: number): Image {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

function readPng(path: string): Image {
  const png = PNG.sync.read(readFileSync(path))
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) }
}

function isSolid(img: Image, x: number, y: number): boolean {
  return img.data[(y * img.width + x) * 4 + 3]! >= 128
}

function crop(img: Image, left: number, top: number, width: number, height: number): Image {
  const out = newImage(width, height)
  for (let y = 0; y < height; y += 1) {
    const from = ((top + y) * img.width + left) * 4
    out.data.set(img.data.subarray(from, from + width * 4), y * width * 4)
  }
  return out
}

/** Nearest neighbor at half size: the top-left pixel of every 2×2 block. */
function halve(img: Image): Image {
  const out = newImage(Math.floor(img.width / 2), Math.floor(img.height / 2))
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const from = (y * 2 * img.width + x * 2) * 4
      out.data.set(img.data.subarray(from, from + 4), (y * out.width + x) * 4)
    }
  }
  return out
}

function mirror(img: Image): Image {
  const out = newImage(img.width, img.height)
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const from = (y * img.width + x) * 4
      out.data.set(img.data.subarray(from, from + 4), (y * img.width + img.width - 1 - x) * 4)
    }
  }
  return out
}

type Box = { left: number; top: number; right: number; bottom: number }

/** The smallest box holding every solid pixel of every frame, or null when all are empty. */
function bounds(frames: Image[]): Box | null {
  let box: Box | null = null
  for (const f of frames) {
    for (let y = 0; y < f.height; y += 1) {
      for (let x = 0; x < f.width; x += 1) {
        if (!isSolid(f, x, y)) continue
        box =
          box === null
            ? { left: x, top: y, right: x, bottom: y }
            : { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x), bottom: Math.max(box.bottom, y) }
      }
    }
  }
  return box
}

// ---------- sprites ----------

type BuiltClip = { name: string; frames: Image[]; anchorX: number; anchorY: number; frameMs: number }

/** Splits a sheet into its frames, scaled and turned as the sprite is drawn. */
function sheetFrames(spec: SpriteSpec, clip: ClipSpec): Image[] {
  const path = join(SOURCE, spec.dir, `${clip.file}.png`)
  const sheet = readPng(path)
  if (sheet.width % clip.frames !== 0) {
    throw new Error(`${path}: ${sheet.width} px wide does not split into ${clip.frames} frames`)
  }
  const width = sheet.width / clip.frames
  return Array.from({ length: clip.frames }, (_, i) => {
    let frame = crop(sheet, i * width, 0, width, sheet.height)
    if (spec.scale === 0.5) frame = halve(frame)
    if (spec.flip) frame = mirror(frame)
    return frame
  })
}

/**
 * The point every clip of a character is drawn from, in the uncut frame: the
 * middle of its feet in the first clip. Every frame of a pack shares one
 * frame box, so the same point keeps every clip on the same ground.
 */
function anchorOf(spec: SpriteSpec, first: Image[]): { x: number; y: number } {
  const box = bounds(first)
  if (box === null) throw new Error(`${spec.id}: its first clip is empty`)
  if (spec.anchor === 'center') {
    return { x: Math.floor((box.left + box.right) / 2), y: Math.floor((box.top + box.bottom) / 2) }
  }
  const frame = first[0]!
  let left = frame.width
  let right = -1
  let bottom = box.bottom
  // The bottom row of the first frame with solid pixels: where it stands.
  for (; bottom >= 0 && right < 0; bottom -= 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (!isSolid(frame, x, bottom)) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
  }
  return { x: Math.floor((left + right) / 2), y: bottom + 1 }
}

function buildSprite(spec: SpriteSpec): BuiltClip[] {
  const sheets = spec.clips.map(clip => sheetFrames(spec, clip))
  const anchor = anchorOf(spec, sheets[0]!)
  return spec.clips.map((clip, i) => {
    const frames = sheets[i]!
    const box = bounds(frames)
    if (box === null) throw new Error(`${spec.id} ${clip.name}: every frame is empty`)
    const width = box.right - box.left + 1
    const height = box.bottom - box.top + 1
    return {
      name: clip.name,
      frames: frames.map(f => crop(f, box.left, box.top, width, height)),
      anchorX: anchor.x - box.left,
      anchorY: anchor.y - box.top,
      frameMs: clip.frameMs ?? DEFAULT_FRAME_MS,
    }
  })
}

// ---------- backgrounds ----------

function buildBackground(spec: BackgroundSpec): BuiltClip {
  const layers = spec.layers.map(name => readPng(join(SOURCE, spec.dir, `${name}.png`)))
  const height = layers[0]!.height
  const scene = newImage(SCENE_WIDTH, SCENE_HEIGHT)
  if (spec.cropTop + SCENE_HEIGHT > height) throw new Error(`${spec.id}: the strip runs past the image`)
  for (const layer of layers) {
    // A layer narrower than the scene repeats: these are made to tile.
    for (let y = 0; y < SCENE_HEIGHT; y += 1) {
      for (let x = 0; x < SCENE_WIDTH; x += 1) {
        const sx = x % layer.width
        if (!isSolid(layer, sx, spec.cropTop + y)) continue
        const from = ((spec.cropTop + y) * layer.width + sx) * 4
        scene.data.set(layer.data.subarray(from, from + 3), (y * SCENE_WIDTH + x) * 4)
        scene.data[(y * SCENE_WIDTH + x) * 4 + 3] = 255
      }
    }
  }
  return { name: 'scene', frames: [scene], anchorX: 0, anchorY: spec.groundY, frameMs: DEFAULT_FRAME_MS }
}

// ---------- palette ----------

type Rgb = number

const rgbAt = (data: Uint8Array, i: number): Rgb => (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!

/** Median cut: splits the box with the widest channel at its median until there are `count` boxes. */
function medianCut(colors: Rgb[], count: number): Map<Rgb, Rgb> {
  const channel = (c: Rgb, k: number) => (c >> (16 - k * 8)) & 255
  const spread = (box: Rgb[], k: number) => Math.max(...box.map(c => channel(c, k))) - Math.min(...box.map(c => channel(c, k)))
  let boxes: Rgb[][] = [colors]
  while (boxes.length < count) {
    let best = -1
    let bestK = 0
    let bestSpread = 0
    boxes.forEach((box, i) => {
      if (box.length < 2) return
      for (let k = 0; k < 3; k += 1) {
        const s = spread(box, k)
        if (s > bestSpread) [best, bestK, bestSpread] = [i, k, s]
      }
    })
    if (best < 0) break
    const box = [...boxes[best]!].sort((a, b) => channel(a, bestK) - channel(b, bestK) || a - b)
    const half = box.length >> 1
    boxes = [...boxes.slice(0, best), box.slice(0, half), box.slice(half), ...boxes.slice(best + 1)]
  }
  const map = new Map<Rgb, Rgb>()
  for (const box of boxes) {
    const mean = [0, 1, 2].map(k => Math.round(box.reduce((sum, c) => sum + channel(c, k), 0) / box.length))
    const color = (mean[0]! << 16) | (mean[1]! << 8) | mean[2]!
    for (const c of box) map.set(c, color)
  }
  return map
}

/** Packs one file: its palette from the colors of all its frames, then every frame's indexes. */
function encode(id: string, clips: BuiltClip[], allowReduce: boolean): Uint8Array {
  const seen = new Set<Rgb>()
  for (const clip of clips) {
    for (const f of clip.frames) {
      for (let i = 0; i < f.data.length; i += 4) if (f.data[i + 3]! >= 128) seen.add(rgbAt(f.data, i))
    }
  }
  let colors = [...seen].sort((a, b) => a - b)
  let reduce: Map<Rgb, Rgb> | null = null
  if (colors.length > MAX_COLORS) {
    if (!allowReduce) throw new Error(`${id}: ${colors.length} colors, more than the ${MAX_COLORS} a file holds`)
    reduce = medianCut(colors, MAX_COLORS)
    colors = [...new Set(reduce.values())].sort((a, b) => a - b)
  }
  const index = new Map(colors.map((c, i) => [c, i + 1]))
  const pixels = clips.reduce((sum, c) => sum + c.frames.reduce((s, f) => s + f.width * f.height, 0), 0)
  const out = new Uint8Array(4 + 2 + colors.length * 4 + pixels)
  out.set([0x54, 0x54, 0x41, 0x31], 0) // 'TTA1'
  new DataView(out.buffer).setUint16(4, colors.length, true)
  colors.forEach((c, i) => out.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], 6 + i * 4))
  let at = 6 + colors.length * 4
  for (const clip of clips) {
    for (const f of clip.frames) {
      for (let i = 0; i < f.data.length; i += 4, at += 1) {
        if (f.data[i + 3]! < 128) continue
        const rgb = rgbAt(f.data, i)
        out[at] = index.get(reduce === null ? rgb : reduce.get(rgb)!)!
      }
    }
  }
  return out
}

// ---------- output ----------

type Entry = { id: string; bytes: Uint8Array; clips: BuiltClip[]; groundY?: number }

function manifest(entries: Entry[]): string {
  const lines = [
    '// generated by scripts/build-assets.ts, do not edit',
    '// Where each clip lies in its assets/build/<file>: offsets count from the first pixel byte.',
    '',
    'export type AtlasClip = {',
    '  readonly frames: number',
    '  readonly width: number',
    '  readonly height: number',
    '  readonly offset: number',
    '  readonly anchorX: number',
    '  readonly anchorY: number',
    '  readonly frameMs: number',
    '}',
    '',
    'export type AtlasEntry = { readonly file: string; readonly clips: Readonly<Record<string, AtlasClip>>; readonly groundY?: number }',
    '',
    'export const ATLAS = {',
  ]
  for (const entry of entries) {
    lines.push(`  '${entry.id}': {`, `    file: '${entry.id}.bin',`)
    if (entry.groundY !== undefined) lines.push(`    groundY: ${entry.groundY},`)
    lines.push('    clips: {')
    let offset = 0
    for (const clip of entry.clips) {
      const f = clip.frames[0]!
      lines.push(
        `      ${/^[a-z]+$/.test(clip.name) ? clip.name : `'${clip.name}'`}: { frames: ${clip.frames.length}, width: ${f.width}, height: ${f.height}, offset: ${offset}, anchorX: ${clip.anchorX}, anchorY: ${clip.anchorY}, frameMs: ${clip.frameMs} },`,
      )
      offset += clip.frames.length * f.width * f.height
    }
    lines.push('    },', '  },')
  }
  lines.push('} as const satisfies Record<string, AtlasEntry>', '', 'export type AtlasId = keyof typeof ATLAS', '')
  return lines.join('\n')
}

function main(): void {
  const at = process.argv.indexOf('--out')
  const outDir = at >= 0 ? process.argv[at + 1] : undefined
  const buildDir = outDir === undefined ? 'assets/build' : join(outDir, 'build')
  const manifestPath = outDir === undefined ? 'src/ui/atlas-manifest.ts' : join(outDir, 'atlas-manifest.ts')

  const entries: Entry[] = [
    ...SPRITES.map(spec => {
      const clips = buildSprite(spec)
      return { id: spec.id, clips, bytes: encode(spec.id, clips, false) }
    }),
    ...BACKGROUNDS.map(spec => {
      const clip = buildBackground(spec)
      return { id: spec.id, clips: [clip], groundY: spec.groundY, bytes: encode(spec.id, [clip], true) }
    }),
  ].sort((a, b) => (a.id < b.id ? -1 : 1))

  rmSync(buildDir, { recursive: true, force: true })
  mkdirSync(buildDir, { recursive: true })
  let total = 0
  for (const entry of entries) {
    if (entry.bytes.length > MAX_FILE_BYTES) throw new Error(`${entry.id}.bin: ${entry.bytes.length} bytes, over 4 MiB`)
    writeFileSync(join(buildDir, `${entry.id}.bin`), entry.bytes)
    total += entry.bytes.length
  }
  writeFileSync(manifestPath, manifest(entries))
  const files = readdirSync(buildDir).length
  console.log(`${files} files in ${buildDir}, ${(total / 1024).toFixed(0)} KiB in all; manifest at ${manifestPath}`)
}

main()
