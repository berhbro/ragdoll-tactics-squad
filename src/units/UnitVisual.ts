import * as THREE from 'three'
import type { UnitId, UnitKind, Vec3 } from '../Data/Types'
import { Layers } from '../config/layers'

export type VisualRole = UnitKind

export interface UnitVisualConfig {
  unitId: UnitId
  role: VisualRole
  scale?: number | THREE.Vector3
  position?: Vec3
  rotationY?: number
  castShadow?: boolean
  receiveShadow?: boolean
}

/** Presentation-only unit shell. Gameplay state lives in UnitStore. */
export class UnitVisual extends THREE.Group {
  readonly unitId: UnitId
  readonly role: VisualRole
  private readonly content = new THREE.Group()
  private interactionKind: 'attack' | 'defuse' | 'rescue' | undefined

  constructor(unitId: UnitId, role: VisualRole, config: Partial<UnitVisualConfig> = {}) {
    super()
    this.unitId = unitId
    this.role = role
    this.name = `UnitVisual:${unitId}`
    this.layers.enable(Layers.Target)
    this.layers.enable(Layers.Unit)
    this.userData.interactionId = unitId
    this.userData.unitId = unitId
    this.add(this.content)
    if (config.position) this.position.set(config.position.x, config.position.y, config.position.z)
    if (config.rotationY !== undefined) this.rotation.y = config.rotationY
    if (config.scale !== undefined) {
      if (typeof config.scale === 'number') this.scale.setScalar(config.scale)
      else this.scale.copy(config.scale)
    }
  }

  mount(object: THREE.Object3D): void {
    this.content.clear()
    object.rotation.x = Math.PI / 2
    object.position.y = 0
    this.content.add(object)
    object.traverse((child) => {
      child.layers.enable(Layers.Target)
      child.layers.enable(Layers.Unit)
      child.userData.interactionId = this.unitId
      child.userData.unitId = this.unitId
      child.userData.role = this.role
      if (this.interactionKind) child.userData.interactionKind = this.interactionKind
    })
  }

  getObject3D(): THREE.Object3D {
    return this
  }

  get mountedObject(): THREE.Object3D | undefined {
    return this.content.children[0]
  }

  setVisible(visible: boolean): void {
    this.visible = visible
  }

  setTransform(position: Vec3, yaw?: number): void {
    this.position.set(position.x, position.y, position.z)
    if (yaw !== undefined) this.rotation.y = yaw
  }

  setWalking(amount: number, time: number): void {
    this.content.position.y = Math.abs(Math.sin(time * 8)) * 0.045 * amount
    this.content.rotation.z = Math.sin(time * 8) * 0.025 * amount
  }

  getBone(name: string): THREE.Object3D | undefined {
    let found: THREE.Object3D | undefined
    this.content.traverse((object) => {
      if (!found && object.name === name) found = object
    })
    return found
  }

  setInteractionKind(kind: 'attack' | 'defuse' | 'rescue' | undefined): void {
    this.interactionKind = kind
    this.userData.interactionKind = kind
    this.content.traverse((child) => {
      if (kind) child.userData.interactionKind = kind
      else delete child.userData.interactionKind
    })
  }

  dispose(): void {
    this.removeFromParent()
    this.content.clear()
  }
}
