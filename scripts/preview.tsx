// Draws the band and the /hero pane in a plain terminal, outside Claude Code,
// from the plugin's own game logic and drawing code. The layout is a simple
// stand-in for Claude Code's, close enough to judge the art.
//
//   bun scripts/preview.tsx            one frame of the band and the pane
//   bun scripts/preview.tsx --watch    the band animating, as above the prompt
//   bun scripts/preview.tsx --cols 60  the band at another width
//   bun scripts/preview.tsx --html out.html   the same frame as a page, colors kept

import type { GameState } from '../types'

import { applyAction, newGame, recruit, rewardTestPass, step } from '../src/game/engine'
import { band } from '../src/ui/band'
import { heroPane } from '../src/ui/hero-pane'
import { decodeCells } from '../src/ui/pixel-art'
import { pixelScene } from '../src/ui/animation'

type Node = { type: string; props: Record<string, unknown>; children: unknown[] }

;(globalThis as Record<string, unknown>).h = (type: string, props: Record<string, unknown> | null, ...children: unknown[]): Node => ({
  type,
  props: props ?? {},
  children: children.flat(Infinity),
})

const kit = { Box: 'Box', Text: 'Text', Button: 'Button' } as never
const RASTER = 'Raster' as never
const rgb = (c: number) => `${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}`

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

function width(line: string): number {
  return Array.from(line.replace(/\x1b\[[\d;]*m/g, '')).length
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
  if (node.type === 'Raster') {
    const { columns, rows, cells } = node.props as { columns: number; rows: number; cells: string }
    return decodeCells({ columns, rows, cells }).map(row =>
      row
        .map(c => {
          const codes = [c.fg === null ? '' : `38;2;${rgb(c.fg)}`, c.bg === null ? '' : `48;2;${rgb(c.bg)}`].filter(Boolean)
          return codes.length === 0 ? c.ch : `\x1b[${codes.join(';')}m${c.ch}\x1b[0m`
        })
        .join(''),
    )
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

function drawBand(g: GameState, cols: number, rows = 20, pixel = true): string {
  return frame('phía trên prompt', lines(band({ kit, raster: pixel ? RASTER : undefined, scene: pixelScene(g), game: g, columns: cols, rows })), cols)
}

const CSS: Record<number, string> = {
  1: 'font-weight:bold', 2: 'opacity:.55', 31: 'color:#ff6b6b', 32: 'color:#51cf66', 33: 'color:#ffd43b',
  34: 'color:#4dabf7', 35: 'color:#da77f2', 36: 'color:#3bc9db', 37: 'color:#f1f3f5', 90: 'color:#868e96',
}

/** Turns the ANSI colors this script prints into HTML spans. */
function toHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = escaped.replace(/\x1b\[([\d;]*)m/g, (_, codes: string) => {
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
  const draw = () => {
    process.stdout.write('\x1b[2J\x1b[H')
    console.log(drawBand(game, cols))
    console.log('\nctrl+c để thoát')
    game = step(game)
  }
  draw()
  setInterval(draw, 1500)
} else {
  const noop = () => {}
  const actions = { select: noop, equip: noop, unequip: noop, upgrade: noop, sell: noop, recruit: noop }
  const output = [
    drawBand(game, cols),
    drawBand(game, 60, 8, false),
    frame('/hero', lines(heroPane({ kit, game, selected: 0, rows: 30, actions })), 80),
  ].join('\n\n')
  const htmlAt = args.indexOf('--html')
  if (htmlAt >= 0) await Bun.write(args[htmlAt + 1] ?? 'preview.html', toHtml(output))
  else console.log(output)
}
