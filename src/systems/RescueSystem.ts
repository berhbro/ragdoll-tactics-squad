import { eventBus } from '../core/EventBus'
import type { UnitId, Vec3 } from '../Data/Types'
import { RESCUE } from '../config/constants'
import type { UnitRecord, UnitStore } from '../units/UnitStore'
import type { DamageSystem } from './DamageSystem'

interface ActiveRescue {
  targetId: UnitId
  rescuerId: UnitId
  elapsed: number
  phase: 'approaching' | 'reviving'
}

/** Downed bleed-out timers plus the F-key rescue action. */
export class RescueSystem {
  private readonly downedTimers = new Map<UnitId, number>()
  private active: ActiveRescue | null = null

  constructor(
    private readonly store: UnitStore,
    private readonly damage: DamageSystem,
  ) {
    eventBus.on('unitDowned', this.onDowned)
    eventBus.on('unitRevived', this.onRevived)
    eventBus.on('unitDied', this.onDied)
    eventBus.on('moveCommand', this.onMoveCommand)
  }

  request(targetId: UnitId, preferredRescuerId?: UnitId): boolean {
    if (this.active) return false
    const target = this.store.get(targetId)
    if (!target || target.team !== 'player' || target.state !== 'downed') return false

    const rescuer = this.pickRescuer(target, preferredRescuerId)
    if (!rescuer) {
      eventBus.emit('notify', { text: '没有能执行救援的队员', tone: 'warn' })
      return false
    }

    const distance = distanceXZ(rescuer.position, target.position)
    if (distance <= RESCUE.range + 0.2) {
      this.begin(targetId, rescuer)
      return true
    }

    this.active = { targetId, rescuerId: rescuer.id, elapsed: 0, phase: 'approaching' }
    const dx = rescuer.position.x - target.position.x
    const dz = rescuer.position.z - target.position.z
    const len = Math.hypot(dx, dz) || 1
    eventBus.emit('moveCommand', {
      unitIds: [rescuer.id],
      position: {
        x: target.position.x + (dx / len) * 1.4,
        y: 0,
        z: target.position.z + (dz / len) * 1.4,
      },
      queue: false,
      forceMine: false,
    })
    eventBus.emit('notify', { text: `${rescuer.displayName} 正在前去救援…`, tone: 'info' })
    return true
  }

  update(dt: number): void {
    const step = Math.max(0, dt)

    for (const [unitId, remaining] of this.downedTimers) {
      const next = remaining - step
      if (next > 0) {
        this.downedTimers.set(unitId, next)
        continue
      }
      this.downedTimers.delete(unitId)
      const unit = this.store.get(unitId)
      if (unit?.state === 'downed') {
        this.damage.kill(unitId)
        eventBus.emit('notify', { text: `${unit.displayName} 流血过多阵亡`, tone: 'warn' })
      }
    }

    if (!this.active) return
    const target = this.store.get(this.active.targetId)
    const rescuer = this.store.get(this.active.rescuerId)
    if (!target || target.state !== 'downed' || !rescuer || rescuer.state !== 'alive') {
      this.cancel('救援中断')
      return
    }

    const distance = distanceXZ(rescuer.position, target.position)
    if (this.active.phase === 'reviving' && distance > RESCUE.range + 1) {
      this.cancel('救援者离开了队友')
      return
    }
    if (this.active.phase === 'approaching') {
      if (distance <= RESCUE.range + 0.15) {
        this.begin(target.id, rescuer)
      } else {
        return
      }
    }

    this.active.elapsed += step
    const required = rescuer.role === 'engineer' ? RESCUE.engineerSeconds : RESCUE.otherSeconds
    eventBus.emit('rescueProgress', {
      targetId: target.id,
      progress: Math.min(1, this.active.elapsed / required),
    })

    if (this.active.elapsed >= required) {
      const targetId = target.id
      const rescuerId = rescuer.id
      this.active = null
      this.downedTimers.delete(targetId)
      this.damage.revive(targetId, RESCUE.revivedHp)
      eventBus.emit('rescueCompleted', { targetId, rescuerId })
      eventBus.emit('notify', { text: `${target.displayName} 已被救起`, tone: 'success' })
    }
  }

  cancel(reason?: string): void {
    if (!this.active) return
    const targetId = this.active.targetId
    this.active = null
    eventBus.emit('rescueCancelled', { targetId })
    if (reason) eventBus.emit('notify', { text: reason, tone: 'info' })
  }

  get isBusy(): boolean {
    return this.active !== null
  }

  get activeRescuerId(): UnitId | undefined {
    return this.active?.rescuerId
  }

  get activePhase(): 'approaching' | 'reviving' | 'idle' {
    return this.active?.phase ?? 'idle'
  }

  get activeTargetId(): UnitId | undefined {
    return this.active?.targetId
  }

  dispose(): void {
    eventBus.off('unitDowned', this.onDowned)
    eventBus.off('unitRevived', this.onRevived)
    eventBus.off('unitDied', this.onDied)
    eventBus.off('moveCommand', this.onMoveCommand)
  }

  private begin(targetId: UnitId, rescuer: UnitRecord): void {
    const target = this.store.get(targetId)
    if (!target) return
    this.active = { targetId, rescuerId: rescuer.id, elapsed: 0, phase: 'reviving' }
    eventBus.emit('moveCommand', {
      unitIds: [rescuer.id],
      position: { x: rescuer.position.x, y: 0, z: rescuer.position.z },
      queue: false,
      forceMine: true,
    })
    const required = rescuer.role === 'engineer' ? RESCUE.engineerSeconds : RESCUE.otherSeconds
    eventBus.emit('rescueStarted', {
      targetId,
      rescuerId: rescuer.id,
      durationMs: required * 1000,
    })
  }

  private pickRescuer(target: UnitRecord, preferredId?: UnitId): UnitRecord | null {
    const alive = this.store.alive('player').filter((unit) => unit.id !== target.id)
    if (alive.length === 0) return null
    const preferred = preferredId ? alive.find((unit) => unit.id === preferredId) : undefined
    if (preferred) return preferred
    const selected = this.store
      .alive('player')
      .filter((unit) => unit.id !== target.id && unit.role === 'engineer')
    const pool = selected.length > 0 ? selected : alive
    return pool.slice().sort(
      (a, b) => distanceXZ(a.position, target.position) - distanceXZ(b.position, target.position),
    )[0] ?? null
  }

  private onDowned = ({ unitId }: { unitId: UnitId }): void => {
    this.downedTimers.set(unitId, RESCUE.deathTimeoutSec)
  }

  private onRevived = ({ unitId }: { unitId: UnitId }): void => {
    this.downedTimers.delete(unitId)
    if (this.active?.targetId === unitId) {
      this.active = null
      eventBus.emit('rescueCancelled', { targetId: unitId })
    }
  }

  private onDied = ({ unitId }: { unitId: UnitId }): void => {
    this.downedTimers.delete(unitId)
    if (this.active?.targetId === unitId || this.active?.rescuerId === unitId) {
      const targetId = this.active.targetId
      this.active = null
      eventBus.emit('rescueCancelled', { targetId })
    }
  }

  private onMoveCommand = (command: { unitIds: UnitId[]; position: Vec3 }): void => {
    if (!this.active || this.active.phase !== 'reviving') return
    if (!command.unitIds.includes(this.active.rescuerId)) return
    const target = this.store.get(this.active.targetId)
    if (!target) return
    if (Math.hypot(command.position.x - target.position.x, command.position.z - target.position.z) > 2.5) {
      this.cancel('救援已中断')
    }
  }
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}
