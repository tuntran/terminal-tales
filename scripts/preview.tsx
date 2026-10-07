// Draws the band and the /hero pane in a plain terminal, outside Claude Code,
// from the plugin's own game logic and drawing code. The layout is a simple
// stand-in for Claude Code's, close enough to judge the art. The scene is a
// kitty graphics image, so run it in a terminal that shows them (kitty,
// Ghostty, Orca).
//
//   bun scripts/preview.tsx            one frame of the band and the pane
//   bun scripts/preview.tsx --watch    the band animating, as above the prompt
//   bun scripts/preview.tsx --cols 90  the band at another width
//   bun scripts/preview.tsx --html out.html   the same frame as a page, colors kept

import type { GameState } from '../types'

import { applyAction, newGame, recruit, rewardTestPass, step } from '../src/game/engine'
import { type Anim, FRAME_MS, compose, newAnim, observe, stillAnim, tick } from '../src/ui/animation'
import { SCENE_COLUMNS, SCENE_ROWS, band } from '../src/ui/band'
import { fromBase64, toBase64 } from '../src/ui/base64'
import { heroPane } from '../src/ui/hero-pane'
import { kittyImage, loadArt, pngDataUrl } from './scene-output'

type Node = { type: string; props: Record<string, unknown>; children: unknown[] }

;(globalThis as Record<string, unknown>).h = (type: string, props: Record<string, unknown> | null, ...children: unknown[]): Node => ({
  type,
  props: props ?? {},
  children: children.flat(Infinity),
})

const kit = { Box: 'Box', Text: 'Text', Button: 'Button' } as never
const IMAGE = 'Image' as never
const atlases = await loadArt()
/** True when pictures go to a page rather than the terminal. */
let forHtml = false
/** Pictures for the page, each in place of a marker in the text. */
const pictures: string[] = []

const COLORS: Record<string, number> = {
  red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90,
}

function style(text: string, props: Record<string, unknown>): string {
  const codes: number[] = []
  if (typeof props.color === 'string' && COLORS[props.color]) codes.push(COLORS[props.color]!)
  if (props.bold) codes.push(1)
  if (props.dimColor) codes.push(2)
  return codes.length === 0 ? text : `\x1b[${codes.join(';')}m${text}\x1b[0m`
}

/** Color codes, kitty images and picture markers take no columns. */
function width(line: string): number {
  return Array.from(line.replace(/\x1b\[[\d;]*m|\x1b_G[^\x1b]*\x1b\\|\u0000\d+\u0000/g, '')).length
}

function padRight(line: string, to: number): string {
  return line + ' '.repeat(Math.max(0, to - width(line)))
}

function inline(child: unknown): string {
  if (child === null || child === undefined || child === false || child === true) return ''
  if (typeof child === 'string' || typeof child === 'number') return String(child)
  const node = child as Node
  if (node.type === 'Button') return style(`[ ${String(node.props.label)} ]`, { ...node.props, color: node.props.variant === 'primary' ? 'cyan' : undefined })
  return style(node.children.map(inline).join(''), node.props)
}

function lines(child: unknown): string[] {
  if (child === null || child === undefined || child === false || child === true) return []
  if (typeof child === 'string' || typeof child === 'number') return [String(child)]
  const node = child as Node
  if (node.type === 'Image') {
    // The picture sits at the top-left of its box of cells; blank cells hold its place.
    const { columns, rows, source } = node.props as { columns: number; rows: number; source: { rgba: string; width: number; height: number } }
    const frame = { width: source.width, height: source.height, rgba: fromBase64(source.rgba) }
    const blank = ' '.repeat(columns)
    let anchor: string
    if (forHtml) {
      pictures.push(pngDataUrl(frame))
      anchor = `\u0000${pictures.length - 1}\u0000`
    } else {
      anchor = kittyImage(frame, columns, rows, 7)
    }
    return Array.from({ length: rows }, (_, i) => (i === 0 ? anchor + blank : blank))
  }
  if (node.type !== 'Box') return [inline(node)]
  const parts = node.children.map(lines).filter(part => part.length > 0)
  let out: string[]
  if (node.props.flexDirection === 'column') {
    out = parts.flat()
  } else {
    const height = Math.max(0, ...parts.map(part => part.length))
    out = Array.from({ length: height }, (_, row) =>
      parts.map((part, i) => {
        const cell = part[row] ?? ''
        return i === parts.length - 1 ? cell : padRight(cell, Math.max(...part.map(width)))
      }).join(''),
    )
  }
  const left = ' '.repeat(Number(node.props.marginLeft ?? 0))
  const top = Array<string>(Number(node.props.marginTop ?? 0)).fill('')
  return [...top, ...out.map(line => left + line)]
}

function frame(title: string, body: string[], cols: number): string {
  const inner = Math.max(cols, ...body.map(width))
  return [
    `┌─ ${title} ${'─'.repeat(Math.max(0, inner - width(title) - 2))}┐`,
    ...body.map(line => `│${padRight(line, inner + 1)}│`),
    `└${'─'.repeat(inner + 1)}┘`,
  ].join('\n')
}

/** A game a few hours in: three heroes, a bag of loot, a buff on each side. */
function demoGame(): GameState {
  let g = newGame(20261007)
  for (let i = 0; i < 400; i += 1) g = step(g)
  g = { ...g, gold: g.gold + 2000 }
  g = recruit(g, 'mage').state
  g = recruit(g, 'ranger').state
  for (let i = 0; i < 6; i += 1) g = rewardTestPass(g)
  for (let i = 0; i < 30; i += 1) g = step(g)
  g = applyAction(applyAction(applyAction(g, 'prompt'), 'commit'), 'turnAborted')
  for (let i = 0; i < 3; i += 1) g = step(g)
  return g
}

function drawBand(g: GameState, cols: number, a: Anim = stillAnim(g), rows = 20, hasPictures = true): string {
  const scene = toBase64(compose(g, a, atlases).rgba)
  const title = hasPictures ? 'phía trên prompt' : 'phía trên prompt, không có ảnh'
  return frame(title, lines(band({ kit, image: hasPictures ? IMAGE : undefined, scene, error: null, game: g, columns: cols, rows })), cols)
}

const CSS: Record<number, string> = {
  1: 'font-weight:bold', 2: 'opacity:.55', 31: 'color:#ff6b6b', 32: 'color:#51cf66', 33: 'color:#ffd43b',
  34: 'color:#4dabf7', 35: 'color:#da77f2', 36: 'color:#3bc9db', 37: 'color:#f1f3f5', 90: 'color:#868e96',
}

/** Turns the ANSI colors this script prints into HTML spans. */
function toHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = escaped.replace(/\u0000(\d+)\u0000/g, (_, i: string) =>
    `<span style="position:relative"><img src="${pictures[Number(i)]}" style="position:absolute;left:0;top:0;width:${SCENE_COLUMNS}ch;height:${SCENE_ROWS * 1.35}em;image-rendering:pixelated"></span>`,
  ).replace(/\x1b\[([\d;]*)m/g, (_, codes: string) => {
    if (codes === '0' || codes === '') return '</span>'
    const parts = codes.split(';').map(Number)
    const styles: string[] = []
    for (let i = 0; i < parts.length; i += 1) {
      if ((parts[i] === 38 || parts[i] === 48) && parts[i + 1] === 2) {
        styles.push(`${parts[i] === 38 ? 'color' : 'background'}:rgb(${parts[i + 2]},${parts[i + 3]},${parts[i + 4]})`)
        i += 4
      } else styles.push(CSS[parts[i]!] ?? '')
    }
    return `<span style="${styles.join(';')}">`
  })
  return `<!doctype html><meta charset="utf-8"><title>Terminal Tales preview</title>
<body style="background:#1e1e2e;color:#cdd6f4;margin:24px"><pre style="font:14px/1.35 Menlo,Monaco,monospace">${body}</pre>`
}

const args = process.argv.slice(2)
const colsAt = args.indexOf('--cols')
const cols = colsAt >= 0 ? Number(args[colsAt + 1]) : Math.min(110, (process.stdout.columns ?? 100) - 4)
let game = demoGame()

if (args.includes('--watch')) {
  let a = newAnim()
  let frames = 0
  process.stdout.write('\x1b[2J')
  setInterval(() => {
    // The game steps every 1.5 s, the animation every frame, as in the plugin.
    if (++frames % 15 === 0) game = step(game)
    a = tick(observe(a, game))
    process.stdout.write(`\x1b[H${drawBand(game, cols, a)}\n\nctrl+c để thoát`)
  }, FRAME_MS)
} else {
  const noop = () => {}
  const actions = { select: noop, equip: noop, unequip: noop, upgrade: noop, sell: noop, recruit: noop }
  const htmlAt = args.indexOf('--html')
  forHtml = htmlAt >= 0
  const output = [
    drawBand(game, cols),
    drawBand(game, 90),
    drawBand(game, 60),
    drawBand(game, cols, stillAnim(game), 20, false),
    frame('/hero', lines(heroPane({ kit, game, selected: 0, rows: 30, actions })), 80),
  ].join('\n\n')
  if (forHtml) await Bun.write(args[htmlAt + 1] ?? 'preview.html', toHtml(output))
  else console.log(output)
}
