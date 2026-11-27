import * as THREE from 'three'
import type { SquadManager } from '../managers/SquadManager'
import type { UnitVisual } from '../units/UnitVisual'

/** Left-click selection and drag-box selection for the player squad. */
export class SelectionSystem {
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLElement,
    private readonly squad: SquadManager,
    private readonly visuals: Map<string, UnitVisual>,
  ) {}

  handleClick(clientX: number, clientY: number, additive = false): void {
    const rect = this.canvas.getBoundingClientRect()
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.ndc, this.camera)

    const objects = Array.from(this.visuals.values())
    const hits = this.raycaster.intersectObjects(objects, true)

    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object
      while (node && !node.userData.unitId) node = node.parent
      const unitId = node?.userData.unitId as string | undefined
      if (!unitId) continue
      const unit = this.squad.getUnit(unitId)
      if (!unit || unit.state !== 'alive') continue
      if (additive) {
        const current = this.squad.getSelectedIds()
        this.squad.select(
          current.includes(unitId) ? current.filter((id) => id !== unitId) : [...current, unitId],
        )
      } else {
        this.squad.select([unitId])
      }
      return
    }

    if (!additive) this.squad.select([])
  }

  handleBox(x1: number, y1: number, x2: number, y2: number, additive = false): void {
    const minX = Math.min(x1, x2)
    const maxX = Math.max(x1, x2)
    const minY = Math.min(y1, y2)
    const maxY = Math.max(y1, y2)
    const rect = this.canvas.getBoundingClientRect()
    const picked: string[] = []

    for (const [id, visual] of this.visuals) {
      const unit = this.squad.getUnit(id)
      if (!unit || unit.state !== 'alive') continue
      visual.getWorldPosition(this.tmp)
      this.tmp.y += 1
      this.tmp.project(this.camera)
      const sx = ((this.tmp.x + 1) / 2) * rect.width + rect.left
      const sy = ((1 - this.tmp.y) / 2) * rect.height + rect.top
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) picked.push(id)
    }

    if (additive) {
      const merged = new Set([...this.squad.getSelectedIds(), ...picked])
      this.squad.select(Array.from(merged))
    } else {
      this.squad.select(picked)
    }
  }

  private readonly tmp = new THREE.Vector3()
}
