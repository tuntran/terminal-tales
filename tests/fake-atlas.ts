import { decodeAtlas, type Atlases } from '../src/ui/atlas'
import { ATLAS, type AtlasClip, type AtlasEntry, type AtlasId } from '../src/ui/atlas-manifest'

// Packed atlas files shaped exactly as the manifest says, for tests that
// cannot read the plugin's real ones: every clip a solid block whose color
// changes with the file, the clip and the frame, so a frame shows which one it is.

const PALETTE_SIZE = 16

/** One TTA1 file laid out as `entry` names its clips; `still` gives every frame of a clip one color. */
export function fakeAtlasBytes(entry: AtlasEntry, still = false): Uint8Array {
  const clips = Object.values(entry.clips) as AtlasClip[]
  const pixels = clips.reduce((sum, c) => Math.max(sum, c.offset + c.frames * c.width * c.height), 0)
  const out = new Uint8Array(6 + PALETTE_SIZE * 4 + pixels)
  out.set([0x54, 0x54, 0x41, 0x31], 0)
  out[4] = PALETTE_SIZE
  for (let i = 0; i < PALETTE_SIZE; i += 1) out.set([40 + i * 12, 200 - i * 9, 90 + ((i * 37) % 160), 255], 6 + i * 4)
  const start = 6 + PALETTE_SIZE * 4
  // Each file starts at its own color, so two backgrounds never look alike.
  const shift = Array.from(entry.file).reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  clips.forEach((clip, k) => {
    for (let f = 0; f < clip.frames; f += 1) {
      const size = clip.width * clip.height
      out.fill(1 + ((shift + k * 5 + (still ? 0 : f)) % PALETTE_SIZE), start + clip.offset + f * size, start + clip.offset + (f + 1) * size)
    }
  })
  return out
}

export function fakeAtlases(): Atlases {
  return Object.fromEntries((Object.keys(ATLAS) as AtlasId[]).map(id => [id, decodeAtlas(fakeAtlasBytes(ATLAS[id]), ATLAS[id])])) as Atlases
}
