export type PauseListener = (paused: boolean) => void

export class PauseManager {
  private paused = false
  private readonly listeners = new Set<PauseListener>()

  isPaused(): boolean {
    return this.paused
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.notify()
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.notify()
  }

  toggle(): void {
    if (this.paused) this.resume()
    else this.pause()
  }

  onChange(fn: PauseListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.paused)
  }
}
