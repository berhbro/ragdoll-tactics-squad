export type InputEventMap = {
  selectStart: { x: number; y: number; queue: boolean }
  selectMove: { x: number; y: number; startX: number; startY: number; dragging: boolean }
  selectEnd: { x: number; y: number; isDrag: boolean; queue: boolean }
  moveTo: { x: number; y: number; queue: boolean }
  quickSelect: { slot: 1 | 2 | 3 }
  stopAll: undefined
  interact: undefined
  muteToggle: undefined
  pauseToggle: undefined
  zoom: { delta: number }
  rotate: { delta: number }
}

export type InputEventName = keyof InputEventMap

type AnyHandler = (payload: unknown) => void
type Handler<K extends InputEventName> = (payload: InputEventMap[K]) => void

export class InputManager {
  private enabled = false
  private disposed = false
  private handlers = new Map<InputEventName, Set<AnyHandler>>()

  private leftDown = false
  private middleDown = false
  private dragStartX = 0
  private dragStartY = 0
  private lastMiddleX = 0

  private readonly element: HTMLElement

  constructor(element: HTMLElement) {
    this.element = element
    this.bindListeners()
  }

  enable(): void {
    this.enabled = true
  }

  disable(): void {
    this.enabled = false
    this.releaseInputs()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  on<K extends InputEventName>(name: K, fn: Handler<K>): void {
    let set = this.handlers.get(name)
    if (!set) {
      set = new Set()
      this.handlers.set(name, set)
    }
    set.add(fn as AnyHandler)
  }

  off<K extends InputEventName>(name: K, fn: Handler<K>): void {
    this.handlers.get(name)?.delete(fn as AnyHandler)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.releaseInputs()
    this.handlers.clear()
    const el = this.element
    const win = window
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointermove', this.onPointerMove)
    win.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('wheel', this.onWheel)
    win.removeEventListener('contextmenu', this.onContextMenu)
    win.removeEventListener('keydown', this.onKeyDown)
    win.removeEventListener('blur', this.releaseInputs)
  }

  private fire<K extends InputEventName>(name: K, payload: InputEventMap[K]): void {
    if (!this.enabled || this.disposed) return
    const set = this.handlers.get(name)
    if (!set || set.size === 0) return
    for (const fn of Array.from(set)) {
      try {
        ;(fn as Handler<K>)(payload)
      } catch (err) {
        console.error(`[InputManager] handler error for "${name}"`, err)
      }
    }
  }

  private bindListeners(): void {
    this.element.addEventListener('pointerdown', this.onPointerDown)
    this.element.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    this.element.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('blur', this.releaseInputs)
  }

  private releaseInputs = (): void => {
    this.leftDown = false
    this.middleDown = false
  }

  private onContextMenu = (e: MouseEvent): void => {
    if (!this.enabled) return
    e.preventDefault()
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return
    if (e.button === 0) {
      this.leftDown = true
      this.dragStartX = e.clientX
      this.dragStartY = e.clientY
      this.fire('selectStart', {
        x: e.clientX,
        y: e.clientY,
        queue: e.altKey || e.shiftKey,
      })
    } else if (e.button === 2) {
      e.preventDefault()
      this.fire('moveTo', {
        x: e.clientX,
        y: e.clientY,
        queue: e.altKey || e.shiftKey,
      })
    } else if (e.button === 1) {
      e.preventDefault()
      this.middleDown = true
      this.lastMiddleX = e.clientX
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return
    if (this.middleDown) {
      const dx = e.clientX - this.lastMiddleX
      this.lastMiddleX = e.clientX
      if (dx !== 0) this.fire('rotate', { delta: dx })
    }
    if (this.leftDown) {
      const distance = Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY)
      this.fire('selectMove', {
        x: e.clientX,
        y: e.clientY,
        startX: this.dragStartX,
        startY: this.dragStartY,
        dragging: distance > 6,
      })
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.enabled) return
    if (e.button === 0 && this.leftDown) {
      this.leftDown = false
      const dx = e.clientX - this.dragStartX
      const dy = e.clientY - this.dragStartY
      const isDrag = Math.hypot(dx, dy) > 6
      this.fire('selectEnd', {
        x: e.clientX,
        y: e.clientY,
        isDrag,
        queue: e.altKey || e.shiftKey,
      })
    } else if (e.button === 1) {
      this.middleDown = false
    }
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return
    e.preventDefault()
    this.fire('zoom', { delta: e.deltaY })
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return
    switch (e.key) {
      case '1':
        this.fire('quickSelect', { slot: 1 })
        break
      case '2':
        this.fire('quickSelect', { slot: 2 })
        break
      case '3':
        this.fire('quickSelect', { slot: 3 })
        break
      case ' ':
        if (e.repeat) break
        e.preventDefault()
        this.fire('stopAll', undefined)
        break
      case 'f':
      case 'F':
        if (e.repeat) break
        this.fire('interact', undefined)
        break
      case 'm':
      case 'M':
        if (e.repeat) break
        this.fire('muteToggle', undefined)
        break
      case 'Escape':
        if (e.repeat) break
        e.preventDefault()
        this.fire('pauseToggle', undefined)
        break
      case 'q':
      case 'Q':
        this.fire('rotate', { delta: -1 })
        break
      case 'e':
      case 'E':
        this.fire('rotate', { delta: 1 })
        break
      default:
        break
    }
  }
}
