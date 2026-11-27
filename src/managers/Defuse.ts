import type { MineId, UnitId, Vec3 } from '../Data/Types'
import { eventBus } from '../core/EventBus'
import { DEFUSE } from '../config/constants'
import type { UnitStore } from '../units/UnitStore'
import { MinefieldManager } from './MinefieldManager'

export interface DefuseOptions {
  durationSeconds?: number
  failureRate?: number
}

type DefusePhase = 'idle' | 'approaching' | 'defusing'

/**
 * Engineer defusal: walk to a point 1.8 m from the mine, then a three-second
 * progress bar with a ten percent failure chance. The approach uses the same
 * moveCommand path as the player.
 */
export class Defuse {
  private phase: DefusePhase = 'idle'
  private elapsed = 0
  private targetId: MineId | undefined
  private engineerId: UnitId | undefined

  constructor(
    private readonly minefield: MinefieldManager,
    private readonly store: UnitStore,
    private readonly options: DefuseOptions = {},
  ) {
    eventBus.on('moveCommand', this.onMoveCommand)
  }

  request(mineId: MineId, engineerId: UnitId): boolean {
    if (this.phase !== 'idle') return false
    const mine = this.minefield.get(mineId)
    const engineer = this.store.get(engineerId)
    if (!mine || !mine.revealed || mine.defused || mine.triggered) return false
    if (!engineer || engineer.role !== 'engineer' || engineer.state !== 'alive') return false

    this.targetId = mineId
    this.engineerId = engineerId
    this.elapsed = 0

    const distance = distanceXZ(engineer.position, mine.position)
    if (distance <= DEFUSE.approachDistance + 0.15) {
      this.beginDefusing(engineer.position, mine.position)
      return true
    }

    this.phase = 'approaching'
    const dx = engineer.position.x - mine.position.x
    const dz = engineer.position.z - mine.position.z
    const len = Math.hypot(dx, dz) || 1
    const approach = {
      x: mine.position.x + (dx / len) * 1.75,
      y: 0,
      z: mine.position.z + (dz / len) * 1.75,
    }
    eventBus.emit('moveCommand', {
      unitIds: [engineerId],
      position: approach,
      queue: false,
      forceMine: true,
    })
    eventBus.emit('notify', { text: '工兵正在接近地雷…', tone: 'info' })
    return true
  }

  update(deltaSeconds: number, random: () => number = Math.random): boolean {
    if (this.phase === 'idle' || !this.targetId || !this.engineerId) return false
    const mine = this.minefield.get(this.targetId)
    const engineer = this.store.get(this.engineerId)
    if (!mine || !engineer || mine.defused || mine.triggered || engineer.state !== 'alive') {
      this.cancel()
      return false
    }

    const distance = distanceXZ(engineer.position, mine.position)

    if (this.phase === 'approaching') {
      if (distance > 4.5) {
        this.cancel('工兵离开排雷区域')
        return false
      }
      if (distance <= DEFUSE.approachDistance + 0.2) {
        this.beginDefusing(engineer.position, mine.position)
      }
      return false
    }

    if (distance > DEFUSE.approachDistance + 0.65) {
      this.cancel('工兵离开了地雷')
      return false
    }

    this.elapsed += Math.max(0, deltaSeconds)
    const progress = Math.min(this.elapsed / this.durationSeconds(), 1)
    eventBus.emit('defuseProgress', { mineId: this.targetId, progress })
    if (this.elapsed < this.durationSeconds()) return false

    const mineId = this.targetId
    const success = random() >= this.failureRate()
    this.phase = 'idle'
    this.targetId = undefined
    this.engineerId = undefined

    if (success) {
      this.minefield.defuse(mineId)
      eventBus.emit('defuseCompleted', { mineId, success: true })
    } else {
      eventBus.emit('defuseCompleted', { mineId, success: false })
      eventBus.emit('notify', { text: '排雷失败！', tone: 'warn' })
      this.minefield.trigger(mineId, this.store.alive('player').map((unit) => unit.id))
    }
    return true
  }

  cancel(reason?: string): void {
    if (this.phase === 'idle') return
    const mineId = this.targetId
    this.phase = 'idle'
    this.targetId = undefined
    this.engineerId = undefined
    this.elapsed = 0
    if (mineId) eventBus.emit('defuseCancelled', { mineId })
    if (reason) eventBus.emit('notify', { text: reason, tone: 'info' })
  }

  get isActive(): boolean {
    return this.phase === 'defusing'
  }

  get isBusy(): boolean {
    return this.phase !== 'idle'
  }

  get targetMineId(): MineId | undefined {
    return this.targetId
  }

  get engineer(): UnitId | undefined {
    return this.engineerId
  }

  get phaseName(): DefusePhase {
    return this.phase
  }

  dispose(): void {
    eventBus.off('moveCommand', this.onMoveCommand)
  }

  private beginDefusing(engineerPosition: Vec3, minePosition: Vec3): void {
    if (!this.targetId || !this.engineerId) return
    this.phase = 'defusing'
    this.elapsed = 0
    // Stop exactly here; the engineer must hold still for the whole bar.
    eventBus.emit('moveCommand', {
      unitIds: [this.engineerId],
      position: { x: engineerPosition.x, y: 0, z: engineerPosition.z },
      queue: false,
      forceMine: true,
    })
    eventBus.emit('defuseStarted', {
      mineId: this.targetId,
      engineerId: this.engineerId,
      durationMs: this.durationSeconds() * 1000,
    })
    void minePosition
  }

  private onMoveCommand = (command: { unitIds: UnitId[] }): void => {
    if (this.phase !== 'defusing' || !this.engineerId) return
    // Our own stop command also arrives here; only cancel if it names the engineer
    // and it was clearly a new player order (not the stop-to-current-position call).
    if (command.unitIds.includes(this.engineerId)) {
      const engineer = this.store.get(this.engineerId)
      if (!engineer) return
      const mine = this.targetId ? this.minefield.get(this.targetId) : undefined
      // If the command target is far from the mine it is a player interrupt.
      const target = (command as { position?: Vec3 }).position
      if (target && mine && Math.hypot(target.x - mine.position.x, target.z - mine.position.z) > 2.2) {
        this.cancel('排雷已中断')
      }
    }
  }

  private durationSeconds(): number {
    return this.options.durationSeconds ?? DEFUSE.durationSec
  }

  private failureRate(): number {
    return this.options.failureRate ?? DEFUSE.failRate
  }
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}
