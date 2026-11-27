import { eventBus } from '../core/EventBus'
import { PLAYER_WEAPONS } from '../config/constants'
import type { UnitId, Vec3 } from '../Data/Types'
import type { CombatSystem } from './CombatSystem'
import type { UnitStore } from '../units/UnitStore'

interface PlayerAim {
  targetId?: UnitId
  nextScan: number
  cooldown: number
}

/** Automatic fire for the player squad. The player only gives movement orders. */
export class PlayerCombat {
  private readonly aims = new Map<UnitId, PlayerAim>()
  private focusTargetId: UnitId | undefined
  private focusUntil = 0
  private clock = 0

  constructor(
    private readonly store: UnitStore,
    private readonly combat: CombatSystem,
    private readonly isSuppressed: (unitId: UnitId) => boolean = () => false,
    private readonly getSelectedIds: () => UnitId[] = () => [],
    private readonly damageScale = 1,
  ) {}

  focus(targetId: UnitId): boolean {
    const target = this.store.get(targetId)
    if (!target || target.team !== 'enemy' || target.state !== 'alive') return false
    this.focusTargetId = targetId
    this.focusUntil = this.clock + 7
    eventBus.emit('notify', { text: '集火目标已标记', tone: 'info' })

    const selected = new Set(this.getSelectedIds())
    const shooters = this.store.alive('player').filter((unit) => selected.size === 0 || selected.has(unit.id))
    for (const unit of shooters) {
      const weapon = PLAYER_WEAPONS[unit.role === 'enemy' ? 'rifleman' : unit.role]
      const distance = distanceXZ(unit.position, target.position)
      if (distance <= weapon.range * 0.8) continue
      const dx = unit.position.x - target.position.x
      const dz = unit.position.z - target.position.z
      const len = Math.hypot(dx, dz) || 1
      eventBus.emit('moveCommand', {
        unitIds: [unit.id],
        position: {
          x: target.position.x + (dx / len) * weapon.range * 0.7,
          y: 0,
          z: target.position.z + (dz / len) * weapon.range * 0.7,
        },
        queue: false,
        forceMine: false,
      })
    }
    return true
  }

  update(dt: number): void {
    this.clock += dt
    if (this.focusTargetId && this.clock > this.focusUntil) this.focusTargetId = undefined

    for (const unit of this.store.alive('player')) {
      const weapon = PLAYER_WEAPONS[unit.role === 'enemy' ? 'rifleman' : unit.role]
      let aim = this.aims.get(unit.id)
      if (!aim) {
        aim = { nextScan: 0, cooldown: Math.random() * 0.3 }
        this.aims.set(unit.id, aim)
      }
      aim.cooldown = Math.max(0, aim.cooldown - dt)

      if (this.isSuppressed(unit.id)) continue

      const focus = this.focusTargetId ? this.store.get(this.focusTargetId) : undefined
      if (focus && focus.state === 'alive') {
        aim.targetId = focus.id
      } else if (this.clock >= aim.nextScan) {
        aim.nextScan = this.clock + 0.22
        aim.targetId = this.findTarget(unit.id, unit.position, weapon.range)
      }

      const target = aim.targetId ? this.store.get(aim.targetId) : undefined
      if (!target || target.state !== 'alive') {
        aim.targetId = undefined
        continue
      }

      const dx = target.position.x - unit.position.x
      const dz = target.position.z - unit.position.z
      unit.facing = Math.atan2(dx, dz)

      if (aim.cooldown > 0) continue
      if (distanceXZ(unit.position, target.position) > weapon.range) continue
      if (!this.combat.canSee(unit.id, target.id, weapon.range)) continue

      this.combat.fire({
        attackerId: unit.id,
        targetId: target.id,
        weapon,
        damageScale: this.damageScale,
      })
      aim.cooldown = weapon.interval * (0.9 + Math.random() * 0.2)
    }
  }

  clear(): void {
    this.aims.clear()
    this.focusTargetId = undefined
    this.focusUntil = 0
  }

  private findTarget(unitId: UnitId, from: Vec3, range: number): UnitId | undefined {
    let best: UnitId | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const enemy of this.store.alive('enemy')) {
      const distance = distanceXZ(from, enemy.position)
      if (distance > range || distance >= bestDistance) continue
      if (!this.combat.canSee(unitId, enemy.id, range)) continue
      best = enemy.id
      bestDistance = distance
    }
    return best
  }
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}
