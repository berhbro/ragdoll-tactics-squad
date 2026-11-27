import * as THREE from 'three'
import type { Vec3 } from '../Data/Types'

type RapierModule = typeof import('@dimforge/rapier3d-compat')
type RapierWorld = import('@dimforge/rapier3d-compat').World
type RapierRigidBody = import('@dimforge/rapier3d-compat').RigidBody
type RapierCollider = import('@dimforge/rapier3d-compat').Collider
type RapierCharacterController = import('@dimforge/rapier3d-compat').KinematicCharacterController
type RapierImpulseJoint = import('@dimforge/rapier3d-compat').ImpulseJoint

// Ragdoll parts only collide with static level geometry. Self/ragdoll contacts
// are disabled so connected joints never fight penetration impulses.
const RAGDOLL_COLLISION_GROUPS = (0x0001 << 16) | 0x0002

// Static groups let ragdolls collide with the ground/low cover while ignoring
// tall tree trunks, where limbs would otherwise catch and leave bodies hanging.
export const STATIC_GROUND_GROUPS = (0x0002 << 16) | 0xffff
export const STATIC_TREE_GROUPS = (0x0004 << 16) | 0xffff

export interface PhysicsBodyHandle {
  id: number
  body: RapierRigidBody
  mesh?: THREE.Object3D
  collider?: RapierCollider
}

export interface CharacterHandle {
  id: number
  body: RapierRigidBody
  collider: RapierCollider
  controller: RapierCharacterController
  feet: Vec3
  radius: number
  halfHeight: number
}

interface DynamicHandle extends PhysicsBodyHandle {
  joint?: RapierImpulseJoint
}

/**
 * Thin Rapier wrapper. Gameplay systems never touch Rapier directly; they use
 * character handles, ragdoll bodies and queries exposed here.
 */
export class PhysicsWorld {
  private RAPIER: RapierModule | null = null
  private world: RapierWorld | null = null
  private readonly staticColliders = new Set<RapierCollider>()
  private readonly characterColliders = new Set<RapierCollider>()
  private readonly bodies = new Map<number, DynamicHandle>()
  private readonly characters = new Map<number, CharacterHandle>()
  private gravity: Vec3 = { x: 0, y: -9.81, z: 0 }

  async init(gravity: Vec3 = { x: 0, y: -9.81, z: 0 }): Promise<void> {
    if (this.world) return
    const RAPIER = await import('@dimforge/rapier3d-compat')
    await RAPIER.init()
    this.RAPIER = RAPIER
    this.gravity = gravity
    this.world = new RAPIER.World(gravity)
  }

  isReady(): boolean {
    return this.world !== null
  }

  getWorld(): RapierWorld {
    if (!this.world) throw new Error('PhysicsWorld not initialized. Call init() first.')
    return this.world
  }

  getRapier(): RapierModule {
    if (!this.RAPIER) throw new Error('Rapier not initialized. Call init() first.')
    return this.RAPIER
  }

  step(fixedDt: number): void {
    if (!this.world) return
    this.world.timestep = fixedDt
    this.world.step()
    this.clampRagdollMotion()
  }

  // ---------------------------------------------------------------- statics

  addStaticBox(position: Vec3, halfExtents: Vec3, collisionGroups?: number): PhysicsBodyHandle {
    const RAPIER = this.getRapier()
    const world = this.getWorld()
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    )
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      Math.max(0.01, halfExtents.x),
      Math.max(0.01, halfExtents.y),
      Math.max(0.01, halfExtents.z),
    )
    // Solid level geometry (ground, walls, rocks, radio) is group 2, the only
    // group ragdoll parts accept; tall tree trunks use group 4 instead.
    colliderDesc.setCollisionGroups(collisionGroups ?? STATIC_GROUND_GROUPS)
    const collider = world.createCollider(colliderDesc, body)
    this.staticColliders.add(collider)
    return { id: body.handle, body, collider }
  }

  // ------------------------------------------------------------- characters

  createCharacter(feet: Vec3, radius: number, halfHeight: number): CharacterHandle {
    const RAPIER = this.getRapier()
    const world = this.getWorld()
    const centerY = feet.y + radius + halfHeight
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, centerY, feet.z),
    )
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setFriction(0),
      body,
    )
    const controller = world.createCharacterController(0.02)
    controller.setUp({ x: 0, y: 1, z: 0 })
    controller.setSlideEnabled(true)
    controller.enableAutostep(0.28, 0.2, true)
    controller.enableSnapToGround(0.35)
    controller.setApplyImpulsesToDynamicBodies(true)
    controller.setCharacterMass(70)
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
    controller.setMinSlopeSlideAngle((35 * Math.PI) / 180)

    const handle: CharacterHandle = {
      id: body.handle,
      body,
      collider,
      controller,
      feet: { ...feet },
      radius,
      halfHeight,
    }
    this.characters.set(handle.id, handle)
    this.characterColliders.add(collider)
    return handle
  }

  /** Move a character toward a desired feet position, resolving static/unit collisions. */
  moveCharacter(handle: CharacterHandle, desiredFeet: Vec3): Vec3 {
    const world = this.getWorld()
    const dx = desiredFeet.x - handle.feet.x
    const dz = desiredFeet.z - handle.feet.z
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) {
      this.pushCharacter(handle)
      return { ...handle.feet }
    }

    // Character-vs-character blocking is deliberately filtered out: eight
    // enemies and three squadmates would otherwise wedge each other in narrow
    // gaps. Battle applies a soft separation after movement instead.
    handle.controller.computeColliderMovement(
      handle.collider,
      { x: dx, y: 0, z: dz },
      undefined,
      undefined,
      (collider) => !this.characterColliders.has(collider),
    )
    const moved = handle.controller.computedMovement()
    const feet = {
      x: handle.feet.x + moved.x,
      y: handle.feet.y,
      z: handle.feet.z + moved.z,
    }
    handle.feet = feet
    this.pushCharacter(handle)
    // `world` is referenced to keep the handle alive for future queries.
    void world
    return { ...feet }
  }

  teleportCharacter(handle: CharacterHandle, feet: Vec3): void {
    handle.feet = { ...feet }
    this.pushCharacter(handle)
    handle.body.setTranslation(
      { x: feet.x, y: feet.y + handle.radius + handle.halfHeight, z: feet.z },
      true,
    )
  }

  setCharacterEnabled(handle: CharacterHandle, enabled: boolean): void {
    handle.collider.setEnabled(enabled)
  }

  removeCharacter(handle: CharacterHandle): void {
    if (!this.world) return
    this.characters.delete(handle.id)
    this.characterColliders.delete(handle.collider)
    this.world.removeRigidBody(handle.body)
  }

  // ----------------------------------------------------------- ragdoll parts

  addDynamicBox(position: Vec3, halfExtents: Vec3, mesh: THREE.Object3D, density = 1): DynamicHandle {
    const RAPIER = this.getRapier()
    const world = this.getWorld()
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.12)
        .setAngularDamping(0.5)
        .setCcdEnabled(true),
    )
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
        .setDensity(density)
        .setFriction(0.8)
        .setRestitution(0.05)
        .setCollisionGroups(RAGDOLL_COLLISION_GROUPS),
      body,
    )
    const handle: DynamicHandle = { id: body.handle, body, mesh, collider }
    this.bodies.set(handle.id, handle)
    return handle
  }

  addDynamicCapsule(
    position: Vec3,
    radius: number,
    halfHeight: number,
    mesh: THREE.Object3D,
    density = 1,
  ): DynamicHandle {
    const RAPIER = this.getRapier()
    const world = this.getWorld()
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.12)
        .setAngularDamping(0.5)
        .setCcdEnabled(true),
    )
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setDensity(density)
        .setFriction(0.8)
        .setRestitution(0.05)
        .setCollisionGroups(RAGDOLL_COLLISION_GROUPS),
      body,
    )
    const handle: DynamicHandle = { id: body.handle, body, mesh, collider }
    this.bodies.set(handle.id, handle)
    return handle
  }

  addDynamicSphere(position: Vec3, radius: number, mesh: THREE.Object3D, density = 1): DynamicHandle {
    const RAPIER = this.getRapier()
    const world = this.getWorld()
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.12)
        .setAngularDamping(0.5)
        .setCcdEnabled(true),
    )
    const collider = world.createCollider(
      RAPIER.ColliderDesc.ball(radius)
        .setDensity(density)
        .setFriction(0.8)
        .setRestitution(0.08)
        .setCollisionGroups(RAGDOLL_COLLISION_GROUPS),
      body,
    )
    const handle: DynamicHandle = { id: body.handle, body, mesh, collider }
    this.bodies.set(handle.id, handle)
    return handle
  }

  createSphericalJoint(
    parent: PhysicsBodyHandle,
    child: PhysicsBodyHandle,
    anchorParent: Vec3,
    anchorChild: Vec3,
  ): RapierImpulseJoint {
    const RAPIER = this.getRapier()
    const world = this.getWorld()
    const data = RAPIER.JointData.spherical(anchorParent, anchorChild)
    const joint = world.createImpulseJoint(data, parent.body, child.body, true)
    joint.setContactsEnabled(false)
    const handle = this.bodies.get(child.id)
    if (handle) handle.joint = joint
    return joint
  }

  setBodyRotation(handle: PhysicsBodyHandle, quaternion: { x: number; y: number; z: number; w: number }): void {
    handle.body.setRotation(quaternion, true)
  }

  removeBody(handle: PhysicsBodyHandle): void {
    if (!this.world) return
    const dynamic = this.bodies.get(handle.id)
    if (dynamic?.joint) {
      this.world.removeImpulseJoint(dynamic.joint, true)
      dynamic.joint = undefined
    }
    this.bodies.delete(handle.id)
    this.world.removeRigidBody(handle.body)
  }

  removeJoint(joint: RapierImpulseJoint): void {
    if (!this.world) return
    this.world.removeImpulseJoint(joint, true)
  }

  // -------------------------------------------------------------- queries

  /** True when a static collider blocks the segment between the two points. */
  isLineBlocked(from: Vec3, to: Vec3, ignoreRadius = 0.12): boolean {
    const world = this.getWorld()
    const RAPIER = this.getRapier()
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dz = to.z - from.z
    const distance = Math.hypot(dx, dy, dz)
    if (distance < 1e-5) return false
    const ray = new RAPIER.Ray(
      { x: from.x, y: from.y, z: from.z },
      { x: dx / distance, y: dy / distance, z: dz / distance },
    )
    const hit = world.castRay(
      ray,
      distance,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => this.staticColliders.has(collider),
    )
    return hit !== null && hit.timeOfImpact < distance - ignoreRadius
  }

  applyExplosionImpulse(center: Vec3, radius: number, strength: number): void {
    if (!this.world || radius <= 0 || strength <= 0) return
    for (const handle of this.bodies.values()) {
      if (!handle.body.isDynamic()) continue
      const p = handle.body.translation()
      const dx = p.x - center.x
      const dy = p.y - center.y
      const dz = p.z - center.z
      const distance = Math.hypot(dx, dy, dz)
      if (distance > radius) continue
      const falloff = 1 - distance / radius
      const length = distance > 1e-4 ? distance : 0.001
      // `strength` is a desired velocity (m/s); scale by mass so light ragdoll
      // limbs and heavy torsos get a consistent, readable launch.
      const mass = Math.max(0.0001, handle.body.mass())
      const launch = strength * falloff * mass
      handle.body.applyImpulse(
        {
          x: (dx / length) * launch,
          y: ((dy / length) + 0.65) * launch,
          z: (dz / length) * launch,
        },
        true,
      )
    }
  }

  syncMeshes(): void {
    for (const handle of this.bodies.values()) {
      if (!handle.mesh) continue
      const t = handle.body.translation()
      const r = handle.body.rotation()
      handle.mesh.position.set(t.x, t.y, t.z)
      handle.mesh.quaternion.set(r.x, r.y, r.z, r.w)
    }
  }

  clear(): void {
    if (!this.world) return
    for (const handle of this.characters.values()) {
      this.world.removeRigidBody(handle.body)
    }
    this.characters.clear()
    this.characterColliders.clear()
    for (const handle of this.bodies.values()) {
      if (handle.joint) this.world.removeImpulseJoint(handle.joint, true)
      this.world.removeRigidBody(handle.body)
    }
    this.bodies.clear()
    this.staticColliders.clear()
  }

  dispose(): void {
    if (!this.world) return
    this.clear()
    this.world.free()
    this.world = null
    this.RAPIER = null
  }

  getGravity(): Vec3 {
    return { ...this.gravity }
  }

  private clampRagdollMotion(): void {
    for (const handle of this.bodies.values()) {
      const velocity = handle.body.linvel()
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z)
      if (speed > 14) {
        const scale = 14 / speed
        handle.body.setLinvel({ x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale }, true)
      }
      const angular = handle.body.angvel()
      const spin = Math.hypot(angular.x, angular.y, angular.z)
      if (spin > 18) {
        const scale = 18 / spin
        handle.body.setAngvel({ x: angular.x * scale, y: angular.y * scale, z: angular.z * scale }, true)
      }
    }
  }

  private pushCharacter(handle: CharacterHandle): void {
    handle.body.setNextKinematicTranslation({
      x: handle.feet.x,
      y: handle.feet.y + handle.radius + handle.halfHeight,
      z: handle.feet.z,
    })
  }
}
