import type { RenderElement } from 'claude-code'

import type { GameState, HeroClass, Item, Slot } from '../../types'

import { CLASSES, CLASS_ORDER, MAX_INVENTORY, MAX_PARTY, RARITIES, SLOT_LABEL, SLOT_ORDER } from '../game/catalog'
import { expToNext, heroStats, itemPower, itemValue, recruitCost, upgradeCost } from '../game/engine'
import { CLASS_COLOR, bar, formatNumber } from './art'
import type { Kit } from './band'

export type PaneActions = {
  select: (index: number) => void
  equip: (heroId: string, itemId: string) => void
  unequip: (heroId: string, slot: Slot) => void
  upgrade: (heroId: string, slot: Slot) => void
  sell: (itemId: string) => void
  recruit: (cls: HeroClass) => void
}

function itemLabel(item: Item): string {
  return `${item.name}${item.level > 0 ? ` +${item.level}` : ''}`
}

function statOf(item: Item): string {
  const power = itemPower(item)
  if (item.slot === 'weapon') return `+${power} ATK`
  if (item.slot === 'armor') return `+${power * 4} HP`
  return `+${Math.round(power * 0.4)} ATK +${Math.min(25, Math.round(power / 2))}% chí mạng`
}

export function heroPane(props: {
  kit: Kit
  game: GameState
  selected: number
  rows: number
  actions: PaneActions
}): RenderElement {
  const { kit, game, actions } = props
  const { Box, Text, Button } = kit
  const index = Math.min(Math.max(0, props.selected), game.heroes.length - 1)
  const hero = game.heroes[index]!
  const stats = heroStats(hero)
  const cost = recruitCost(game)

  // Rows spent outside the bag list, margins included: header 1, tabs 2,
  // card 4, gear 4, recruit 2, bag title 2, and 1 for the overflow line.
  const fixedRows = 14 + (cost === null ? 0 : 2)
  const bagRoom = Math.max(3, props.rows - fixedRows)
  const bag = [...game.inventory].sort((a, b) => itemValue(b) - itemValue(a))
  const shown = bag.slice(0, bagRoom)

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">
        {`${formatNumber(game.gold)} vàng · Ải ${game.stage} · Hạ ${formatNumber(game.stats.kills)} quái · ${game.stats.testPasses} lần test xanh · ${game.stats.toolCalls} tool call`}
      </Text>

      <Box flexDirection="row" marginTop={1}>
        {game.heroes.map((member, i) => (
          <Button
            key={`sel:${i}`}
            label={`${member.name} Lv${member.level}`}
            variant={i === index ? 'primary' : 'secondary'}
            onPress={() => actions.select(i)}
          />
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text bold color={CLASS_COLOR[hero.cls]}>{hero.name}</Text>
          <Text>{` · ${CLASSES[hero.cls].label} · Cấp ${hero.level}`}</Text>
        </Text>
        <Text dimColor>
          {`EXP ${bar(hero.exp, expToNext(hero.level), 16)} ${formatNumber(hero.exp)}/${formatNumber(expToNext(hero.level))}`}
        </Text>
        <Text>
          {`HP ${formatNumber(Math.max(0, hero.hp))}/${formatNumber(stats.maxHp)} · ATK ${formatNumber(stats.atk)} · Chí mạng ${Math.round(stats.crit * 100)}%`}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {SLOT_ORDER.map(slot => {
          const item = hero.gear[slot]
          if (!item) {
            return (
              <Text dimColor>{`${SLOT_LABEL[slot]}: (trống)`}</Text>
            )
          }
          return (
            <Box flexDirection="row">
              <Text>{`${SLOT_LABEL[slot]}: `}</Text>
              <Text color={RARITIES[item.rarity].color}>{itemLabel(item)}</Text>
              <Text dimColor>{` ${statOf(item)} `}</Text>
              <Button
                key={`upg:${slot}`}
                label={`Nâng cấp ${formatNumber(upgradeCost(item))}v`}
                dimColor={game.gold < upgradeCost(item)}
                onPress={() => actions.upgrade(hero.id, slot)}
              />
              <Button key={`off:${slot}`} label="Tháo" dimColor onPress={() => actions.unequip(hero.id, slot)} />
            </Box>
          )
        })}
      </Box>

      {cost !== null && (
        <Box flexDirection="row" marginTop={1}>
          <Text>{`Chiêu mộ (${game.heroes.length}/${MAX_PARTY}, ${formatNumber(cost)}v): `}</Text>
          {CLASS_ORDER.map(cls => (
            <Button
              key={`rec:${cls}`}
              label={CLASSES[cls].label}
              dimColor={game.gold < cost}
              onPress={() => actions.recruit(cls)}
            />
          ))}
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>{`Túi đồ ${game.inventory.length}/${MAX_INVENTORY}`}</Text>
        {shown.length === 0 && <Text dimColor>Chưa có gì. Hạ quái hoặc chạy test xanh để rơi đồ.</Text>}
        {shown.map(item => (
          <Box flexDirection="row">
            <Text color={RARITIES[item.rarity].color}>{`[${RARITIES[item.rarity].label}] ${itemLabel(item)}`}</Text>
            <Text dimColor>{` ${SLOT_LABEL[item.slot]} ${statOf(item)} `}</Text>
            <Button key={`equip:${item.id}`} label="Trang bị" onPress={() => actions.equip(hero.id, item.id)} />
            <Button
              key={`sell:${item.id}`}
              label={`Bán ${formatNumber(itemValue(item))}v`}
              dimColor
              onPress={() => actions.sell(item.id)}
            />
          </Box>
        ))}
        {bag.length > shown.length && <Text dimColor>{`… và ${bag.length - shown.length} món nữa`}</Text>}
      </Box>
    </Box>
  )
}
