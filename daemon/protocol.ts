// The daemon's wire protocol and the one way an action changes a game, shared
// by the server and the plugin's client. It imports no `node:*` module, so
// the plugin can load it too.

import type { GameAction, GameState, HeroClass, Slot } from '../types'

import { ACTION_EFFECT, CLASSES, SLOT_ORDER } from '../src/game/catalog'
import {
  applyAction,
  equip,
  recruit,
  rewardTestPass,
  rewardToolCall,
  sell,
  unequip,
  upgrade,
  type ActionResult,
} from '../src/game/engine'

/** The argument that marks the daemon's process, so `pgrep -f` finds it. */
export const DAEMON_MARK = 'terminal-tales-daemon'

/** Largest request body the daemon reads; anything longer is refused unread. */
export const MAX_BODY_BYTES = 64 * 1024

/**
 * - `empty`: no world yet; the first client seeds one.
 * - `loaded`: a world the daemon runs and saves.
 * - `locked`: `world.json` came from a newer version; the daemon never writes it.
 */
export type WorldState = 'empty' | 'loaded' | 'locked'

export type HeroOp =
  | { op: 'equip'; heroId: string; itemId: string }
  | { op: 'unequip'; heroId: string; slot: Slot }
  | { op: 'upgrade'; heroId: string; slot: Slot }
  | { op: 'sell'; itemId: string }
  | { op: 'recruit'; cls: HeroClass }

/**
 * One action. `id`, when the client sets one, makes a resend harmless: the
 * daemon applies each id once, so a send that timed out after it landed
 * does not pay twice.
 */
export type DaemonAction = ({ kind: GameAction | 'toolCall' | 'testPass' } | ({ kind: 'hero' } & HeroOp)) & { id?: string }

export type Hello = { build: string; version: string; pid: number; epoch: string; state: WorldState }

export type SeedReply = { adopted: boolean; state: WorldState }

export type ActionReply = { ok: true; seq: number } | { ok: false; error: string }

export type WorldReply = { epoch: string; seq: number; state: WorldState; game: GameState | null }

export type ShutdownReply = { ok: boolean; reason?: string }

/** The action kinds that need nothing but their name. */
const PLAIN_KINDS = new Set<string>([...Object.keys(ACTION_EFFECT), 'toolCall', 'testPass'])

const MAX_ID_LENGTH = 64

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
}

function isSlot(value: unknown): value is Slot {
  return typeof value === 'string' && (SLOT_ORDER as readonly string[]).includes(value)
}

function isClass(value: unknown): value is HeroClass {
  return typeof value === 'string' && Object.hasOwn(CLASSES, value)
}

/**
 * Reads an untrusted `/action` body into an action, or null. Only own,
 * allow-listed keys are read, so `__proto__` or `constructor` in the JSON
 * never reach the engine.
 */
export function parseAction(raw: unknown): DaemonAction | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>
  const field = (name: string): unknown => (Object.hasOwn(body, name) ? body[name] : undefined)
  const kind = field('kind')
  const id = field('id')
  if (typeof kind !== 'string' || (id !== undefined && !isId(id))) return null
  const action = parseKind(kind, field)
  return action === null || id === undefined ? action : { ...action, id }
}

function parseKind(kind: string, field: (name: string) => unknown): DaemonAction | null {
  if (PLAIN_KINDS.has(kind)) return { kind: kind as GameAction | 'toolCall' | 'testPass' }
  if (kind !== 'hero') return null
  const op = field('op')
  switch (op) {
    case 'equip': {
      const heroId = field('heroId')
      const itemId = field('itemId')
      return isId(heroId) && isId(itemId) ? { kind, op, heroId, itemId } : null
    }
    case 'unequip':
    case 'upgrade': {
      const heroId = field('heroId')
      const slot = field('slot')
      return isId(heroId) && isSlot(slot) ? { kind, op, heroId, slot } : null
    }
    case 'sell': {
      const itemId = field('itemId')
      return isId(itemId) ? { kind, op, itemId } : null
    }
    case 'recruit': {
      const cls = field('cls')
      return isClass(cls) ? { kind, op, cls } : null
    }
    default:
      return null
  }
}

function applyHero(g: GameState, hero: HeroOp): ActionResult {
  switch (hero.op) {
    case 'equip':
      return equip(g, hero.heroId, hero.itemId)
    case 'unequip':
      return unequip(g, hero.heroId, hero.slot)
    case 'upgrade':
      return upgrade(g, hero.heroId, hero.slot)
    case 'sell':
      return sell(g, hero.itemId)
    case 'recruit':
      return recruit(g, hero.cls)
  }
}

/** Applies one action to a game, the daemon's and a solo session's alike. */
export function applyDaemonAction(g: GameState, action: DaemonAction): ActionResult {
  if (action.kind === 'hero') return applyHero(g, action)
  if (action.kind === 'toolCall') return { state: rewardToolCall(g) }
  if (action.kind === 'testPass') return { state: rewardTestPass(g) }
  return { state: applyAction(g, action.kind) }
}

/** Compares two `x.y.z` versions: negative when `a` is older, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('.').map(n => Number.parseInt(n, 10) || 0)
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * FNV-1a over a text, as 8 hex digits: the build id of a daemon bundle. The
 * daemon hashes its own file and the plugin the bundle it would launch, so a
 * changed bundle under the same version is still told apart.
 */
export function buildId(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
