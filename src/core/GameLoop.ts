export type UpdateFn = (dt: number) => void
export type FixedUpdateFn = (fixedDt: number) => void
export type RenderFn = (alpha: number) => void

export interface GameLoopOptions {
  fixedDt?: number
  maxFrameDelta?: number
  maxSubSteps?: number
}

export class GameLoop {
  private readonly fixedDt: number
  private readonly maxFrameDelta: number
  private readonly maxSubSteps: number

  private accumulator = 0
  private lastTime = 0
  private running = false
  private rafId = 0

  constructor(
    private readonly update: UpdateFn,
    private readonly fixedUpdate: FixedUpdateFn,
    private readonly render: RenderFn,
    options: GameLoopOptions = {},
  ) {
    this.fixedDt = options.fixedDt ?? 1 / 60
    this.maxFrameDelta = options.maxFrameDelta ?? 0.1
    this.maxSubSteps = options.maxSubSteps ?? 5
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now() / 1000
    this.accumulator = 0
    this.rafId = requestAnimationFrame(this.tick)
  }

  stop(): void {
    this.running = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  isRunning(): boolean {
    return this.running
  }

  private tick = (nowMs: number): void => {
    if (!this.running) return
    const now = nowMs / 1000
    let frameDelta = now - this.lastTime
    this.lastTime = now

    if (frameDelta > this.maxFrameDelta) frameDelta = this.maxFrameDelta
    if (frameDelta < 0) frameDelta = 0

    this.update(frameDelta)

    this.accumulator += frameDelta
    let steps = 0
    while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
      this.fixedUpdate(this.fixedDt)
      this.accumulator -= this.fixedDt
      steps += 1
    }

    const alpha = this.fixedDt > 0 ? this.accumulator / this.fixedDt : 0
    this.render(alpha)

    this.rafId = requestAnimationFrame(this.tick)
  }
}
