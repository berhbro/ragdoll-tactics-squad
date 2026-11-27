import type { GameStats } from '../Data/Types'

function emptyStats(): GameStats {
  return { elapsedSeconds: 0, misfires: 0, downs: 0, failureReason: '' }
}

export class Stats {
  private stats: GameStats = emptyStats()

  reset(): void {
    this.stats = emptyStats()
  }

  tick(dt: number): void {
    this.stats.elapsedSeconds += dt
  }

  addMisfire(): void {
    this.stats.misfires += 1
  }

  addDown(): void {
    this.stats.downs += 1
  }

  setFailureReason(reason: string): void {
    this.stats.failureReason = reason
  }

  snapshot(): GameStats {
    return { ...this.stats }
  }
}
