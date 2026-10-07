import type { Picture } from './atlas'

// An RGBA picture the band's scene is painted into, and the few ways it is
// painted: pictures stamped by their solid pixels, flat fills, tints, and a
// small pixel font for numbers. Everything clips at the edges.

/** The band's picture, in pixels; a terminal cell shows about 5.6 × 11 of them. */
export const FRAME_WIDTH = 384
export const FRAME_HEIGHT = 88

export type Frame = { width: number; height: number; rgba: Uint8Array }

/** How a stamped picture's colors change: mixed toward a color, or turned gray and dimmed. */
export type Tint = { mix: number; amount: number } | { gray: number }

export function newFrame(width = FRAME_WIDTH, height = FRAME_HEIGHT): Frame {
  return { width, height, rgba: new Uint8Array(width * height * 4) }
}

function tinted(r: number, g: number, b: number, tint: Tint | undefined): [number, number, number] {
  if (tint === undefined) return [r, g, b]
  if ('gray' in tint) {
    const v = Math.round((r * 0.3 + g * 0.59 + b * 0.11) * tint.gray)
    return [v, v, v]
  }
  const k = tint.amount
  return [
    Math.round(r * (1 - k) + ((tint.mix >> 16) & 255) * k),
    Math.round(g * (1 - k) + ((tint.mix >> 8) & 255) * k),
    Math.round(b * (1 - k) + (tint.mix & 255) * k),
  ]
}

/** Paints one pixel, `alpha` of the way from what is there. */
export function put(f: Frame, x: number, y: number, color: number, alpha = 1): void {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return
  const at = (y * f.width + x) * 4
  const px = f.rgba
  px[at] = Math.round(px[at]! * (1 - alpha) + ((color >> 16) & 255) * alpha)
  px[at + 1] = Math.round(px[at + 1]! * (1 - alpha) + ((color >> 8) & 255) * alpha)
  px[at + 2] = Math.round(px[at + 2]! * (1 - alpha) + (color & 255) * alpha)
  px[at + 3] = 255
}

export function fill(f: Frame, left: number, top: number, width: number, height: number, color: number, alpha = 1): void {
  for (let y = Math.max(0, top); y < Math.min(f.height, top + height); y += 1) {
    for (let x = Math.max(0, left); x < Math.min(f.width, left + width); x += 1) put(f, x, y, color, alpha)
  }
}

/** Copies a picture of the frame's own size, shifted left by `scroll` and wrapping round. */
export function backdrop(f: Frame, picture: Picture, scroll: number): void {
  const shift = ((Math.round(scroll) % picture.width) + picture.width) % picture.width
  const rowBytes = f.width * 4
  for (let y = 0; y < Math.min(f.height, picture.height); y += 1) {
    const src = picture.rgba.subarray(y * picture.width * 4, (y + 1) * picture.width * 4)
    const head = (picture.width - shift) * 4
    f.rgba.set(src.subarray(shift * 4, shift * 4 + Math.min(head, rowBytes)), y * rowBytes)
    if (head < rowBytes) f.rgba.set(src.subarray(0, Math.min(shift * 4, rowBytes - head)), y * rowBytes + head)
  }
}

/** Stamps a picture's solid pixels with its top-left at (left, top), ringed by `outline` when given. */
export function blit(f: Frame, picture: Picture, left: number, top: number, options: { tint?: Tint; outline?: number; alpha?: number } = {}): void {
  const { width, height, rgba } = picture
  const alpha = options.alpha ?? 1
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && rgba[(y * width + x) * 4 + 3]! > 0
  if (options.outline !== undefined) {
    for (let y = -1; y <= height; y += 1) {
      for (let x = -1; x <= width; x += 1) {
        if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) {
          put(f, left + x, top + y, options.outline, alpha)
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    const fy = top + y
    if (fy < 0 || fy >= f.height) continue
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      if (rgba[at + 3] === 0) continue
      const fx = left + x
      if (fx < 0 || fx >= f.width) continue
      const [r, g, b] = tinted(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!, options.tint)
      put(f, fx, fy, (r << 16) | (g << 8) | b, alpha)
    }
  }
}

/** Washes the whole frame `amount` of the way toward a color. */
export function wash(f: Frame, color: number, amount: number): void {
  fill(f, 0, 0, f.width, f.height, color, amount)
}

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
  z: ['111', '001', '010', '100', '111'],
  Z: ['111', '001', '010', '100', '111'],
}

const SHADOW = 0x1a1c2c

/** Writes `text` in the pixel font centered on `centerX`, each font pixel `scale` square, with a drop shadow. */
export function text(f: Frame, value: string, centerX: number, top: number, color: number, scale = 1): void {
  const advance = 4 * scale
  let x = centerX - Math.floor((value.length * advance - scale) / 2)
  for (const ch of value) {
    const glyph = DIGITS[ch] ?? DIGITS['0']!
    glyph.forEach((row, gy) =>
      Array.from(row).forEach((bit, gx) => {
        if (bit !== '1') return
        fill(f, x + gx * scale + 1, top + gy * scale + 1, scale, scale, SHADOW)
      }),
    )
    glyph.forEach((row, gy) =>
      Array.from(row).forEach((bit, gx) => {
        if (bit === '1') fill(f, x + gx * scale, top + gy * scale, scale, scale, color)
      }),
    )
    x += advance
  }
}
