// Plays the band's pixel animation outside Claude Code, from the plugin's own
// game logic, sprites and animation code.
//
//   bun scripts/pixel-preview.ts                 plays it in this terminal (truecolor)
//   bun scripts/pixel-preview.ts --html out.html writes a page that plays it

import type { GameState } from '../types'

import { newGame, recruit, rewardToolCall, step } from '../src/game/engine'
import { type Anim, FRAME_MS, compose, newAnim, observe, tick } from '../src/ui/animation'
import { decodeCells } from '../src/ui/pixel-art'

type Cell = ReturnType<typeof decodeCells>[number][number]

const STEP_FRAMES = 15

function party(): GameState {
  let g = { ...newGame(7), gold: 10_000 }
  g = recruit(g, 'mage').state
  g = recruit(g, 'ranger').state
  // A stage in, so fights last a few volleys.
  return { ...g, stage: 4 }
}

/** Runs the game and the animation side by side, as the plugin's two clocks do. */
function* frames(count: number): Generator<Cell[][]> {
  let g = party()
  let a: Anim = newAnim()
  for (let f = 0; f < count; f += 1) {
    if (f > 0 && f % STEP_FRAMES === 0) g = step(g)
    // Now and then Claude calls a tool: an extra strike.
    if (f % 37 === 20) g = rewardToolCall(g)
    a = tick(observe(a, g))
    yield decodeCells(compose(g, a))
  }
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`
const rgb = (c: number) => `${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}`

function ansi(rows: Cell[][]): string {
  return rows
    .map(row =>
      row
        .map(c => {
          const codes = [c.fg === null ? '' : `38;2;${rgb(c.fg)}`, c.bg === null ? '' : `48;2;${rgb(c.bg)}`].filter(Boolean)
          return codes.length === 0 ? c.ch : `\x1b[${codes.join(';')}m${c.ch}\x1b[0m`
        })
        .join(''),
    )
    .join('\n')
}

/** A frame as pixel colors, top row first: two pixels per cell. */
function pixels(rows: Cell[][]): (string | null)[][] {
  return rows.flatMap(row => [
    row.map(c => (c.ch === '▀' ? c.fg : c.ch === '▄' ? c.bg : null)),
    row.map(c => (c.ch === '▀' ? c.bg : c.ch === '▄' ? c.fg : null)),
  ]).map(line => line.map(c => (c === null ? null : hex(c))))
}

const htmlAt = process.argv.indexOf('--html')
if (htmlAt >= 0) {
  const all = [...frames(300)].map(pixels)
  const page = `<!doctype html><meta charset="utf-8"><title>Terminal Tales animation</title>
<style>body{background:#1e1e2e;color:#a6adc8;font:13px Menlo,monospace;margin:20px}
canvas{image-rendering:pixelated;border:1px solid #45475a;display:block;margin-bottom:8px}</style>
<canvas id="big"></canvas><div id="info"></div><p>Cỡ thật trong terminal (mỗi pixel ≈ nửa ô chữ):</p><canvas id="small"></canvas>
<script>
const frames = ${JSON.stringify(all)};
const h = frames[0].length, w = frames[0][0].length;
function setup(id, scale) { const c = document.getElementById(id); c.width = w; c.height = h; c.style.width = w * scale + 'px'; c.style.height = h * scale + 'px'; return c.getContext('2d') }
const big = setup('big', 8), small = setup('small', 3);
let f = 0;
setInterval(() => {
  for (const ctx of [big, small]) {
    ctx.clearRect(0, 0, w, h);
    frames[f].forEach((row, y) => row.forEach((c, x) => { if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1) } }));
  }
  document.getElementById('info').textContent = 'khung ' + (f + 1) + '/' + frames.length + ' · ' + w + ' cột × ' + h / 2 + ' dòng';
  f = (f + 1) % frames.length;
}, ${FRAME_MS});
</script>`
  await Bun.write(process.argv[htmlAt + 1] ?? 'pixel-preview.html', page)
} else {
  const gen = frames(Number.MAX_SAFE_INTEGER)
  setInterval(() => {
    const next = gen.next()
    if (next.done) process.exit(0)
    process.stdout.write(`\x1b[2J\x1b[H${ansi(next.value)}\n\nctrl+c để thoát\n`)
  }, FRAME_MS)
}
