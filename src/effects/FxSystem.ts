import * as THREE from 'three'
import type { Vec3 } from '../Data/Types'

interface Tracer {
  line: THREE.Line
  material: THREE.LineBasicMaterial
  life: number
  maxLife: number
}

interface Burst {
  mesh: THREE.Mesh
  material: THREE.Material
  life: number
  maxLife: number
  velocity: THREE.Vector3
  gravity: number
}

interface Marker {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  life: number
  maxLife: number
}

/** Lightweight transient combat visuals: tracers, explosions, move markers. */
export class FxSystem {
  private readonly group = new THREE.Group()
  private readonly tracers: Tracer[] = []
  private readonly bursts: Burst[] = []
  private readonly markers: Marker[] = []

  constructor(scene: THREE.Scene) {
    this.group.name = 'Fx'
    scene.add(this.group)
  }

  shot(from: Vec3, to: Vec3): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ])
    const material = new THREE.LineBasicMaterial({
      color: 0xffdf9a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
    const line = new THREE.Line(geometry, material)
    this.group.add(line)
    this.tracers.push({ line, material, life: 0.07, maxLife: 0.07 })
  }

  explosion(center: Vec3, radius: number): void {
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb545,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const flash = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.5, 12, 10), flashMaterial)
    flash.position.set(center.x, center.y + 0.5, center.z)
    this.group.add(flash)
    this.bursts.push({
      mesh: flash,
      material: flashMaterial,
      life: 0.35,
      maxLife: 0.35,
      velocity: new THREE.Vector3(0, 0, 0),
      gravity: 0,
    })

    for (let i = 0; i < 12; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xffcf6b : 0x4d4234,
        transparent: true,
        opacity: 1,
      })
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.08 + Math.random() * 0.1, 0.08 + Math.random() * 0.1, 0.08 + Math.random() * 0.1),
        material,
      )
      mesh.position.set(center.x, center.y + 0.3, center.z)
      this.group.add(mesh)
      const angle = Math.random() * Math.PI * 2
      const speed = 2 + Math.random() * 5
      this.bursts.push({
        mesh,
        material,
        life: 0.6 + Math.random() * 0.5,
        maxLife: 1.1,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, 2 + Math.random() * 5, Math.sin(angle) * speed),
        gravity: 9.8,
      })
    }

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc247,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.85, radius, 32), ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(center.x, center.y + 0.03, center.z)
    this.group.add(ring)
    this.bursts.push({ mesh: ring, material: ringMaterial, life: 0.55, maxLife: 0.55, velocity: new THREE.Vector3(), gravity: 0 })

    const light = new THREE.PointLight(0xffa64d, 8, 8, 2)
    light.position.set(center.x, center.y + 1.2, center.z)
    this.group.add(light)
    window.setTimeout(() => light.removeFromParent(), 120)
  }

  marker(position: Vec3, color = 0xffd34d): void {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.34, 24), material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(position.x, 0.04, position.z)
    this.group.add(mesh)
    this.markers.push({ mesh, material, life: 0.85, maxLife: 0.85 })
  }

  update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      const tracer = this.tracers[i]
      tracer.life -= dt
      tracer.material.opacity = Math.max(0, tracer.life / tracer.maxLife) * 0.9
      if (tracer.life > 0) continue
      tracer.line.removeFromParent()
      tracer.line.geometry.dispose()
      tracer.material.dispose()
      this.tracers.splice(i, 1)
    }

    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i]
      burst.life -= dt
      const t = Math.max(0, burst.life / burst.maxLife)
      if (burst.material instanceof THREE.MeshBasicMaterial) burst.material.opacity = t
      if (burst.gravity > 0) {
        burst.velocity.y -= burst.gravity * dt
        burst.mesh.position.addScaledVector(burst.velocity, dt)
      } else if (burst.maxLife < 0.5) {
        burst.mesh.scale.setScalar(1 + (1 - t) * 1.8)
      } else {
        burst.mesh.scale.setScalar(1 + (1 - t) * 2.5)
      }
      if (burst.life > 0) continue
      burst.mesh.removeFromParent()
      burst.mesh.geometry.dispose()
      burst.material.dispose()
      this.bursts.splice(i, 1)
    }

    for (let i = this.markers.length - 1; i >= 0; i -= 1) {
      const marker = this.markers[i]
      marker.life -= dt
      marker.material.opacity = Math.max(0, marker.life / marker.maxLife)
      if (marker.life > 0) continue
      marker.mesh.removeFromParent()
      marker.mesh.geometry.dispose()
      marker.material.dispose()
      this.markers.splice(i, 1)
    }
  }

  dispose(): void {
    for (const tracer of this.tracers) {
      tracer.line.geometry.dispose()
      tracer.material.dispose()
    }
    for (const burst of this.bursts) {
      burst.mesh.geometry.dispose()
      burst.material.dispose()
    }
    for (const marker of this.markers) {
      marker.mesh.geometry.dispose()
      marker.material.dispose()
    }
    this.tracers.length = 0
    this.bursts.length = 0
    this.markers.length = 0
    this.group.removeFromParent()
    this.group.clear()
  }
}
