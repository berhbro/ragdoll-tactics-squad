import type {
  // DemoAction,
  DemoActionWithTime,
  DemoScript,
  GamePhase,
  Vec3,
} from '../Data/Types'

export type DemoPlayerStatus = 'idle' | 'playing' | 'completed' | 'stopped'

export interface DemoCommandContext {
  select?(unitIds: string[]): void
  move?(unitIds: string[], position: Vec3, queued: boolean): void
  interact?(targetType: 'enemy' | 'downedAlly' | 'mine', targetId: string): void
  capture?(): void
  end?(result: 'win' | 'lose'): void
  wait?(milliseconds: number): void
}

export interface DemoPlayerOptions {
  /** Called when the player starts or stops so the host can disable input. */
  onInputEnabledChange?: (enabled: boolean) => void
  /** Called for UI narration, subtitles, or debug logging. */
  onAction?: (action: DemoActionWithTime, index: number) => void
  onStatusChange?: (status: DemoPlayerStatus) => void
  onComplete?: (result: 'win' | 'lose') => void
  commandContext?: DemoCommandContext
}

/**
 * Deterministic, data-driven demo runner.
 *
 * The runner intentionally does not own game entities. It dispatches commands
 * to the host game's Squad/Interaction/Capture systems, so Demo uses the same
 * gameplay path as a human player. Times are expressed in seconds in JSON.
 */
export class DemoPlayer {
  private actions: DemoActionWithTime[] = []
  private nextActionIndex = 0
  private elapsedSeconds = 0
  private status: DemoPlayerStatus = 'idle'
  private result: 'win' | 'lose' | null = null
  private readonly options: DemoPlayerOptions

  constructor(options: DemoPlayerOptions = {}) {
    this.options = options
  }

  load(scriptOrActions: DemoScript | DemoActionWithTime[]): void {
    const actions = Array.isArray(scriptOrActions)
      ? scriptOrActions
      : scriptOrActions.actions

    this.actions = actions
      .map((item) => ({ t: Math.max(0, item.t), action: item.action }))
      .sort((a, b) => a.t - b.t)
    this.reset()
  }

  play(): void {
    if (this.actions.length === 0 || this.status === 'playing') return
    if (this.status === 'completed' || this.status === 'stopped') this.reset()
    this.status = 'playing'
    this.options.onInputEnabledChange?.(false)
    this.options.onStatusChange?.(this.status)
  }

  start(): void {
    this.play()
  }

  stop(): void {
    if (this.status !== 'playing') return
    this.status = 'stopped'
    this.options.onInputEnabledChange?.(true)
    this.options.onStatusChange?.(this.status)
  }

  reset(): void {
    this.nextActionIndex = 0
    this.elapsedSeconds = 0
    this.result = null
    this.status = 'idle'
    this.options.onStatusChange?.(this.status)
  }

  update(dt: number): void {
    if (this.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return
    this.elapsedSeconds += dt

    while (
      this.nextActionIndex < this.actions.length &&
      this.actions[this.nextActionIndex].t <= this.elapsedSeconds
    ) {
      const index = this.nextActionIndex
      const action = this.actions[index]
      this.nextActionIndex += 1
      this.dispatch(action, index)
      if (this.status !== 'playing') return
    }

    if (this.nextActionIndex >= this.actions.length) this.finish(this.result ?? 'win')
  }

  getStatus(): DemoPlayerStatus {
    return this.status
  }

  getElapsedSeconds(): number {
    return this.elapsedSeconds
  }

  isPlaying(): boolean {
    return this.status === 'playing'
  }

  getPhase(): GamePhase {
    return this.status === 'playing' ? 'demo' : 'menu'
  }

  private dispatch(item: DemoActionWithTime, index: number): void {
    this.options.onAction?.(item, index)
    const action = item.action
    const context = this.options.commandContext

    switch (action.type) {
      case 'select':
        context?.select?.(action.unitIds)
        break
      case 'move':
        context?.move?.(action.unitIds, action.position, false)
        break
      case 'queueMove':
        context?.move?.(action.unitIds, action.position, true)
        break
      case 'interact':
        context?.interact?.(action.targetType, action.targetId)
        break
      case 'wait':
        context?.wait?.(action.ms)
        break
      case 'capture':
        context?.capture?.()
        break
      case 'end':
        this.finish(action.result)
        break
    }
  }

  private finish(result: 'win' | 'lose'): void {
    if (this.status !== 'playing') return
    this.result = result
    this.status = 'completed'
    this.options.onInputEnabledChange?.(true)
    this.options.onStatusChange?.(this.status)
    this.options.onComplete?.(result)
  }
}

export default DemoPlayer
