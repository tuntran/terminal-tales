// Base64 for the band's pictures. The hook environment has the native
// `Uint8Array.fromBase64` and `toBase64`; a preview script under an older
// runtime may not, so each falls back to a plain loop.

type Native = {
  fromBase64?: (text: string) => Uint8Array
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = new Map(Array.from(B64, (ch, i) => [ch.charCodeAt(0), i]))

export function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    parts.push(
      B64[(n >> 18) & 63]! +
        B64[(n >> 12) & 63]! +
        (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') +
        (i + 2 < bytes.length ? B64[n & 63]! : '='),
    )
  }
  return parts.join('')
}

export function fromBase64(text: string): Uint8Array {
  const native = (Uint8Array as unknown as Native).fromBase64
  if (typeof native === 'function') return native(text)
  const clean = text.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let at = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (LOOKUP.get(clean.charCodeAt(i))! << 18) |
      ((LOOKUP.get(clean.charCodeAt(i + 1)) ?? 0) << 12) |
      ((LOOKUP.get(clean.charCodeAt(i + 2)) ?? 0) << 6) |
      (LOOKUP.get(clean.charCodeAt(i + 3)) ?? 0)
    out[at++] = (n >> 16) & 255
    if (i + 2 < clean.length) out[at++] = (n >> 8) & 255
    if (i + 3 < clean.length) out[at++] = n & 255
  }
  return out
}
