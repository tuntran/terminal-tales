// What the preview scripts share: the plugin's packed art read straight from
// disk, and a scene frame shown as a kitty graphics image or a PNG.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { PNG } from 'pngjs'

import { type Atlases, loadAtlases } from '../src/ui/atlas'
import type { Frame } from '../src/ui/frame-buffer'

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..')

export function loadArt(): Promise<Atlases> {
  return loadAtlases(async path => ({ base64: readFileSync(path).toString('base64') }), ROOT)
}

/** Kitty's limit on one escape's payload. */
const CHUNK = 4096

/**
 * The escapes that draw `frame` over `columns` × `rows` cells at the cursor,
 * leaving the cursor where it was. Drawn again under the same `id`, the
 * terminal replaces the picture in place.
 */
export function kittyImage(frame: Frame, columns: number, rows: number, id = 1): string {
  const data = Buffer.from(frame.rgba).toString('base64')
  const parts: string[] = []
  for (let at = 0; at < data.length; at += CHUNK) {
    const more = at + CHUNK < data.length ? 1 : 0
    const head = at === 0 ? `a=T,f=32,s=${frame.width},v=${frame.height},i=${id},c=${columns},r=${rows},C=1,q=2,m=${more}` : `m=${more}`
    parts.push(`\x1b_G${head};${data.slice(at, at + CHUNK)}\x1b\\`)
  }
  return parts.join('')
}

export function pngDataUrl(frame: Frame): string {
  const png = new PNG({ width: frame.width, height: frame.height })
  png.data = Buffer.from(frame.rgba)
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}
