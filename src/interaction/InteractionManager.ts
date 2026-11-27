import * as THREE from 'three'
import type { InputManager } from '../input/InputManager'
import { Layers } from '../config/layers'
import { INPUT } from '../config/constants'
import { eventBus } from '../core/EventBus'
import type { HoverInfo, InteractionKind, InteractionTargetType } from '../Data/Types'

export interface HoverTarget {
  kind: InteractionKind
  id: string
  object: THREE.Object3D
  distance: number
}

const PRIORITY: Record<InteractionKind, number> = {
  attack: 0,
  rescue: 1,
  defuse: 2,
}

const TARGET_TYPE: Record<InteractionKind, InteractionTargetType> = {
  attack: 'enemy',
  rescue: 'downedAlly',
  defuse: 'mine',
}

/** Mouse ray picking for F interactions. Emits hoverChanged/interactionRequested. */
export class InteractionManager {
  private readonly scene: THREE.Scene
  private readonly camera: THREE.Camera
  private readonly input: InputManager
  private readonly element: HTMLElement
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2(0, 0)
  private hovered: HoverTarget | null = null
  private lastHoverKey = ''
  private frame = 0
  private lastInteractFrame = -1

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    input: InputManager,
    element: HTMLElement,
  ) {
    this.scene = scene
    this.camera = camera
    this.input = input
    this.element = element
    this.raycaster.layers.set(Layers.Target)
    this.raycaster.layers.enable(Layers.Terrain)
    this.input.on('interact', this.onInteract)
    this.element.addEventListener('pointermove', this.onPointerMove)
  }

  getHovered(): HoverTarget | null {
    return this.hovered
  }

  update(_dt: number): void {
    if (!this.input.isEnabled()) {
      this.setHovered(null)
      return
    }
    if (this.frame++ % INPUT.raycastIntervalFrames !== 0) return

    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster
      .intersectObjects(this.scene.children, true)
      .sort((a, b) => a.distance - b.distance)

    let best: HoverTarget | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const hit of hits) {
      if (!isVisible(hit.object)) continue
      // Only targets in front of the first terrain hit are interactable.
      if (hit.object.layers.isEnabled(Layers.Terrain)) break
      const kind = hit.object.userData.interactionKind as InteractionKind | undefined
      const id = hit.object.userData.interactionId as string | undefined
      if (!kind || !id || !(kind in PRIORITY)) continue
      const score = hit.distance + PRIORITY[kind] * 0.25
      if (score < bestScore) {
        bestScore = score
        best = { kind, id, object: hit.object, distance: hit.distance }
      }
    }
    this.setHovered(best)
  }

  clear(): void {
    this.setHovered(null)
  }

  dispose(): void {
    this.input.off('interact', this.onInteract)
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.setHovered(null)
  }

  private setHovered(target: HoverTarget | null): void {
    const key = target ? `${target.kind}:${target.id}` : ''
    if (key === this.lastHoverKey) return
    this.lastHoverKey = key
    this.hovered = target
    const payload: HoverInfo | null = target
      ? {
          kind: target.kind,
          targetType: TARGET_TYPE[target.kind],
          id: target.id,
          distance: target.distance,
        }
      : null
    eventBus.emit('hoverChanged', { target: payload })
  }

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  }

  private onInteract = (): void => {
    if (this.lastInteractFrame === this.frame) return
    this.lastInteractFrame = this.frame
    if (!this.hovered) return
    eventBus.emit('interactionRequested', {
      kind: this.hovered.kind,
      targetId: this.hovered.id,
    })
  }
}

function isVisible(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object
  while (node) {
    if (!node.visible) return false
    node = node.parent
  }
  return true
}
