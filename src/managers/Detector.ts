import type { DetectorAPI } from './Interfaces'
import type { MineId, UnitId, Vec3 } from '../Data/Types'
import { eventBus } from '../core/EventBus'
import { DETECTOR } from '../config/constants'
import { MinefieldManager, type Mine } from './MinefieldManager'

export interface DetectorOptions {
  range?: number
  halfAngleRadians?: number
  onDetected?: (mine: Mine) => void
}

/** Engineer-only forward-cone detector. Reveals mines and drives beep feedback. */
export class Detector implements DetectorAPI {
  private readonly range: number
  private readonly halfAngleRadians: number
  private readonly onDetected?: (mine: Mine) => void
  private readonly transforms = new Map<UnitId, { origin: Vec3; forward: Vec3 }>()
  private readonly ahead = new Map<UnitId, { mineId: MineId; position: Vec3; distance: number } | null>()
  private readonly beeping = new Set<UnitId>()
  private readonly beepTimer = new Map<UnitId, number>()
  private readonly lastMineByEngineer = new Map<UnitId, MineId | undefined>()
  private enabled = true

  constructor(
    private readonly minefield: MinefieldManager,
    options: DetectorOptions = {},
  ) {
    this.range = options.range ?? DETECTOR.range
    this.halfAngleRadians = options.halfAngleRadians ?? (DETECTOR.angleDeg * Math.PI) / 360
    this.onDetected = options.onDetected
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.ahead.clear()
      this.beeping.clear()
      this.beepTimer.clear()
    }
  }

  setEngineerTransform(engineerId: UnitId, origin: Vec3, forward: Vec3): void {
    this.transforms.set(engineerId, { origin: { ...origin }, forward: { ...forward } })
  }

  update(dt: number, engineerId: UnitId): void {
    if (!this.enabled) return
    const transform = this.transforms.get(engineerId)
    if (!transform) {
      this.clear(engineerId)
      return
    }

    const mine = this.minefield.detect(
      transform.origin,
      transform.forward,
      this.range,
      this.halfAngleRadians,
    )
    if (!mine) {
      this.clear(engineerId)
      eventBus.emit('minePulse', { intensity: 0 })
      return
    }

    const distance = distanceBetween(transform.origin, mine.position)
    this.ahead.set(engineerId, { mineId: mine.id, position: { ...mine.position }, distance })
    this.beeping.add(engineerId)
    const previousId = this.lastMineByEngineer.get(engineerId)
    if (previousId !== mine.id) {
      this.lastMineByEngineer.set(engineerId, mine.id)
      this.minefield.reveal(mine.id)
      this.onDetected?.(mine)
    }

    const intensity = Math.max(0, Math.min(1, 1 - distance / this.range))
    eventBus.emit('minePulse', { intensity })

    const interval = DETECTOR.beepIntervalFar
      + (DETECTOR.beepIntervalNear - DETECTOR.beepIntervalFar) * intensity
    const elapsed = (this.beepTimer.get(engineerId) ?? 0) + Math.max(0, dt)
    if (elapsed >= interval) {
      this.beepTimer.set(engineerId, 0)
      eventBus.emit('audioPlay', { sfx: 'detectorBeep', volume: 0.16 + intensity * 0.3 })
    } else {
      this.beepTimer.set(engineerId, elapsed)
    }
  }

  getMineAhead(engineerId: UnitId): { mineId: MineId; position: Vec3; distance: number } | null {
    return this.ahead.get(engineerId) ?? null
  }

  isBeeping(engineerId: UnitId): boolean {
    return this.beeping.has(engineerId)
  }

  private clear(engineerId: UnitId): void {
    this.ahead.set(engineerId, null)
    this.beeping.delete(engineerId)
    this.beepTimer.delete(engineerId)
    this.lastMineByEngineer.set(engineerId, undefined)
  }
}

function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}
