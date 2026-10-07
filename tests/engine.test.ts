import { describe, expect, test } from 'claude-code/testing'

import type { GameState, Item } from '../types'

import { KILLS_PER_STAGE, MAX_INVENTORY, RECRUIT_COST } from '../src/game/catalog'
import {
  equip,
  expToNext,
  heroStats,
  newGame,
  parseSave,
  recruit,
  rewardTestPass,
  rewardToolCall,
  rollRarity,
  sell,
  step,
  unequip,
  upgrade,
  upgradeCost,
} from '../src/game/engine'
import { isPassingRun, isTestCommand } from '../src/game/test-command'
import { bar } from '../src/ui/art'
import { BOSSES, MONSTERS } from '../src/game/catalog'
import { PALETTE, PIXEL_BOSSES, PIXEL_HEROES, PIXEL_HERO_ATTACKS, PIXEL_HERO_STRIDES, PIXEL_MONSTERS, decodeCells } from '../src/ui/pixel-art'
import { compose, newAnim, observe, pixelScene, tick } from '../src/ui/animation'

function withItem(g: GameState, item: Partial<Item> = {}): GameState {
  const full: Item = { id: 'x1', name: 'Kiếm Thử', slot: 'weapon', rarity: 'rare', stage: 1, level: 0, ...item }
  return { ...g, inventory: [...g.inventory, full] }
}

describe('new game', () => {
  test('starts with one warrior facing a monster', () => {
    const g = newGame(42)
    expect(g.heroes).toHaveLength(1)
    expect(g.heroes[0]!.cls).toBe('warrior')
    expect(g.heroes[0]!.hp).toBe(heroStats(g.heroes[0]!).maxHp)
    expect(g.monster.hp).toBeGreaterThan(0)
    expect(g.stage).toBe(1)
  })

  test('replays exactly under the same seed', () => {
    let a = newGame(7)
    let b = newGame(7)
    for (let i = 0; i < 200; i += 1) {
      a = step(a)
      b = step(b)
    }
    expect(a).toEqual(b)
  })
})

describe('combat', () => {
  test('a long idle run kills monsters, earns gold and levels up', () => {
    let g = newGame(1)
    for (let i = 0; i < 600; i += 1) g = step(g)
    expect(g.stats.kills).toBeGreaterThan(10)
    expect(g.gold).toBeGreaterThan(0)
    expect(g.heroes[0]!.level).toBeGreaterThan(1)
  })

  test('the boss comes after a full stage and its kill advances the stage', () => {
    let g = newGame(3)
    g = { ...g, stageKills: KILLS_PER_STAGE }
    g = { ...g, monster: { ...g.monster, hp: 1 } }
    g = step(g)
    // The weak monster died and the boss spawned in its place.
    expect(g.monster.tier).toBe('boss')
    g = { ...g, monster: { ...g.monster, hp: 1 } }
    g = step(g)
    expect(g.stage).toBe(2)
    expect(g.stageKills).toBe(0)
  })

  test('a wiped party rests, then stands up at full health', () => {
    let g = newGame(5)
    g = { ...g, heroes: g.heroes.map(h => ({ ...h, hp: 1 })), monster: { ...g.monster, hp: 1e9, maxHp: 1e9, atk: 1e6 } }
    g = step(g)
    expect(g.resting).toBeGreaterThan(0)
    while (g.resting > 0) g = step(g)
    expect(g.heroes[0]!.hp).toBe(heroStats(g.heroes[0]!).maxHp)
  })
})

describe('coding activity', () => {
  test('a tool call grants gold, EXP and a strike', () => {
    const g = newGame(9)
    const after = rewardToolCall(g)
    expect(after.gold).toBeGreaterThan(g.gold)
    expect(after.heroes[0]!.exp).toBeGreaterThan(g.heroes[0]!.exp)
    expect(after.stats.toolCalls).toBe(1)
  })

  test('a test pass grants a big purse and a guaranteed item', () => {
    const g = newGame(9)
    const after = rewardTestPass(g)
    expect(after.gold - g.gold).toBeGreaterThanOrEqual(30)
    expect(after.inventory).toHaveLength(1)
    expect(after.stats.testPasses).toBe(1)
  })

  test('EXP past the curve levels a hero up', () => {
    let g = newGame(9)
    const need = expToNext(1)
    for (let i = 0; i < need; i += 1) g = rewardToolCall(g)
    expect(g.heroes[0]!.level).toBeGreaterThan(1)
  })
})

describe('loot', () => {
  test('luck shifts rarity toward the rare end', () => {
    const rank = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }
    let g = newGame(11)
    let plain = 0
    let lucky = 0
    for (let i = 0; i < 2000; i += 1) plain += rank[rollRarity(g, 0)]
    for (let i = 0; i < 2000; i += 1) lucky += rank[rollRarity(g, 2)]
    expect(lucky).toBeGreaterThan(plain)
  })

  test('every rarity can drop', () => {
    const g = newGame(13)
    const seen = new Set<string>()
    for (let i = 0; i < 5000; i += 1) seen.add(rollRarity(g, 0))
    expect(seen.size).toBe(5)
  })

  test('a full bag sells its weakest piece', () => {
    let g = newGame(15)
    for (let i = 0; i < MAX_INVENTORY + 5; i += 1) g = rewardTestPass(g)
    expect(g.inventory).toHaveLength(MAX_INVENTORY)
  })
})

describe('/hero actions', () => {
  test('equip moves an item into its slot and raises the stat', () => {
    const g = withItem(newGame(17))
    const hero = g.heroes[0]!
    const { state, error } = equip(g, hero.id, 'x1')
    expect(error).toBeUndefined()
    expect(state.heroes[0]!.gear.weapon?.id).toBe('x1')
    expect(state.inventory).toHaveLength(0)
    expect(heroStats(state.heroes[0]!).atk).toBeGreaterThan(heroStats(hero).atk)
  })

  test('equip swaps the old item back into the bag', () => {
    let g = withItem(newGame(17))
    g = equip(g, g.heroes[0]!.id, 'x1').state
    g = withItem(g, { id: 'x2', name: 'Kiếm Mới' })
    g = equip(g, g.heroes[0]!.id, 'x2').state
    expect(g.heroes[0]!.gear.weapon?.id).toBe('x2')
    expect(g.inventory.map(it => it.id)).toEqual(['x1'])
  })

  test('swapping to weaker armor at low HP leaves the hero standing', () => {
    let g = withItem(newGame(27), { id: 'big', slot: 'armor', rarity: 'legendary', stage: 30 })
    g = equip(g, g.heroes[0]!.id, 'big').state
    g = { ...g, heroes: g.heroes.map(hero => ({ ...hero, hp: 20 })) }
    g = withItem(g, { id: 'small', slot: 'armor', rarity: 'common' })
    g = equip(g, g.heroes[0]!.id, 'small').state
    expect(g.heroes[0]!.hp).toBeGreaterThan(0)
    expect(() => step(g)).not.toThrow()
  })

  test('equipping a fallen hero does not revive it mid-rest', () => {
    let g = withItem(newGame(27), { slot: 'armor' })
    g = { ...g, resting: 3, heroes: g.heroes.map(hero => ({ ...hero, hp: 0 })) }
    g = equip(g, g.heroes[0]!.id, 'x1').state
    expect(g.heroes[0]!.hp).toBe(0)
  })

  test('a step with nobody standing starts the rest instead of failing', () => {
    let g = newGame(29)
    g = { ...g, heroes: g.heroes.map(hero => ({ ...hero, hp: 0 })), monster: { ...g.monster, hp: 1e9, maxHp: 1e9 } }
    g = step(g)
    expect(g.resting).toBeGreaterThan(0)
  })

  test('unequip returns the item to the bag', () => {
    let g = withItem(newGame(17))
    g = equip(g, g.heroes[0]!.id, 'x1').state
    g = unequip(g, g.heroes[0]!.id, 'weapon').state
    expect(g.heroes[0]!.gear.weapon).toBeNull()
    expect(g.inventory).toHaveLength(1)
  })

  test('sell turns an item into gold', () => {
    const g = withItem(newGame(19))
    const { state } = sell(g, 'x1')
    expect(state.inventory).toHaveLength(0)
    expect(state.gold).toBeGreaterThan(g.gold)
  })

  test('upgrade spends gold, and refuses when short', () => {
    let g = withItem(newGame(21))
    g = equip(g, g.heroes[0]!.id, 'x1').state
    const cost = upgradeCost(g.heroes[0]!.gear.weapon!)
    const short = upgrade(g, g.heroes[0]!.id, 'weapon')
    expect(short.error).toContain(String(cost))
    expect(short.state).toBe(g)
    g = { ...g, gold: cost }
    const { state } = upgrade(g, g.heroes[0]!.id, 'weapon')
    expect(state.gold).toBe(0)
    expect(state.heroes[0]!.gear.weapon!.level).toBe(1)
  })

  test('recruit grows the party up to three, at a price', () => {
    let g = newGame(23)
    expect(recruit(g, 'mage').error).toBeDefined()
    g = { ...g, gold: 10_000 }
    g = recruit(g, 'mage').state
    g = recruit(g, 'ranger').state
    expect(g.heroes.map(h => h.cls)).toEqual(['warrior', 'mage', 'ranger'])
    expect(g.gold).toBe(10_000 - RECRUIT_COST[1]! - RECRUIT_COST[2]!)
    expect(recruit(g, 'mage').error).toBeDefined()
  })
})

describe('save', () => {
  test('a save round-trips through JSON', () => {
    let g = newGame(25)
    for (let i = 0; i < 50; i += 1) g = step(g)
    expect(parseSave(JSON.parse(JSON.stringify(g)))).toEqual(g)
  })

  test('a corrupt or foreign save is rejected', () => {
    expect(parseSave(undefined)).toBeNull()
    expect(parseSave('nope')).toBeNull()
    expect(parseSave({ version: 2 })).toBeNull()
    expect(parseSave({ ...newGame(1), heroes: [{ cls: 'bard', level: 1 }] })).toBeNull()
    const hero = newGame(1).heroes[0]!
    expect(parseSave({ ...newGame(1), heroes: [{ ...hero, cls: 'toString' }] })).toBeNull()
    expect(parseSave({ ...newGame(1), heroes: [{ ...hero, gear: undefined }] })).toBeNull()
    expect(parseSave({ ...newGame(1), inventory: [{ id: 'x', slot: 'hat' }] })).toBeNull()
    expect(parseSave({ ...newGame(1), monster: { ...newGame(1).monster, tier: 'god' } })).toBeNull()
  })

  test('an HP bar never overflows its width', () => {
    expect(bar(150, 100, 5)).toBe('█████')
    expect(bar(-3, 100, 5)).toBe('░░░░░')
    expect(bar(5, 0, 5)).toBe('░░░░░')
  })
})

describe('test command detection', () => {
  test('recognises test runners', () => {
    for (const command of [
      'npm test',
      'npm t',
      'pnpm run test -- --watch=false',
      'pnpm -r test',
      'pnpm --filter web test',
      'yarn workspace web test',
      'yarn test:unit',
      'bun test',
      'npx vitest run',
      'pnpm vitest run',
      'npx turbo test',
      'nx test api',
      'node --test',
      'pytest -q tests/',
      'py.test',
      'python -m pytest',
      'tox',
      'go test ./...',
      'cargo test',
      'bazel test //...',
      'ctest',
      'cd app && npm test',
      'CI=1 npm test 2>&1 | tail -20',
      'env CI=1 npm test',
      'timeout 600 npm test',
      'for p in a b; do go test ./$p; done',
      'if npm test; then echo ok; fi',
      'claude plugin test .',
    ]) {
      expect(isTestCommand(command), command).toBe(true)
    }
  })

  test('ignores commands that only mention a runner', () => {
    for (const command of [
      'echo "npm test"',
      'echo "done; npm test"',
      "echo 'pytest; go test'",
      'grep -r pytest .',
      'cat go.mod',
      'npm install',
      'git commit -m "fix test"',
      "git commit -m \"$(cat <<'EOF'\nfix: flaky spec\n\nnpm test passes now\nEOF\n)\"",
      "cat > notes.md <<'EOF'\nnpm test\nEOF",
    ]) {
      expect(isTestCommand(command), command).toBe(false)
    }
  })

  test('ignores runs that execute no test', () => {
    for (const command of ['pytest --collect-only', 'cargo test --no-run', 'go test -run NONE ./...', 'npm test -- --listTests']) {
      expect(isTestCommand(command), command).toBe(false)
    }
  })

  test('a run passes only without an error result or failure verdict', () => {
    expect(isPassingRun('Tests: 12 passed, 12 total', false)).toBe(true)
    expect(isPassingRun('3 passed, 0 failed', false)).toBe(true)
    expect(isPassingRun('  ✓ reports 3 errors for invalid input\nTests:       12 passed, 12 total', false)).toBe(true)
    expect(isPassingRun('  ✓ returns FAIL status when unhealthy\nTests: 4 passed', false)).toBe(true)
    expect(isPassingRun('Tests:       1 failed, 11 passed, 12 total', false)).toBe(false)
    expect(isPassingRun(' FAIL  src/a.test.ts', false)).toBe(false)
    expect(isPassingRun('--- FAIL: TestThing (0.00s)', false)).toBe(false)
    expect(isPassingRun('test result: FAILED. 2 passed; 1 failed', false)).toBe(false)
    expect(isPassingRun('===== 1 failed, 3 passed in 0.12s =====', false)).toBe(false)
    expect(isPassingRun('not ok 2 - adds', false)).toBe(false)
    expect(isPassingRun('anything', true)).toBe(false)
  })
})

describe('pixel art', () => {
  const all = [
    ...Object.values(PIXEL_HEROES),
    ...Object.values(PIXEL_HERO_ATTACKS),
    ...Object.values(PIXEL_HERO_STRIDES).flat(),
    ...PIXEL_MONSTERS,
    ...PIXEL_BOSSES,
  ]

  test('every sprite uses only palette colors', () => {
    for (const sprite of all) {
      for (const row of sprite) {
        for (const key of row) expect(key === '.' || key in PALETTE, `${key} in ${row}`).toBe(true)
      }
    }
  })

  test('there is a sprite for every monster and boss', () => {
    expect(PIXEL_MONSTERS).toHaveLength(MONSTERS.length)
    expect(PIXEL_BOSSES).toHaveLength(BOSSES.length)
  })

  test('every frame of a fight keeps one size, so frames can repaint in place', () => {
    let g = { ...newGame(5), gold: 10_000 }
    g = recruit(g, 'mage').state
    g = recruit(g, 'ranger').state
    let a = newAnim()
    const sizes = new Set<string>()
    const looks = new Set<string>()
    for (let f = 0; f < 200; f += 1) {
      if (f % 15 === 14) g = step(g)
      a = tick(observe(a, g))
      const scene = compose(g, a)
      sizes.add(`${scene.columns}x${scene.rows}`)
      looks.add(scene.cells)
    }
    expect(sizes.size).toBe(1)
    expect(looks.size).toBeGreaterThan(20)
  })

  test('a volley swings, casts and shoots, and a kill plays a death then a walk-in', () => {
    let g = { ...newGame(5), gold: 10_000 }
    g = recruit(g, 'mage').state
    let a = tick(observe(newAnim(), g))
    for (let f = 0; f < 20; f += 1) a = tick(observe(a, g))
    const struck = { ...g, seed: g.seed + 1, monster: { ...g.monster, hp: g.monster.hp - 5 } }
    a = observe(a, struck)
    expect(a.volleyAt).toBe(a.t)
    expect(a.numbers.at(-1)?.value).toBe(5)
    const killed = { ...struck, stats: { ...struck.stats, kills: struck.stats.kills + 1 } }
    a = observe(tick(a), killed)
    expect(a.dying?.monster.name).toBe(g.monster.name)
    expect(a.enterAt).toBeGreaterThan(a.t)
  })

  test('a full party against a boss fits in 90 columns', () => {
    let g = { ...newGame(3), gold: 10_000 }
    g = recruit(g, 'mage').state
    g = recruit(g, 'ranger').state
    g = { ...g, monster: { ...g.monster, tier: 'boss', sprite: 0 } }
    const scene = pixelScene(g)
    expect(scene.columns).toBeLessThanOrEqual(90)
    const cells = decodeCells(scene)
    expect(cells).toHaveLength(scene.rows)
    expect(cells[0]).toHaveLength(scene.columns)
    expect(cells.flat().every(c => [' ', '▀', '▄'].includes(c.ch))).toBe(true)
  })

  test('a fallen hero is drawn in gray', () => {
    const g = newGame(3)
    // The lone hero's columns, every cell row but the HP bars at the bottom.
    const heroPixels = (state: GameState) =>
      decodeCells(pixelScene(state))
        .slice(0, -1)
        .flatMap(row => row.slice(0, 12))
        .flatMap(c => [c.fg, c.bg])
        .filter((c): c is number => c !== null)
    const isGray = (c: number) => ((c >> 16) & 255) === ((c >> 8) & 255) && ((c >> 8) & 255) === (c & 255)
    expect(heroPixels(g).every(isGray)).toBe(false)
    const down = { ...g, resting: 2, heroes: g.heroes.map(h => ({ ...h, hp: 0 })) }
    expect(heroPixels(down).length).toBeGreaterThan(0)
    expect(heroPixels(down).every(isGray)).toBe(true)
  })
})
