import { eventBus } from '../core/EventBus'
import type { DamageEvent, HealthComponent, UnitId } from '../Data/Types'
import type { Stats } from '../core/Stats'
import type { UnitStore } from '../units/UnitStore'

/**
 * Owns hit-point resolution for both teams. Every weapon/explosion routes its
 * damage through the `damage` event so there is exactly one authority for hp.
 */
export class DamageSystem {
  constructor(
    private readonly store: UnitStore,
    private readonly stats?: Stats,
  ) {
    eventBus.on('damage', this.onDamage)
  }

  applyDamage(event: DamageEvent): void {
    const unit = this.store.get(event.targetId)
    if (!unit || unit.state !== 'alive') return

    unit.hp = Math.max(0, unit.hp - Math.max(0, event.amount))

    if (unit.hp <= 0) {
      if (unit.team === 'enemy') {
        unit.state = 'dead'
        eventBus.emit('enemyDeath', { unitId: unit.id, position: { ...unit.position } })
        eventBus.emit('unitDied', { unitId: unit.id })
      } else {
        unit.state = 'downed'
        this.stats?.addDown()
        eventBus.emit('unitDowned', { unitId: unit.id })
      }
    }

    this.emitSquad()
  }

  revive(unitId: UnitId, hp: number): boolean {
    const unit = this.store.get(unitId)
    if (!unit || unit.team !== 'player' || unit.state !== 'downed') return false
    unit.hp = Math.max(1, Math.min(unit.maxHp, hp))
    unit.state = 'alive'
    eventBus.emit('unitRevived', { unitId, hp: unit.hp })
    this.emitSquad()
    return true
  }

  kill(unitId: UnitId): void {
    const unit = this.store.get(unitId)
    if (!unit || unit.state === 'dead') return
    unit.hp = 0
    unit.state = 'dead'
    if (unit.team === 'enemy') {
      eventBus.emit('enemyDeath', { unitId, position: { ...unit.position } })
    }
    eventBus.emit('unitDied', { unitId })
    this.emitSquad()
  }

  getHealth(unitId: UnitId): HealthComponent | null {
    const unit = this.store.get(unitId)
    if (!unit) return null
    return {
      unitId: unit.id,
      team: unit.team,
      role: unit.role,
      displayName: unit.displayName,
      hp: unit.hp,
      maxHp: unit.maxHp,
      state: unit.state,
    }
  }

  emitSquad(): void {
    eventBus.emit('squadUpdate', { units: this.store.snapshot('player') })
  }

  dispose(): void {
    eventBus.off('damage', this.onDamage)
  }

  private onDamage = (event: DamageEvent): void => this.applyDamage(event)
}
