import { eventBus } from '../core/EventBus'
import type { UnitId, Vec3 } from '../Data/Types'
import type { WeaponStats } from '../Data/Types'
import type { UnitStore } from '../units/UnitStore'

export interface ShotRequest {
  attackerId: UnitId
  targetId: UnitId
  weapon: WeaponStats
  /** Optional multiplier used by the demo to keep the showcase readable. */
  damageScale?: number
}

export type LineOfSightCheck = (from: Vec3, to: Vec3) => boolean

/**
 * Resolves a single shot: range, line of sight and accuracy. Hit points are
 * owned by DamageSystem, which consumes the emitted `damage` event.
 */
export class CombatSystem {
  constructor(
    private readonly store: UnitStore,
    private readonly lineOfSight: LineOfSightCheck,
  ) {}

  canSee(attackerId: UnitId, targetId: UnitId, range: number): boolean {
    const attacker = this.store.get(attackerId)
    const target = this.store.get(targetId)
    if (!attacker || !target || attacker.state !== 'alive' || target.state !== 'alive') return false
    if (attacker.team === target.team) return false
    if (distance(attacker.position, target.position) > range) return false
    return this.lineOfSight(eye(attacker.position), eye(target.position))
  }

  fire(request: ShotRequest): boolean {
    const attacker = this.store.get(request.attackerId)
    const target = this.store.get(request.targetId)
    if (!attacker || !target) return false
    if (attacker.state !== 'alive' || target.state !== 'alive') return false
    if (attacker.team === target.team) return false
    if (distance(attacker.position, target.position) > request.weapon.range) return false
    if (!this.lineOfSight(eye(attacker.position), eye(target.position))) return false

    const from = eye(attacker.position)
    const to = eye(target.position)
    const hit = Math.random() <= request.weapon.accuracy
    const miss = hit
      ? { x: 0, y: 0, z: 0 }
      : {
          x: (Math.random() - 0.5) * 1.4,
          y: (Math.random() - 0.35) * 0.8,
          z: (Math.random() - 0.5) * 1.4,
        }

    eventBus.emit('shotFired', {
      unitId: attacker.id,
      from,
      to: { x: to.x + miss.x, y: to.y + miss.y, z: to.z + miss.z },
    })
    eventBus.emit('audioPlay', { sfx: request.weapon.sfx, volume: 0.35 })

    if (hit) {
      eventBus.emit('damage', {
        targetId: target.id,
        sourceId: attacker.id,
        amount: request.weapon.damage * (request.damageScale ?? 1),
        damageType: 'bullet',
        hitPoint: to,
      })
    }
    return true
  }
}

function eye(position: Vec3): Vec3 {
  return { x: position.x, y: position.y + 1.25, z: position.z }
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}
