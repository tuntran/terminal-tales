// Plays the band's animation outside Claude Code, from the plugin's own game
// logic, packed art and animation code.
//
//   bun scripts/pixel-preview.ts                  plays it in this terminal (kitty graphics: kitty, Ghostty, Orca)
//   bun scripts/pixel-preview.ts --html out.html  writes a page that plays it

import type { GameState } from '../types'

import { applyAction, newGame, recruit, rewardToolCall, step } from '../src/game/engine'
import { type Anim, FRAME_MS, compose, newAnim, observe, tick } from '../src/ui/animation'
import type { Atlases } from '../src/ui/atlas'
import { SCENE_COLUMNS, SCENE_ROWS } from '../src/ui/band'
import type { Frame } from '../src/ui/frame-buffer'
import { kittyImage, loadArt, pngDataUrl } from './scene-output'

const STEP_FRAMES = 15

function party(): GameState {
  let g = { ...newGame(7), gold: 10_000 }
  g = recruit(g, 'mage').state
  g = recruit(g, 'ranger').state
  // A stage in, so fights last a few volleys.
  return { ...g, stage: 4 }
}

/** Runs the game and the animation side by side, as the plugin's two clocks do. */
function* frames(atlases: Atlases, count: number): Generator<Frame> {
  let g = party()
  let a: Anim = newAnim()
  for (let f = 0; f < count; f += 1) {
    if (f > 0 && f % STEP_FRAMES === 0) g = step(g)
    // Now and then Claude calls a tool: an extra strike.
    if (f % 37 === 20) g = rewardToolCall(g)
    // And now and then the user does something that buffs a side.
    if (f % 150 === 60) g = applyAction(g, 'prompt')
    if (f % 150 === 120) g = applyAction(g, 'turnAborted')
    a = tick(observe(a, g))
    yield compose(g, a, atlases)
  }
}

const atlases = await loadArt()
const htmlAt = process.argv.indexOf('--html')
if (htmlAt >= 0) {
  const all = [...frames(atlases, 300)].map(pngDataUrl)
  const page = `<!doctype html><meta charset="utf-8"><title>Terminal Tales animation</title>
<style>body{background:#1e1e2e;color:#a6adc8;font:13px Menlo,monospace;margin:20px}
img{image-rendering:pixelated;border:1px solid #45475a;display:block;margin-bottom:8px}</style>
<img id="big" width="${384 * 3}"><div id="info"></div>
<script>
const frames = ${JSON.stringify(all)};
const img = document.getElementById('big');
let f = 0;
setInterval(() => {
  img.src = frames[f];
  document.getElementById('info').textContent = 'khung ' + (f + 1) + '/' + frames.length;
  f = (f + 1) % frames.length;
}, ${FRAME_MS});
</script>`
  await Bun.write(process.argv[htmlAt + 1] ?? 'pixel-preview.html', page)
} else {
  const gen = frames(atlases, Number.MAX_SAFE_INTEGER)
  process.stdout.write('\x1b[2J\x1b[H\x1b[?25l')
  process.on('SIGINT', () => {
    process.stdout.write('\x1b_Ga=d,d=I,i=1,q=2\x1b\\\x1b[?25h\n')
    process.exit(0)
  })
  setInterval(() => {
    const next = gen.next()
    if (next.done) process.exit(0)
    process.stdout.write(`\x1b[H${kittyImage(next.value, SCENE_COLUMNS, SCENE_ROWS)}${'\n'.repeat(SCENE_ROWS + 1)}ctrl+c để thoát`)
  }, FRAME_MS)
}
