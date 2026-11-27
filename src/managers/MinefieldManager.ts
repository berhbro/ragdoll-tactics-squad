import * as THREE from 'three'
import { eventBus } from '../core/EventBus'
import type { FixedMineData, MineId, RandomMineZone, Vec3 } from '../Data/Types'
import { Layers } from '../config/layers'
import { DETECTOR } from '../config/constants'

export interface Mine {
  id: MineId
  position: Vec3
  revealed: boolean
  defused: boolean
  triggered: boolean
}

export interface MinefieldConfig {
  fixedMines: FixedMineData[]
  randomMines?: RandomMineZone[]
  randomMineSeed?: number
}

/** Owns deterministic mine placement and mine state. */
export class MinefieldManager {
  readonly mines: Mine[] = []

  constructor(config: MinefieldConfig) {
    for (const mine of config.fixedMines) {
      this.mines.push(this.makeMine(mine.id, mine.position))
    }
    for (const zone of config.randomMines ?? []) {
      const candidates = zone.candidatePoints.map((point) => ({ ...point }))
      const zoneRng = seededRandom(hashString(zone.seed) ^ (config.randomMineSeed ?? 1))
      for (let i = 0; i < Math.min(zone.count, candidates.length); i += 1) {
        const index = Math.floor(zoneRng() * candidates.length)
        const [position] = candidates.splice(index, 1)
        if (position) this.mines.push(this.makeMine(`mine_random_${zone.zoneId}_${i + 1}`, position))
      }
    }
  }

  /** Keep the original engineer cone algorithm: 3 m, 120 degrees, nearest first. */
  detect(
    origin: Vec3,
    direction: Vec3,
    range: number = DETECTOR.range,
    halfAngleRadians = (DETECTOR.angleDeg * Math.PI) / 360,
  ): Mine | undefined {
    const unitDirection = normalize(direction)
    return this.mines
      .filter((mine) => !mine.defused && !mine.triggered)
      .map((mine) => ({ mine, offset: subtract(mine.position, origin) }))
      .filter(({ offset }) => length(offset) <= range && dot(unitDirection, normalize(offset)) >= Math.cos(halfAngleRadians))
      .sort((a, b) => length(a.offset) - length(b.offset))[0]?.mine
  }

  reveal(mineId: MineId): boolean {
    const mine = this.get(mineId)
    if (!mine || mine.defused || mine.triggered) return false
    if (!mine.revealed) {
      mine.revealed = true
      eventBus.emit('mineDetected', { mineId: mine.id, position: { ...mine.position } })
    }
    return true
  }

  trigger(mineId: MineId, victims: string[] = []): boolean {
    const mine = this.get(mineId)
    if (!mine || mine.defused || mine.triggered) return false
    mine.triggered = true
    mine.revealed = true
    eventBus.emit('audioPlay', { sfx: 'mineClick', volume: 0.8 })
    eventBus.emit('mineTriggered', { mineId: mine.id, position: { ...mine.position }, victims })
    return true
  }

  defuse(mineId: MineId): boolean {
    const mine = this.get(mineId)
    if (!mine || !mine.revealed || mine.defused || mine.triggered) return false
    mine.defused = true
    eventBus.emit('mineDefused', { mineId })
    return true
  }

  get(mineId: MineId): Mine | undefined {
    return this.mines.find((mine) => mine.id === mineId)
  }

  /** Tags a rendered mine object so InteractionManager can dispatch F/defuse. */
  tagMineObject(object: THREE.Object3D, mineId: MineId): void {
    object.layers.enable(Layers.Target)
    object.userData.interactionKind = 'defuse'
    object.userData.interactionId = mineId
  }

  private makeMine(id: MineId, position: Vec3): Mine {
    return { id, position: { ...position }, revealed: false, defused: false, triggered: false }
  }
}

/** Checks the 0.4 m step radius. Only living player units can set mines off. */
export function checkMineTriggers(
  minefield: MinefieldManager,
  units: { id: string; position: Vec3; state: string }[],
): Mine[] {
  const detonated: Mine[] = []
  for (const mine of minefield.mines) {
    if (mine.defused || mine.triggered) continue
    for (const unit of units) {
      if (unit.state !== 'alive') continue
      const dist = Math.hypot(unit.position.x - mine.position.x, unit.position.z - mine.position.z)
      if (dist < 0.4 && minefield.trigger(mine.id, [unit.id])) {
        detonated.push(mine)
        break
      }
    }
  }
  return detonated
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}
function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}
function normalize(v: Vec3): Vec3 {
  const size = length(v)
  return size > 1e-8 ? { x: v.x / size, y: v.y / size, z: v.z / size } : { x: 0, y: 0, z: 0 }
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}
