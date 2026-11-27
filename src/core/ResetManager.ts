export type ResetHandler = () => void

export class ResetManager {
  private readonly handlers = new Set<ResetHandler>()

  onReset(fn: ResetHandler): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }

  reset(): void {
    for (const fn of this.handlers) {
      try {
        fn()
      } catch (err) {
        console.error('[ResetManager] handler error', err)
      }
    }
  }
}
