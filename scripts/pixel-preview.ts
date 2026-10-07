// Shows the pixel band for every monster, as the terminal draws it.
//
//   bun scripts/pixel-preview.ts                 prints the scenes in a truecolor terminal
//   bun scripts/pixel-preview.ts --html out.html writes the same as a page

import type { GameState, MonsterTier } from '../types'

import { BOSSES, MONSTERS } from '../src/game/catalog'
import { newGame, recruit } from '../src/game/engine'
import { decodeCells, pixelScene } from '../src/ui/pixel-art'

type Cell = ReturnType<typeof decodeCells>[number][number]

function party(): GameState {
  let g = { ...newGame(7), gold: 10_000 }
  g = recruit(g, 'mage').state
  g = recruit(g, 'ranger').state
  return g
}

function withMonster(g: GameState, sprite: number, tier: MonsterTier, name: string): GameState {
  return { ...g, monster: { ...g.monster, sprite, tier, name, hp: 60, maxHp: 100 } }
}

const base = party()
const scenes: [string, GameState][] = [
  ...MONSTERS.map((m, i): [string, GameState] => [m.name, withMonster(base, i, 'normal', m.name)]),
  ['Tinh Anh (viền xanh)', withMonster(base, 1, 'elite', MONSTERS[1]!.name)],
  ['Hiếm (viền hồng)', withMonster(base, 3, 'rare', MONSTERS[3]!.name)],
  ...BOSSES.map((m, i): [string, GameState] => [`Boss: ${m.name}`, withMonster(base, i, 'boss', m.name)]),
  ['Khung tấn công', { ...withMonster(base, 0, 'normal', MONSTERS[0]!.name), frame: 1 }],
  ['Pháp Sư gục', { ...withMonster(base, 2, 'normal', MONSTERS[2]!.name), heroes: base.heroes.map((h, i) => (i === 1 ? { ...h, hp: 0 } : h)) }],
]

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`
const rgb = (c: number) => `${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}`

function ansi(rows: Cell[][]): string {
  return rows
    .map(row =>
      row
        .map(cell => `${cell.fg === null ? '' : `\x1b[38;2;${rgb(cell.fg)}m`}${cell.bg === null ? '' : `\x1b[48;2;${rgb(cell.bg)}m`}${cell.ch}\x1b[0m`)
        .join(''),
    )
    .join('\n')
}

// Each cell as two stacked pixels, so the page shows what a terminal with
// square-ish cells shows, without font gaps between rows.
function html(rows: Cell[][]): string {
  const px = rows.flatMap(row => {
    const top = row.map(c => (c.ch === '▀' ? c.fg : c.ch === '▄' ? c.bg : null))
    const bottom = row.map(c => (c.ch === '▀' ? c.bg : c.ch === '▄' ? c.fg : null))
    return [top, bottom]
  })
  const cols = rows[0]?.length ?? 0
  return `<div class="g" style="grid-template-columns:repeat(${cols},6px)">${px
    .flat()
    .map(c => `<i${c === null ? '' : ` style="background:${hex(c)}"`}></i>`)
    .join('')}</div>`
}

const htmlAt = process.argv.indexOf('--html')
if (htmlAt >= 0) {
  const body = scenes
    .map(([label, g]) => {
      const scene = pixelScene(g)
      return `<figure>${html(decodeCells(scene))}<figcaption>${label} · ${scene.columns} cột × ${scene.rows} dòng</figcaption></figure>`
    })
    .join('')
  await Bun.write(
    process.argv[htmlAt + 1] ?? 'pixel-preview.html',
    `<!doctype html><meta charset="utf-8"><title>Terminal Tales pixel preview</title>
<style>body{background:#1e1e2e;color:#a6adc8;font:13px Menlo,monospace;margin:20px}
.g{display:grid}.g i{display:block;width:6px;height:6px}
figure{display:inline-block;margin:0 28px 22px 0}figcaption{margin-top:6px}</style>${body}`,
  )
} else {
  for (const [label, g] of scenes) console.log(`${label}\n${ansi(decodeCells(pixelScene(g)))}\n`)
}
