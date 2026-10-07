import { ATLAS, type AtlasClip, type AtlasEntry, type AtlasId } from './atlas-manifest'
import { fromBase64 } from './base64'

// The sprite sheets and backgrounds the band draws from, decoded once a
// session from the files scripts/build-assets.ts packs (format in that
// script): a palette, then one palette index per pixel, 0 transparent.

/** One frame of a clip, RGBA; a transparent pixel is all zeros. */
export type Picture = { width: number; height: number; rgba: Uint8Array }

export type Clip = {
  frames: Picture[]
  width: number
  height: number
  /** The point drawn at the character's place: the middle of its feet, or a projectile's center. */
  anchorX: number
  anchorY: number
  frameMs: number
}

export type Atlas = Record<string, Clip>

export type Atlases = Record<AtlasId, Atlas>

const MAGIC = [0x54, 0x54, 0x41, 0x31] // 'TTA1'

/** Decodes one packed file into its clips; throws on a file that does not match its entry. */
export function decodeAtlas(bytes: Uint8Array, entry: AtlasEntry): Atlas {
  if (bytes.length < 6 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error(`${entry.file}: not a TTA1 file`)
  const colors = bytes[4]! | (bytes[5]! << 8)
  const palette = new Uint8Array((colors + 1) * 4)
  palette.set(bytes.subarray(6, 6 + colors * 4), 4)
  const start = 6 + colors * 4
  const atlas: Atlas = {}
  for (const [name, clip] of Object.entries(entry.clips) as [string, AtlasClip][]) {
    const size = clip.width * clip.height
    if (start + clip.offset + clip.frames * size > bytes.length) throw new Error(`${entry.file}: ${name} runs past the end`)
    const frames = Array.from({ length: clip.frames }, (_, f) => {
      const rgba = new Uint8Array(size * 4)
      const from = start + clip.offset + f * size
      for (let i = 0; i < size; i += 1) {
        const index = bytes[from + i]!
        if (index === 0) continue
        if (index > colors) throw new Error(`${entry.file}: ${name} uses color ${index} of ${colors}`)
        rgba.set(palette.subarray(index * 4, index * 4 + 4), i * 4)
      }
      return { width: clip.width, height: clip.height, rgba }
    })
    atlas[name] = { frames, width: clip.width, height: clip.height, anchorX: clip.anchorX, anchorY: clip.anchorY, frameMs: clip.frameMs }
  }
  return atlas
}

/** Reads and decodes every file the manifest names, from the plugin's `assets/build`. */
export async function loadAtlases(read: (path: string) => Promise<{ base64: string }>, root: string): Promise<Atlases> {
  const ids = Object.keys(ATLAS) as AtlasId[]
  const decoded = await Promise.all(
    ids.map(async id => {
      const entry: AtlasEntry = ATLAS[id]
      const { base64 } = await read(`${root}/assets/build/${entry.file}`)
      return [id, decodeAtlas(fromBase64(base64), entry)] as const
    }),
  )
  return Object.fromEntries(decoded) as Atlases
}
