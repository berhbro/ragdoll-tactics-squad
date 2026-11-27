import { eventBus } from '../core/EventBus'
import { MINE } from '../config/constants'
import type { UnitId, Vec3 } from '../Data/Types'
import type { Mine, MinefieldManager } from '../managers/MinefieldManager'
import type { UnitStore } from '../units/UnitStore'

interface PendingExplosion {
  mine: Mine
  remaining: number
}

/**
 * Delays a triggered mine by 0.8 s, then damages every living unit inside the
 * 2.5 m blast radius and emits the impulse used by ragdolls and effects.
 */
export class MineExplosionSystem {
  readonly delay = MINE.triggerDelaySec
  readonly damage = MINE.damage
  readonly radius = MINE.blastRadius
  private pending: PendingExplosion[] = []

  constructor(
    private readonly mines: MinefieldManager,
    private readonly store: UnitStore,
  ) {
    eventBus.on('mineTriggered', this.onTriggered)
  }

  update(dt: number): void {
    const step = Math.max(0, Number.isFinite(dt) ? dt : 0)
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      const item = this.pending[i]
      item.remaining -= step
      if (item.remaining > 0) continue
      this.pending.splice(i, 1)
      this.detonate(item.mine)
    }
  }

  reset(): void {
    this.pending = []
  }

  dispose(): void {
    eventBus.off('mineTriggered', this.onTriggered)
    this.pending = []
  }

  getPendingMineIds(): string[] {
    return this.pending.map((item) => item.mine.id)
  }

  private detonate(mine: Mine): void {
    const center = mine.position
    const victims: UnitId[] = []
    for (const unit of this.store.alive()) {
      const distance = Math.hypot(
        unit.position.x - center.x,
        unit.position.z - center.z,
      )
      if (distance > this.radius) continue
      victims.push(unit.id)
      eventBus.emit('damage', {
        targetId: unit.id,
        amount: this.damage,
        damageType: 'mine',
        hitPoint: { ...center },
        impulse: { x: unit.position.x - center.x, y: 1, z: unit.position.z - center.z },
      })
    }

    eventBus.emit('explosionImpulse', {
      center: { ...center },
      radius: this.radius,
      strength: 5.5,
      sourceId: mine.id,
    })
    eventBus.emit('cameraShake', { strength: 0.35 })
    eventBus.emit('audioPlay', { sfx: 'explosion', volume: 0.9 })
    if (victims.length > 0) {
      eventBus.emit('notify', { text: '地雷爆炸！', tone: 'warn' })
    }
  }

  private onTriggered = (payload: { mineId: string }): void => {
    const mine = this.mines.get(payload.mineId)
    if (!mine) return
    if (this.pending.some((item) => item.mine.id === mine.id)) return
    this.pending.push({ mine, remaining: this.delay })
  }
}

export function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}
