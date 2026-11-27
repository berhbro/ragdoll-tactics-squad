import * as THREE from 'three'
import type { InputManager } from '../input/InputManager'
import { CAMERA } from '../config/constants'
import type { Vec3 } from '../Data/Types'

const DEG2RAD = Math.PI / 180

function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * Math.max(0, dt))
}

function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

/** Dynamic-pitch tactical camera with damped follow. No occlusion pull-in. */
export class TacticalCamera {
  private readonly camera: THREE.PerspectiveCamera
  private readonly input: InputManager

  private readonly target = new THREE.Vector3(0, 0, 0)
  private readonly desiredTarget = new THREE.Vector3(0, 0, 0)
  private readonly rayDir = new THREE.Vector3()
  private readonly desiredCameraPos = new THREE.Vector3()
  private readonly shakeOffset = new THREE.Vector3()

  private targetDistance = 18
  private distance = 18
  private yaw = 0
  private yawTarget = 0
  private enabled = true
  private shake = 0
  private clock = 0

  constructor(camera: THREE.PerspectiveCamera, input: InputManager) {
    this.camera = camera
    this.input = input
    this.input.on('zoom', this.onZoom)
    this.input.on('rotate', this.onRotate)
    this.update(0)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  setTarget(pos: Vec3): void {
    this.desiredTarget.set(pos.x, pos.y, pos.z)
  }

  setTargetImmediate(pos: Vec3): void {
    this.desiredTarget.set(pos.x, pos.y, pos.z)
    this.target.copy(this.desiredTarget)
    this.update(0, true)
  }

  setDistance(distance: number): void {
    this.targetDistance = THREE.MathUtils.clamp(distance, CAMERA.minDistance, CAMERA.maxDistance)
    this.distance = THREE.MathUtils.clamp(distance, CAMERA.minDistance, CAMERA.maxDistance)
  }

  setYaw(yaw: number): void {
    this.yaw = yaw
    this.yawTarget = yaw
  }

  getDistance(): number {
    return this.distance
  }

  getYaw(): number {
    return this.yaw
  }

  getPitchDegrees(): number {
    return this.pitchForDistance(this.distance) / DEG2RAD
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

  addShake(strength: number): void {
    this.shake = Math.min(1.2, this.shake + Math.max(0, strength))
  }

  screenToGround(ndcX: number, ndcY: number, planeY = 0): Vec3 | null {
    this.camera.updateMatrixWorld()
    const origin = this.camera.position
    const dir = new THREE.Vector3(ndcX, ndcY, 0.5)
      .unproject(this.camera)
      .sub(origin)
      .normalize()
    if (Math.abs(dir.y) < 1e-6) return null
    const t = (planeY - origin.y) / dir.y
    if (t < 0) return null
    return {
      x: origin.x + dir.x * t,
      y: planeY,
      z: origin.z + dir.z * t,
    }
  }

  update(dt: number, snap = false): void {
    this.clock += dt
    const follow = snap ? 1 : damp(CAMERA.followLerp, dt)
    this.target.lerp(this.desiredTarget, follow)
    this.distance += (this.targetDistance - this.distance) * (snap ? 1 : damp(CAMERA.zoomLerp, dt))

    const delta = angleDelta(this.yaw, this.yawTarget)
    this.yaw += delta * (snap ? 1 : damp(CAMERA.yawLerp, dt))
    if (Math.abs(delta) < 1e-5) this.yaw = this.yawTarget

    const pitch = this.pitchForDistance(this.distance)
    const cosP = Math.cos(pitch)
    const sinP = Math.sin(pitch)
    this.rayDir
      .set(Math.sin(this.yaw) * cosP, sinP, Math.cos(this.yaw) * cosP)
      .normalize()

    // Deliberately no terrain raycast here. In a top-down forest, pulling the
    // camera in when a leaf cone crosses the ray results in an unusable
    // face-level close-up. The camera always respects the requested distance.
    this.desiredCameraPos.set(
      this.target.x + this.rayDir.x * this.distance,
      this.target.y + this.rayDir.y * this.distance,
      this.target.z + this.rayDir.z * this.distance,
    )

    this.shake = Math.max(0, this.shake - dt * 1.8)
    if (this.shake > 0.001) {
      const t = this.clock * 55
      this.shakeOffset.set(
        Math.sin(t) * this.shake * 0.16,
        Math.cos(t * 1.7) * this.shake * 0.12,
        Math.sin(t * 0.6) * this.shake * 0.16,
      )
    } else {
      this.shakeOffset.set(0, 0, 0)
    }

    this.camera.position.copy(this.desiredCameraPos).add(this.shakeOffset)
    this.camera.lookAt(this.target)
    this.camera.updateMatrixWorld()
  }

  dispose(): void {
    this.input.off('zoom', this.onZoom)
    this.input.off('rotate', this.onRotate)
  }

  private pitchForDistance(distance: number): number {
    const t = THREE.MathUtils.clamp(
      (distance - CAMERA.minDistance) / (CAMERA.maxDistance - CAMERA.minDistance),
      0,
      1,
    )
    const deg = CAMERA.minPitch + t * (CAMERA.maxPitch - CAMERA.minPitch)
    return deg * DEG2RAD
  }

  private onZoom = (payload: { delta: number }): void => {
    if (!this.enabled) return
    this.targetDistance = THREE.MathUtils.clamp(
      this.targetDistance + payload.delta * 0.012,
      CAMERA.minDistance,
      CAMERA.maxDistance,
    )
  }

  private onRotate = (payload: { delta: number }): void => {
    if (!this.enabled) return
    if (Math.abs(payload.delta) === 1) {
      this.yawTarget += payload.delta * 6 * DEG2RAD
    } else {
      const delta = payload.delta * 0.005
      this.yaw += delta
      this.yawTarget = this.yaw
    }
  }
}
