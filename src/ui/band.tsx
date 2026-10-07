import type { Elements, RenderElement } from 'claude-code'

import type { GameState } from '../../types'

import { KILLS_PER_STAGE, TIERS } from '../game/catalog'
import { heroStats } from '../game/engine'
import { CLASS_COLOR, bar, formatNumber, heroSprite, monsterSprite, pad, summaryLine } from './art'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const HERO_WIDTH = 6
const MONSTER_WIDTH = 8
const SCENE_ROWS = 4
/** Narrower than this, the band falls back to one summary line. */
const MIN_SCENE_COLUMNS = 46
/** Wider than this, the info column sits beside the scene; narrower, one info row goes under it. */
const MIN_INFO_COLUMNS = 72

export function band(props: { kit: Kit; game: GameState; columns: number; rows: number }): RenderElement {
  const { kit, game, columns, rows } = props
  const { Box, Text } = kit

  if (columns < MIN_SCENE_COLUMNS || rows < SCENE_ROWS + 1) {
    return (
      <Box>
        <Text wrap="truncate-end">{summaryLine(game)}</Text>
      </Box>
    )
  }

  const monster = game.monster
  const tier = TIERS[monster.tier]
  const mSprite = monsterSprite(monster)
  const heroRows = game.heroes.map(hero => {
    const sprite = heroSprite(hero, game.frame)
    // Heroes stand on the same ground as the taller monster.
    return [...Array<string>(SCENE_ROWS - sprite.length).fill(''), ...sprite]
  })
  const gap = game.resting > 0 ? ' zZz ' : game.frame === 1 ? ' -=> ' : '  -> '

  const scene = (
    <Box flexDirection="column">
      {Array.from({ length: SCENE_ROWS }, (_, row) => (
        <Box flexDirection="row">
          {game.heroes.map((hero, i) => (
            <Text color={hero.hp > 0 ? CLASS_COLOR[hero.cls] : 'gray'}>{pad(heroRows[i]?.[row] ?? '', HERO_WIDTH)}</Text>
          ))}
          <Text dimColor>{row === SCENE_ROWS - 2 ? gap : '     '}</Text>
          <Text color={tier.color} bold={monster.tier === 'boss'}>
            {pad(mSprite[row] ?? '', MONSTER_WIDTH)}
          </Text>
        </Box>
      ))}
      <Box flexDirection="row">
        {game.heroes.map(hero => (
          <Text color="green">{pad(bar(hero.hp, heroStats(hero).maxHp, HERO_WIDTH - 1), HERO_WIDTH)}</Text>
        ))}
        <Text>{'     '}</Text>
        <Text color="red">{bar(monster.hp, monster.maxHp, MONSTER_WIDTH - 1)}</Text>
      </Box>
    </Box>
  )

  const progress = monster.tier === 'boss' ? 'BOSS!' : `${game.stageKills}/${KILLS_PER_STAGE}`
  const party = `${game.heroes.map(member => `${member.name} Lv${member.level}`).join(' · ')} · /hero`
  const info = [
    <Text bold color="yellow" wrap="truncate-end">
      {`Terminal Tales · Ải ${game.stage} (${progress}) · ${formatNumber(game.gold)} vàng`}
    </Text>,
    <Text wrap="truncate-end">
      <Text color={tier.color}>{`${tier.label} ${monster.name}`}</Text>
      <Text dimColor>{` ${formatNumber(monster.hp)}/${formatNumber(monster.maxHp)} HP`}</Text>
    </Text>,
    <Text dimColor wrap="truncate-end">
      {party}
    </Text>,
    ...game.log.slice(-2).map(line => (
      <Text dimColor wrap="truncate-end">
        {`› ${line}`}
      </Text>
    )),
  ]

  if (columns < MIN_INFO_COLUMNS) {
    return (
      <Box flexDirection="column">
        {scene}
        {rows > SCENE_ROWS + 1 && (
          <Text color="yellow" wrap="truncate-end">
            {summaryLine(game)}
          </Text>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      {scene}
      <Box flexDirection="column" marginLeft={2} flexShrink={1}>
        {info}
      </Box>
    </Box>
  )
}
