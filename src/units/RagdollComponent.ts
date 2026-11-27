import * as THREE from 'three'
import type { Team, UnitId, UnitKind, Vec3 } from '../Data/Types'
import { Layers } from '../config/layers'
import type { PhysicsBodyHandle, PhysicsWorld } from '../physics/PhysicsWorld'
import type { UnitVisual } from './UnitVisual'

interface PartSpec {
  name: string
  kind: 'box' | 'sphere' | 'capsule'
  offset: Vec3
  size: Vec3
  radius?: number
  halfHeight?: number
  color: number
  density: number
}

interface Part {
  spec: PartSpec
  body: PhysicsBodyHandle
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
}

const ROLE_COLORS: Record<UnitKind, { uniform: number; accent: number }> = {
  engineer: { uniform: 0x5d6b4d, accent: 0xc9a227 },
  rifleman: { uniform: 0x4f6b50, accent: 0x2d3a2e },
  machinegunner: { uniform: 0x415a4c, accent: 0x28342c },
  enemy: { uniform: 0x7a3f35, accent: 0x2e2320 },
}

/**
 * A small Rapier ragdoll made of seven rigid parts joined by spherical joints.
 * The skinned UnitVisual is hidden while the ragdoll is active; on revive the
 * visual is restored. This keeps the physical comedy while avoiding fragile
 * bone-space conversion for the low-poly GLBs.
 */
export class RagdollComponent {
  readonly unitId: UnitId
  private readonly scene: THREE.Scene
  private readonly physics: PhysicsWorld
  private readonly visual: UnitVisual
  private readonly role: UnitKind
  private readonly team: Team
  private readonly origin: Vec3
  private readonly facing: number
  private readonly parts: Part[] = []
  private readonly jointHandles: import('@dimforge/rapier3d-compat').ImpulseJoint[] = []
  private active = false
  private downed = false

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    visual: UnitVisual,
    role: UnitKind,
    team: Team,
    origin: Vec3,
    facing: number,
  ) {
    this.scene = scene
    this.physics = physics
    this.visual = visual
    this.unitId = visual.unitId
    this.role = role
    this.team = team
    this.origin = { ...origin }
    this.facing = facing
  }

  isActive(): boolean {
    return this.active
  }

  setDowned(downed: boolean): void {
    this.downed = downed
    const torso = this.parts.find((part) => part.spec.name === 'torso')
    if (!torso) return
    if (downed) {
      torso.mesh.layers.enable(Layers.Target)
      torso.mesh.userData.interactionKind = 'rescue'
      torso.mesh.userData.interactionId = this.unitId
    } else {
      torso.mesh.layers.disable(Layers.Target)
      delete torso.mesh.userData.interactionKind
      delete torso.mesh.userData.interactionId
    }
  }

  activate(explosion?: { center: Vec3; strength: number }): void {
    if (this.active) return
    this.active = true
    this.visual.setVisible(false)
    this.buildParts()
    this.setDowned(this.downed)

    const torso = this.parts.find((part) => part.spec.name === 'torso')
    if (torso) {
      const mass = Math.max(0.0001, torso.body.body.mass())
      torso.body.body.applyImpulse(
        { x: (Math.random() - 0.5) * 0.5 * mass, y: 0.35 * mass, z: (Math.random() - 0.5) * 0.5 * mass },
        true,
      )
    }

    if (explosion) {
      this.physics.applyExplosionImpulse(explosion.center, 2.6, explosion.strength)
    }
  }

  /** Re-seat a corpse that got caught on geometry, without rebuilding meshes. */
  resetToGround(): void {
    if (!this.active) return
    const cos = Math.cos(this.facing)
    const sin = Math.sin(this.facing)
    for (const part of this.parts) {
      const world = {
        x: this.origin.x + part.spec.offset.x * cos + part.spec.offset.z * sin,
        y: this.origin.y + part.spec.offset.y,
        z: this.origin.z - part.spec.offset.x * sin + part.spec.offset.z * cos,
      }
      part.body.body.setTranslation(world, true)
      part.body.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
      part.body.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      part.body.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
  }

  getCenter(): Vec3 {
    const torso = this.parts.find((part) => part.spec.name === 'torso')
    if (!torso) return { ...this.origin }
    const p = torso.body.body.translation()
    return { x: p.x, y: p.y, z: p.z }
  }

  dispose(): void {
    this.jointHandles.length = 0
    for (const part of this.parts) {
      this.physics.removeBody(part.body)
      part.mesh.removeFromParent()
      part.material.dispose()
      part.mesh.geometry.dispose()
    }
    this.parts.length = 0
    this.visual.setVisible(false)
    this.active = false
  }

  private buildParts(): void {
    const base = ROLE_COLORS[this.role]
    const colors = this.team === 'player'
      ? base
      : { uniform: base.uniform, accent: 0x3b2823 }
    const specs = this.makeSpecs(colors)
    const cos = Math.cos(this.facing)
    const sin = Math.sin(this.facing)

    for (const spec of specs) {
      const world = {
        x: this.origin.x + spec.offset.x * cos + spec.offset.z * sin,
        y: this.origin.y + spec.offset.y,
        z: this.origin.z - spec.offset.x * sin + spec.offset.z * cos,
      }
      const material = new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: 0.85,
        metalness: 0.05,
      })
      const geometry = this.geometryFor(spec)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.layers.enable(Layers.Unit)
      mesh.userData.unitId = this.unitId
      this.scene.add(mesh)

      let body: PhysicsBodyHandle
      if (spec.kind === 'box') {
        body = this.physics.addDynamicBox(world, spec.size, mesh, spec.density)
      } else if (spec.kind === 'sphere') {
        body = this.physics.addDynamicSphere(world, spec.radius ?? 0.16, mesh, spec.density)
      } else {
        body = this.physics.addDynamicCapsule(
          world,
          spec.radius ?? 0.08,
          spec.halfHeight ?? 0.2,
          mesh,
          spec.density,
        )
      }
      this.parts.push({ spec, body, mesh, material })
    }

    // Anchors below are the exact same world point on both bodies; mismatched
    // anchors make Rapier joints inject huge corrective velocities.
    this.connect('torso', 'pelvis', { x: 0, y: -0.26, z: 0 }, { x: 0, y: 0.06, z: 0 })
    this.connect('torso', 'head', { x: 0, y: 0.32, z: 0 }, { x: 0, y: -0.17, z: 0 })
    this.connect('torso', 'armL', { x: -0.29, y: 0.1, z: 0 }, { x: 0.05, y: 0, z: 0 })
    this.connect('torso', 'armR', { x: 0.29, y: 0.1, z: 0 }, { x: -0.05, y: 0, z: 0 })
    this.connect('pelvis', 'legL', { x: -0.13, y: -0.09, z: 0 }, { x: 0, y: 0.23, z: 0 })
    this.connect('pelvis', 'legR', { x: 0.13, y: -0.09, z: 0 }, { x: 0, y: 0.23, z: 0 })
  }

  private connect(
    parentName: string,
    childName: string,
    anchorParent: Vec3,
    anchorChild: Vec3,
  ): void {
    const parent = this.parts.find((part) => part.spec.name === parentName)
    const child = this.parts.find((part) => part.spec.name === childName)
    if (!parent || !child) return
    this.jointHandles.push(
      this.physics.createSphericalJoint(parent.body, child.body, anchorParent, anchorChild),
    )
  }

  private makeSpecs(colors: { uniform: number; accent: number }): PartSpec[] {
    return [
      {
        name: 'torso', kind: 'box', offset: { x: 0, y: 1.06, z: 0 },
        size: { x: 0.24, y: 0.31, z: 0.16 }, color: colors.uniform, density: 1.1,
      },
      {
        name: 'pelvis', kind: 'box', offset: { x: 0, y: 0.74, z: 0 },
        size: { x: 0.18, y: 0.12, z: 0.14 }, color: colors.accent, density: 1.2,
      },
      {
        name: 'head', kind: 'sphere', offset: { x: 0, y: 1.55, z: 0 },
        size: { x: 0, y: 0, z: 0 }, radius: 0.16, color: 0xc9a27a, density: 0.9,
      },
      {
        name: 'armL', kind: 'capsule', offset: { x: -0.34, y: 1.16, z: 0 },
        size: { x: 0, y: 0, z: 0 }, radius: 0.065, halfHeight: 0.2, color: colors.uniform, density: 0.7,
      },
      {
        name: 'armR', kind: 'capsule', offset: { x: 0.34, y: 1.16, z: 0 },
        size: { x: 0, y: 0, z: 0 }, radius: 0.065, halfHeight: 0.2, color: colors.uniform, density: 0.7,
      },
      {
        name: 'legL', kind: 'capsule', offset: { x: -0.13, y: 0.42, z: 0 },
        size: { x: 0, y: 0, z: 0 }, radius: 0.085, halfHeight: 0.25, color: colors.accent, density: 1,
      },
      {
        name: 'legR', kind: 'capsule', offset: { x: 0.13, y: 0.42, z: 0 },
        size: { x: 0, y: 0, z: 0 }, radius: 0.085, halfHeight: 0.25, color: colors.accent, density: 1,
      },
    ]
  }

  private geometryFor(spec: PartSpec): THREE.BufferGeometry {
    if (spec.kind === 'box') {
      return new THREE.BoxGeometry(spec.size.x * 2, spec.size.y * 2, spec.size.z * 2)
    }
    if (spec.kind === 'sphere') {
      return new THREE.SphereGeometry(spec.radius ?? 0.16, 10, 8)
    }
    return new THREE.CapsuleGeometry(spec.radius ?? 0.08, (spec.halfHeight ?? 0.2) * 2, 4, 8)
  }
}
