import { eventBus } from './EventBus'
import type { GamePhase } from '../Data/Types'

/** Authoritative game phase. UI and input react to gameStateChanged events. */
export class GameState {
  private phase: GamePhase = 'menu'

  getPhase(): GamePhase {
    return this.phase
  }

  setPhase(phase: GamePhase): void {
    if (this.phase === phase) return
    this.phase = phase
    eventBus.emit('gameStateChanged', { state: phase })
  }

  isPlaying(): boolean {
    return this.phase === 'playing' || this.phase === 'demo'
  }

  isPaused(): boolean {
    return this.phase === 'paused'
  }

  isOver(): boolean {
    return this.phase === 'won' || this.phase === 'lost'
  }

  isDemo(): boolean {
    return this.phase === 'demo'
  }

  reset(): void {
    this.setPhase('menu')
  }
}
