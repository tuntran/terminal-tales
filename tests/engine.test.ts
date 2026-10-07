import { describe, expect, test } from 'claude-code/testing'

import type { GameState, Item } from '../types'

import { ACTION_EFFECT, EFFECTS, KILLS_PER_STAGE, MAX_INVENTORY, RECRUIT_COST } from '../src/game/catalog'
import {
  applyAction,
  critChance,
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
import { isFailedRun, isGitCommit, isPassingRun, isRejectedCall, isTestCommand } from '../src/game/test-command'
import { bar } from '../src/ui/art'
import { BOSSES, MONSTERS, monsterKind } from '../src/game/catalog'
import { decodeAtlas } from '../src/ui/atlas'
import { BACKGROUNDS, type Anim, compose, hasCrit, newAnim, observe, stillAnim, stillScene, tick } from '../src/ui/animation'
import { FRAME_HEIGHT, FRAME_WIDTH, type Frame, backdrop, blit, newFrame } from '../src/ui/frame-buffer'
import { fakeAtlases } from './fake-atlas'

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

/** A fight frozen for effect tests: the monster never dies and hits for a fixed amount. */
function frozen(seed = 31): GameState {
  const g = newGame(seed)
  return { ...g, monster: { ...g.monster, hp: 1e9, maxHp: 1e9, atk: 10 } }
}

function party(g: GameState): GameState {
  return recruit(recruit({ ...g, gold: 10_000 }, 'mage').state, 'ranger').state
}

describe('action effects', () => {
  test('a prompt rallies the party for 20 steps, and a second one refreshes instead of stacking', () => {
    let g = applyAction(newGame(1), 'prompt')
    expect(g.effects).toEqual([{ kind: 'rally', steps: 20, charges: 0 }])
    g = step(step(g))
    expect(g.effects[0]!.steps).toBe(18)
    g = applyAction(g, 'prompt')
    expect(g.effects).toEqual([{ kind: 'rally', steps: 20, charges: 0 }])
  })

  test('trust adds its bonus to crit chance, never past 0.75', () => {
    const g = newGame(1)
    const hero = g.heroes[0]!
    const trusted = applyAction(g, 'permissionAllowed')
    expect(critChance(hero, trusted)).toBe(heroStats(hero).crit + EFFECTS.trust.power)
    expect(critChance(hero, g)).toBe(heroStats(hero).crit)
    const lucky = { ...hero, cls: 'ranger' as const, gear: { ...hero.gear, trinket: { id: 't', name: 'Bùa', slot: 'trinket' as const, rarity: 'legendary' as const, stage: 99, level: 9 } } }
    expect(critChance(lucky, trusted)).toBe(Math.min(0.75, heroStats(lucky).crit + EFFECTS.trust.power))
  })

  test('a milestone blocks exactly one monster hit, then is gone', () => {
    let g = applyAction(frozen(), 'commit')
    const hp = g.heroes[0]!.hp
    g = step(g)
    expect(g.heroes[0]!.hp).toBe(hp)
    expect(g.effects).toEqual([])
    g = step(g)
    expect(g.heroes[0]!.hp).toBeLessThan(hp)
  })

  test('stoneskin blocks two whole volleys of a party of three, and the third lands', () => {
    let g = applyAction(party(frozen()), 'permissionDenied')
    expect(g.heroes).toHaveLength(3)
    const hp = g.monster.hp
    g = step(step(g))
    expect(g.monster.hp).toBe(hp)
    expect(g.effects).toEqual([])
    g = step(g)
    expect(g.monster.hp).toBeLessThan(hp)
  })

  test('the free strike of a tool call neither meets nor spends any effect', () => {
    let g = applyAction(frozen(), 'permissionDenied')
    const hp = g.monster.hp
    g = rewardToolCall(rewardToolCall(g))
    expect(g.monster.hp).toBeLessThan(hp)
    expect(g.effects).toEqual([{ kind: 'stoneskin', steps: 0, charges: 2 }])
    g = step(g)
    expect(g.effects).toEqual([{ kind: 'stoneskin', steps: 0, charges: 1 }])
  })

  test('enrage makes the monster hit for 1.25 times its attack', () => {
    const g = applyAction(frozen(), 'turnAborted')
    const hero = g.heroes[0]!
    const after = step(g)
    const regen = Math.ceil(heroStats(hero).maxHp * 0.03)
    expect(after.heroes[0]!.hp).toBe(hero.hp - Math.round(10 * 1.25) + regen)
  })

  test('second wind heals 15% and calm heals fully, only heroes still standing', () => {
    let g = party(frozen())
    const max = g.heroes.map(h => heroStats(h).maxHp)
    g = { ...g, heroes: g.heroes.map((h, i) => ({ ...h, hp: i === 0 ? 0 : 10 })) }
    const wind = applyAction(g, 'turnDone')
    expect(wind.heroes.map(h => h.hp)).toEqual([0, 10 + Math.round(max[1]! * 0.15), 10 + Math.round(max[2]! * 0.15)])
    const calm = applyAction(g, 'compact')
    expect(calm.heroes.map(h => h.hp)).toEqual([0, max[1], max[2]])
    expect(calm.effects).toEqual([])
  })

  test('regen heals the monster by 20% of its max HP, never past it', () => {
    const g = newGame(1)
    const hurt = { ...g, monster: { ...g.monster, maxHp: 100, hp: 50 } }
    expect(applyAction(hurt, 'bashFailed').monster.hp).toBe(70)
    const almost = { ...g, monster: { ...g.monster, maxHp: 100, hp: 95 } }
    expect(applyAction(almost, 'bashFailed').monster.hp).toBe(100)
  })

  test('durations tick once on a resting step, a killing step and a plain step', () => {
    const start = applyAction(frozen(), 'prompt')
    const resting = step({ ...start, resting: 3 })
    expect(resting.effects[0]!.steps).toBe(19)
    const killing = step({ ...start, monster: { ...start.monster, hp: 1 } })
    expect(killing.stats.kills).toBe(1)
    expect(killing.effects[0]!.steps).toBe(19)
    const plain = step(start)
    expect(plain.effects[0]!.steps).toBe(19)
    let g = start
    for (let i = 0; i < 20; i += 1) g = step(g)
    expect(g.effects).toEqual([])
  })

  test('effects on the monster side outlive the monster they started on', () => {
    let g = applyAction(newGame(1), 'turnAborted')
    g = step({ ...g, monster: { ...g.monster, hp: 1 } })
    expect(g.stats.kills).toBe(1)
    expect(g.effects.map(e => e.kind)).toEqual(['enrage'])
  })

  test('every action writes one log line', () => {
    for (const action of Object.keys(ACTION_EFFECT) as (keyof typeof ACTION_EFFECT)[]) {
      const g = newGame(1)
      const after = applyAction(g, action)
      expect(after.log).toHaveLength(g.log.length + 1)
      expect(after.log.at(-1)).toBe(EFFECTS[ACTION_EFFECT[action]].line)
    }
  })

  test('no action takes gold, items or levels', () => {
    let g = withItem(party(frozen()))
    for (const action of Object.keys(ACTION_EFFECT) as (keyof typeof ACTION_EFFECT)[]) {
      const after = applyAction(g, action)
      expect(after.gold).toBe(g.gold)
      expect(after.inventory).toEqual(g.inventory)
      expect(after.heroes.map(h => h.level)).toEqual(g.heroes.map(h => h.level))
      g = after
    }
  })

  test('the same seed and actions replay the same game', () => {
    const play = () => {
      let g = party(newGame(7))
      for (let i = 0; i < 200; i += 1) {
        if (i % 25 === 0) g = applyAction(g, 'prompt')
        if (i % 40 === 0) g = applyAction(g, 'permissionDenied')
        if (i % 30 === 0) g = applyAction(g, 'turnAborted')
        g = step(g)
      }
      return g
    }
    expect(play()).toEqual(play())
  })

  test('a fight without effects draws the same randomness as before effects existed', () => {
    let g = newGame(7)
    for (let i = 0; i < 300; i += 1) g = i % 3 === 0 ? rewardToolCall(step(g)) : step(g)
    expect({ seed: g.seed, gold: g.gold, kills: g.stats.kills, stage: g.stage, exp: g.heroes[0]!.exp }).toEqual({
      seed: 1285485541,
      gold: 1606,
      kills: 76,
      stage: 7,
      exp: 505,
    })
  })

  test('an old save without effects loads with none, and bad effects are dropped', () => {
    const { effects: _, ...old } = newGame(1)
    expect(parseSave(old)?.effects).toEqual([])
    const mixed = {
      ...newGame(1),
      effects: [
        { kind: 'rally', steps: 5, charges: 0 },
        { kind: 'nuke', steps: 5, charges: 0 },
        { kind: '__proto__', steps: 5, charges: 0 },
        { kind: 'trust', steps: -1, charges: 0 },
        { kind: 'enrage', steps: 'x', charges: 0 },
        null,
      ],
    }
    expect(parseSave(mixed)?.effects).toEqual([{ kind: 'rally', steps: 5, charges: 0 }])
    expect(parseSave({ ...newGame(1), effects: 'nope' })?.effects).toEqual([])
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

describe('action detection', () => {
  test('recognises a real git commit', () => {
    expect(isGitCommit('git commit -m "x"')).toBe(true)
    expect(isGitCommit('git add -A && git commit -qm "feat: y"')).toBe(true)
    expect(isGitCommit('git -C repo commit --amend --no-edit')).toBe(true)
    expect(isGitCommit('git commit --dry-run')).toBe(false)
    expect(isGitCommit('git commit -h')).toBe(false)
    expect(isGitCommit('echo "git commit"')).toBe(false)
    expect(isGitCommit('git log --oneline')).toBe(false)
  })

  test('a failed run has an exit code, unlike an interrupt, a rejection or a block', () => {
    expect(isFailedRun('Exit code 1\nmkdir: x: File exists', true)).toBe(true)
    expect(isFailedRun('Exit code 1', false)).toBe(false)
    expect(isFailedRun('Exit code 137\n[Request interrupted by user for tool use]\nPING', true)).toBe(false)
    expect(isFailedRun("The user doesn't want to proceed with this tool use. The tool use was rejected", true)).toBe(false)
    expect(isFailedRun('<tool_use_error>Blocked: sleep 25</tool_use_error>', true)).toBe(false)
  })

  test("a rejected call carries the dialog's rejection text", () => {
    expect(isRejectedCall("The user doesn't want to proceed with this tool use. The tool use was rejected", true)).toBe(true)
    expect(isRejectedCall('Exit code 1', true)).toBe(false)
    expect(isRejectedCall("The user doesn't want to proceed with this tool use.", false)).toBe(false)
  })
})

const ATLASES = fakeAtlases()

/** A packed file by hand: two colors, one clip of two 2×2 frames. */
function tinyAtlas(): Uint8Array {
  return new Uint8Array([
    0x54, 0x54, 0x41, 0x31, 2, 0,
    255, 0, 0, 255,
    0, 0, 255, 255,
    0, 1, 2, 1,
    2, 2, 0, 0,
  ])
}

const TINY = { file: 'tiny.bin', clips: { idle: { frames: 2, width: 2, height: 2, offset: 0, anchorX: 1, anchorY: 1, frameMs: 100 } } }

function pixel(f: Frame, x: number, y: number): number[] {
  return Array.from(f.rgba.subarray((y * f.width + x) * 4, (y * f.width + x) * 4 + 4))
}

/** True when the two frames differ anywhere in columns [from, to). */
function differsIn(a: Frame, b: Frame, from: number, to: number): boolean {
  for (let y = 0; y < a.height; y += 1) {
    for (let x = from; x < to; x += 1) if (pixel(a, x, y).join() !== pixel(b, x, y).join()) return true
  }
  return false
}

/** An animation that has watched `g` long enough to be idle. */
function settled(g: GameState): Anim {
  let a = tick(observe(newAnim(), g))
  for (let f = 0; f < 30; f += 1) a = tick(observe(a, g))
  return a
}

describe('atlas', () => {
  test('decodes palette indexes into RGBA frames, index 0 transparent', () => {
    const atlas = decodeAtlas(tinyAtlas(), TINY)
    const [first, second] = atlas.idle!.frames
    expect(Array.from(first!.rgba.subarray(0, 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(first!.rgba.subarray(4, 8))).toEqual([255, 0, 0, 255])
    expect(Array.from(first!.rgba.subarray(8, 12))).toEqual([0, 0, 255, 255])
    expect(Array.from(second!.rgba.subarray(0, 4))).toEqual([0, 0, 255, 255])
    expect(Array.from(second!.rgba.subarray(12, 16))).toEqual([0, 0, 0, 0])
    expect(atlas.idle).toMatchObject({ width: 2, height: 2, anchorX: 1, anchorY: 1 })
  })

  test('refuses a file of another format or one shorter than its clips', () => {
    const wrong = tinyAtlas()
    wrong[3] = 0x32
    expect(() => decodeAtlas(wrong, TINY)).toThrow()
    expect(() => decodeAtlas(tinyAtlas().subarray(0, 20), TINY)).toThrow()
  })

  test('every manifest entry decodes, with the clips the band plays', () => {
    for (const kind of [...MONSTERS, ...BOSSES]) {
      for (const clip of ['idle', 'run', 'attack', 'hit', 'death']) expect(ATLASES[kind.asset][clip], `${kind.asset} ${clip}`).toBeDefined()
    }
    for (const id of BACKGROUNDS) expect(ATLASES[id].scene!.frames[0]).toMatchObject({ width: FRAME_WIDTH, height: FRAME_HEIGHT })
  })
})

describe('frame buffer', () => {
  test('a picture stamped past any edge is clipped, not an error', () => {
    const f = newFrame()
    const picture = ATLASES['hero-knight'].attack!.frames[0]!
    for (const [x, y] of [[-30, -30], [FRAME_WIDTH - 5, FRAME_HEIGHT - 5], [-1000, 0], [0, 1000]] as const) blit(f, picture, x, y)
    expect(f.rgba).toHaveLength(FRAME_WIDTH * FRAME_HEIGHT * 4)
    expect(pixel(f, 0, 0)[3]).toBe(255)
  })

  test('only solid pixels are stamped', () => {
    const f = newFrame(4, 4)
    blit(f, decodeAtlas(tinyAtlas(), TINY).idle!.frames[0]!, 0, 0)
    expect(pixel(f, 0, 0)).toEqual([0, 0, 0, 0])
    expect(pixel(f, 1, 0)).toEqual([255, 0, 0, 255])
  })

  test('a scrolled backdrop wraps round', () => {
    const picture = { width: 4, height: 1, rgba: new Uint8Array([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255]) }
    const f = newFrame(4, 1)
    backdrop(f, picture, 1)
    expect([0, 1, 2, 3].map(x => pixel(f, x, 0)[0])).toEqual([2, 3, 4, 1])
  })
})

describe('battle scene', () => {
  test('every frame is the same size whatever the party, and the same input paints the same frame', () => {
    let g = { ...newGame(5), gold: 10_000 }
    for (const cls of [null, 'mage', 'ranger'] as const) {
      if (cls !== null) g = recruit(g, cls).state
      const frame = stillScene(g, ATLASES)
      expect([frame.width, frame.height], `${g.heroes.length} heroes`).toEqual([FRAME_WIDTH, FRAME_HEIGHT])
      expect(frame.rgba).toHaveLength(FRAME_WIDTH * FRAME_HEIGHT * 4)
      expect(Array.from(stillScene(g, ATLASES).rgba)).toEqual(Array.from(frame.rgba))
    }
  })

  test('a fight animates: frames change as the game steps', () => {
    let g = party(newGame(5))
    let a = newAnim()
    const looks = new Set<string>()
    for (let f = 0; f < 200; f += 1) {
      if (f % 15 === 14) g = step(g)
      a = tick(observe(a, g))
      const frame = compose(g, a, ATLASES)
      expect(frame.rgba).toHaveLength(FRAME_WIDTH * FRAME_HEIGHT * 4)
      looks.add(Array.from(frame.rgba.subarray(0, FRAME_WIDTH * FRAME_HEIGHT * 4)).join(','))
    }
    expect(looks.size).toBeGreaterThan(20)
  })

  test('the background follows the stage through five backdrops', () => {
    const g = newGame(3)
    const looks = [1, 2, 3, 4, 5, 6].map(stage => Array.from(stillScene({ ...g, stage }, ATLASES).rgba.subarray(0, 64)).join())
    expect(new Set(looks.slice(0, 5)).size).toBe(5)
    expect(looks[5]).toBe(looks[0])
  })

  test('a volley swings, casts and shoots, and a kill plays a death then a walk-in', () => {
    const g = party(newGame(5))
    let a = settled(g)
    const struck = { ...g, seed: g.seed + 1, monster: { ...g.monster, hp: g.monster.hp - 5 } }
    a = observe(a, struck)
    expect(a.volleyAt).toBe(a.t)
    expect(a.numbers.at(-1)).toMatchObject({ value: 5 })
    const killed = { ...struck, stats: { ...struck.stats, kills: struck.stats.kills + 1 } }
    a = observe(tick(a), killed)
    expect(a.dying?.monster.name).toBe(g.monster.name)
    expect(a.enterAt).toBeGreaterThan(a.dying!.at)
  })

  test('a save from the older, longer monster lists loads and draws', () => {
    const g = newGame(3)
    for (const [tier, sprite] of [['normal', 4], ['boss', 1], ['elite', 9], ['boss', -1]] as const) {
      const old = { ...g, monster: { ...g.monster, name: 'Slime Bug', tier, sprite } }
      const loaded = parseSave(JSON.parse(JSON.stringify(old)))
      expect(loaded?.monster.sprite, `${tier} ${sprite}`).toBe(sprite)
      expect(tier === 'boss' ? BOSSES : MONSTERS).toContain(monsterKind(loaded!.monster))
      expect(stillScene(loaded!, ATLASES).rgba).toHaveLength(FRAME_WIDTH * FRAME_HEIGHT * 4)
    }
  })

  test('a fallen hero is drawn in gray', () => {
    const g = newGame(3)
    const isGray = (p: number[]) => p[0] === p[1] && p[1] === p[2]
    // The lone hero stands at x 140 on the ground; look at a column through its body.
    const body = (state: GameState) => Array.from({ length: 30 }, (_, k) => pixel(stillScene(state, ATLASES), 140, 70 - k))
    expect(body(g).every(isGray)).toBe(false)
    const down = { ...g, resting: 2, heroes: g.heroes.map(h => ({ ...h, hp: 0 })) }
    expect(body(down).some(isGray)).toBe(true)
  })
})

describe('battle events', () => {
  test('a crit is damage beyond whole plain volleys', () => {
    expect(hasCrit(30, [10, 20], false)).toBe(false)
    expect(hasCrit(40, [10, 20], false)).toBe(true)
    expect(hasCrit(60, [10, 20], true)).toBe(false)
    expect(hasCrit(60, [10, 20], false)).toBe(true)
    expect(hasCrit(0, [10], false)).toBe(false)
  })

  test('a volley dealing more than the party\'s plain attack is a crit, shown big and gold', () => {
    const g = newGame(3)
    const atk = heroStats(g.heroes[0]!).atk
    const a = observe(settled(g), { ...g, seed: g.seed + 1, monster: { ...g.monster, hp: g.monster.hp - atk * 2 } })
    expect(a.crit).toBe(true)
    expect(a.numbers.at(-1)?.kind).toBe('crit')
    const plain = observe(settled(g), { ...g, seed: g.seed + 1, monster: { ...g.monster, hp: g.monster.hp - atk } })
    expect(plain.crit).toBe(false)
  })

  test('a volley stoneskin blocks shows a gray 0', () => {
    const g = { ...newGame(3), effects: [{ kind: 'stoneskin' as const, steps: 0, charges: 2 }] }
    const a = observe(settled(g), { ...g, seed: g.seed + 1, effects: [{ kind: 'stoneskin' as const, steps: 0, charges: 1 }] })
    expect(a.blocked).toBe(true)
    expect(a.numbers.at(-1)).toMatchObject({ value: 0, kind: 'blocked' })
  })

  test('a heal beyond regeneration marks the side that healed', () => {
    const g = newGame(3)
    const hurt = { ...g, heroes: g.heroes.map(h => ({ ...h, hp: 10 })) }
    const a = observe(settled(hurt), { ...hurt, heroes: hurt.heroes.map(h => ({ ...h, hp: 60 })) })
    expect(a.healAt.heroes).toBe(a.t)
    const wounded = { ...g, monster: { ...g.monster, hp: 5 } }
    const b = observe(settled(wounded), { ...wounded, monster: { ...wounded.monster, hp: 15 } })
    expect(b.healAt.monster).toBe(b.t)
    const regen = observe(settled(hurt), { ...hurt, heroes: hurt.heroes.map(h => ({ ...h, hp: 11 })) })
    expect(regen.healAt.heroes).toBeNull()
  })

  test('HP lost to a gear swap, outside a combat step, is no counterattack', () => {
    const g = newGame(3)
    const a = observe(settled(g), { ...g, heroes: g.heroes.map(h => ({ ...h, hp: h.hp - 5 })) })
    expect(a.counterAt).toBeNull()
  })

  test('a free strike landing with a blocked step shows its damage, not a 0', () => {
    const g = { ...newGame(3), effects: [{ kind: 'stoneskin' as const, steps: 0, charges: 2 }] }
    const a = observe(settled(g), { ...g, seed: g.seed + 1, monster: { ...g.monster, hp: g.monster.hp - 7 }, effects: [{ kind: 'stoneskin' as const, steps: 0, charges: 1 }] })
    expect(a.blocked).toBe(false)
    expect(a.numbers.at(-1)?.value).toBe(7)
  })

  test('a hero falling is marked, and a milestone shield takes the counterattack', () => {
    const g = newGame(3)
    const a = observe(settled(g), { ...g, seed: g.seed + 1, heroes: g.heroes.map(h => ({ ...h, hp: 0 })) })
    expect(a.downAt[0]).toBe(a.t)
    const shielded = { ...g, effects: [{ kind: 'milestone' as const, steps: 0, charges: 1 }] }
    const b = observe(settled(shielded), { ...shielded, seed: g.seed + 1, effects: [] })
    expect(b.counterAt).toBe(b.t)
    expect(b.hitHero).toBeNull()
  })
})

describe('effects on the scene', () => {
  const HEROES: [number, number] = [0, 200]
  const MONSTER: [number, number] = [240, FRAME_WIDTH]

  for (const [kind, [from, to]] of [
    ['rally', HEROES],
    ['trust', HEROES],
    ['milestone', HEROES],
    ['enrage', MONSTER],
    ['stoneskin', MONSTER],
  ] as const) {
    test(`${kind} changes how its side looks`, () => {
      const g = party(newGame(5))
      const plain = stillScene(g, ATLASES)
      const buffed = stillScene({ ...g, effects: [{ kind, steps: 10, charges: 1 }] }, ATLASES)
      expect(differsIn(plain, buffed, from, to)).toBe(true)
    })
  }

  for (const [kind, side, [from, to]] of [
    ['secondWind', 'heroes', HEROES],
    ['calm', 'heroes', HEROES],
    ['regen', 'monster', MONSTER],
  ] as const) {
    test(`${kind} sends up green sparks over the ${side}`, () => {
      const g = party(newGame(5))
      const before = side === 'heroes' ? { ...g, heroes: g.heroes.map(h => ({ ...h, hp: 10 })) } : { ...g, monster: { ...g.monster, hp: 5 } }
      const healed = applyAction(before, kind === 'secondWind' ? 'turnDone' : kind === 'calm' ? 'compact' : 'bashFailed')
      const a = settled(before)
      const plain = compose(healed, tick(a), ATLASES)
      const sparked = compose(healed, tick(observe(a, healed)), ATLASES)
      expect(differsIn(plain, sparked, from, to)).toBe(true)
    })
  }

  test('a crit flashes the whole frame', () => {
    const g = newGame(3)
    const atk = heroStats(g.heroes[0]!).atk
    let a = observe(settled(g), { ...g, seed: g.seed + 1, monster: { ...g.monster, hp: g.monster.hp - atk * 2 } })
    const struck = { ...g, seed: g.seed + 1, monster: { ...g.monster, hp: g.monster.hp - atk * 2 } }
    const at = a.numbers.at(-1)!.at
    while (a.t < at) a = tick(a)
    const flash = compose(struck, a, ATLASES)
    const after = compose(struck, tick(a), ATLASES)
    expect(pixel(flash, 2, 2)[0]!).toBeGreaterThan(pixel(after, 2, 2)[0]!)
  })

  test('a resting party gets a zZz', () => {
    const g = newGame(3)
    const down = { ...g, heroes: g.heroes.map(h => ({ ...h, hp: 0 })) }
    const asleep = { ...down, resting: 2 }
    expect(differsIn(compose(down, stillAnim(down), ATLASES), compose(asleep, stillAnim(asleep), ATLASES), 100, 200)).toBe(true)
  })

  test('elite and rare monsters wear a colored outline', () => {
    const g = newGame(3)
    const normal = stillScene({ ...g, monster: { ...g.monster, tier: 'normal' } }, ATLASES)
    for (const tier of ['elite', 'rare'] as const) {
      expect(differsIn(normal, stillScene({ ...g, monster: { ...g.monster, tier } }, ATLASES), ...MONSTER), tier).toBe(true)
    }
  })
})
