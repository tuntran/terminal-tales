import type { Elements, RenderElement } from 'claude-code'

import type { GameState } from '../../types'

import { KILLS_PER_STAGE, TIERS } from '../game/catalog'
import { effectsOf, formatNumber, summaryLine } from './art'
import { FRAME_HEIGHT, FRAME_WIDTH } from './frame-buffer'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
/** The terminal's picture element; absent on surfaces that have none, which show an error line. */
export type ImageKit = Elements['terminal']['Image'] | undefined

/**
 * The cells the scene's picture fills. FRAME_WIDTH × FRAME_HEIGHT pixels over
 * 69 × 8 cells keeps a pixel square on a terminal whose cells are twice as
 * tall as wide.
 */
export const SCENE_COLUMNS = 69
export const SCENE_ROWS = 8
/** Columns the info column beside the scene needs. */
const INFO_COLUMNS = 34

/** What the band says where it cannot show a picture: on a surface without one, or as its alt. */
export const NO_PICTURES = 'Terminal Tales cần terminal hỗ trợ kitty graphics (kitty, Ghostty, Orca…)'
export const TOO_SMALL = `Terminal Tales cần dải rộng ít nhất ${SCENE_COLUMNS} cột và cao ${SCENE_ROWS} dòng`
const LOADING = 'Terminal Tales: đang tải hình…'

/** True when the band has room for the whole scene. */
export function fitsScene(columns: number, rows: number): boolean {
  return columns >= SCENE_COLUMNS && rows >= SCENE_ROWS
}

export function band(props: {
  kit: Kit
  image: ImageKit
  /** The scene's current frame, RGBA base64; null while it cannot be painted. */
  scene: string | null
  /** Why the scene cannot be painted, when it cannot. */
  error: string | null
  game: GameState
  columns: number
  rows: number
}): RenderElement {
  const { kit, image: Image, scene, error, game, columns, rows } = props
  const { Box, Text } = kit

  const problem = Image === undefined ? NO_PICTURES : (error ?? (fitsScene(columns, rows) ? null : TOO_SMALL))
  if (Image === undefined || problem !== null || scene === null) {
    return (
      <Box>
        <Text color="yellow" wrap="truncate-end">
          {problem ?? LOADING}
        </Text>
      </Box>
    )
  }

  const picture = (
    <Image key="scene" source={{ rgba: scene, width: FRAME_WIDTH, height: FRAME_HEIGHT }} columns={SCENE_COLUMNS} rows={SCENE_ROWS} alt={NO_PICTURES} />
  )
  if (columns >= SCENE_COLUMNS + INFO_COLUMNS) {
    return (
      <Box flexDirection="row">
        {picture}
        <Box flexDirection="column" marginLeft={2} flexShrink={1}>
          {infoLines(kit, game, SCENE_ROWS - 4)}
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {picture}
      {rows > SCENE_ROWS && (
        <Text color="yellow" wrap="truncate-end">
          {summaryLine(game)}
        </Text>
      )}
    </Box>
  )
}

/** The lasting effects of both sides, the party's in green and the monster's in red; null when none. */
function effectsRow(kit: Kit, game: GameState): RenderElement | null {
  const { Text } = kit
  const heroes = effectsOf(game, 'heroes')
  const monster = effectsOf(game, 'monster')
  if (heroes === null && monster === null) return null
  return (
    <Text wrap="truncate-end">
      {heroes !== null && <Text color="green">{`Đội ${heroes}`}</Text>}
      {heroes !== null && monster !== null && <Text dimColor>{'  |  '}</Text>}
      {monster !== null && <Text color="red">{`Quái ${monster}`}</Text>}
    </Text>
  )
}

function lastLines(log: readonly string[], count: number): readonly string[] {
  return count > 0 ? log.slice(-count) : []
}

function infoLines(kit: Kit, game: GameState, logLines = 2): RenderElement[] {
  const { Text } = kit
  const effects = effectsRow(kit, game)
  const monster = game.monster
  const tier = TIERS[monster.tier]
  const progress = monster.tier === 'boss' ? 'BOSS!' : `${game.stageKills}/${KILLS_PER_STAGE}`
  const party = `${game.heroes.map(member => `${member.name} Lv${member.level}`).join(' · ')} · /hero`
  return [
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
    // The effects row takes the place of the oldest log line, so the column keeps its height.
    ...(effects === null ? [] : [effects]),
    ...lastLines(game.log, effects === null ? logLines : logLines - 1).map(line => (
      <Text dimColor wrap="truncate-end">
        {`› ${line}`}
      </Text>
    )),
  ]
}
