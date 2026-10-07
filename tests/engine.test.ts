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
import { PALETTE, PIXEL_HEROES, PIXEL_HERO_ATTACKS, PIXEL_HERO_STRIDES, decodeCells, pixelMonster } from '../src/ui/pixel-art'
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

describe('pixel art', () => {
  const all = [
    ...Object.values(PIXEL_HEROES),
    ...Object.values(PIXEL_HERO_ATTACKS),
    ...Object.values(PIXEL_HERO_STRIDES).flat(),
    ...[...MONSTERS, ...BOSSES].map(kind => pixelMonster(kind.asset)),
  ]

  test('every sprite uses only palette colors', () => {
    for (const sprite of all) {
      for (const row of sprite) {
        for (const key of row) expect(key === '.' || key in PALETTE, `${key} in ${row}`).toBe(true)
      }
    }
  })

  test('a save from the older, longer monster lists loads and draws', () => {
    const g = newGame(3)
    for (const [tier, sprite] of [['normal', 4], ['boss', 1], ['elite', 9], ['boss', -1]] as const) {
      const old = { ...g, monster: { ...g.monster, name: 'Slime Bug', tier, sprite } }
      const loaded = parseSave(JSON.parse(JSON.stringify(old)))
      expect(loaded?.monster.sprite, `${tier} ${sprite}`).toBe(sprite)
      const kinds = tier === 'boss' ? BOSSES : MONSTERS
      expect(kinds).toContain(monsterKind(loaded!.monster))
      expect(pixelScene(loaded!).cells.length).toBeGreaterThan(0)
    }
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
