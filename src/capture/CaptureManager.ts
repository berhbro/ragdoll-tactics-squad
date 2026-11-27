import { eventBus } from '../core/EventBus'
import { CAPTURE } from '../config/constants'
import type { CaptureProgressPayload, CaptureStatus, Vec3 } from '../Data/Types'

export interface CaptureContext {
  aliveUnitPositions: Vec3[]
  enemiesAliveInZone: number
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

export class CaptureManager {
  private readonly radio: Vec3
  private readonly radius: number
  private readonly required: number
  private progress = 0
  private completed = false

  constructor(
    radio: Vec3,
    radius: number = CAPTURE.radioRadius,
    required: number = CAPTURE.requiredSeconds,
  ) {
    this.radio = radio
    this.radius = radius
    this.required = required
  }

  update(dt: number, ctx: CaptureContext): void {
    if (this.completed) return

    const r2 = this.radius * this.radius
    const inRange = ctx.aliveUnitPositions.some((p) => dist2(p, this.radio) <= r2)
    const enemiesBlocked = ctx.enemiesAliveInZone > 0

    if (inRange && !enemiesBlocked) {
      this.progress = Math.min(this.required, this.progress + dt)
      this.emitProgress(inRange, enemiesBlocked)
      if (this.progress >= this.required) {
        this.completed = true
        eventBus.emit('captureComplete', { elapsedSeconds: 0 })
      }
      return
    }

    if (inRange && enemiesBlocked) {
      this.emitProgress(inRange, enemiesBlocked)
      return
    }

    this.progress = Math.max(0, this.progress - dt)
    this.emitProgress(inRange, enemiesBlocked)
  }

  reset(): void {
    this.progress = 0
    this.completed = false
    this.emitProgress(false, false)
  }

  isCompleted(): boolean {
    return this.completed
  }

  getProgress(): number {
    return this.required > 0 ? this.progress / this.required : 0
  }

  private emitProgress(inRange: boolean, enemiesBlocked: boolean): void {
    let status: CaptureStatus = 'idle'
    if (this.completed) status = 'complete'
    else if (inRange && enemiesBlocked) status = 'paused'
    else if (inRange) status = 'capturing'

    const payload: CaptureProgressPayload = {
      progress: this.required > 0 ? this.progress / this.required : 0,
      requiredSeconds: this.required,
      inRangeAliveUnits: inRange ? 1 : 0,
      status,
    }
    eventBus.emit('captureProgress', payload)
  }
}
