import * as THREE from 'three'
import type { CoverData, Vec3 } from '../Data/Types'
import { Layers } from '../config/layers'
import { STATIC_GROUND_GROUPS, STATIC_TREE_GROUPS, type PhysicsWorld } from '../physics/PhysicsWorld'

/** Builds the low-poly forest and the radio objective. */
export class SceneManager {
  readonly root = new THREE.Group()
  private readonly covers = new THREE.Group()
  private readonly radioGroup = new THREE.Group()
  private beacon: THREE.Mesh | null = null
  private ring: THREE.Mesh | null = null
  private clock = 0

  constructor(
    scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.root.name = 'LevelScene'
    this.covers.name = 'Covers'
    this.radioGroup.name = 'Radio'
    this.root.add(this.covers, this.radioGroup)
    scene.add(this.root)
  }

  buildGround(size: { width: number; depth: number }): void {
    const texture = makeGroundTexture()
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
    })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.width, 0.2, size.depth), material)
    mesh.position.set(15, -0.1, 15)
    mesh.receiveShadow = true
    mesh.layers.enable(Layers.Terrain)
    this.root.add(mesh)
    this.physics.addStaticBox({ x: 15, y: -0.1, z: 15 }, { x: size.width / 2, y: 0.1, z: size.depth / 2 }, STATIC_GROUND_GROUPS)

    // A large, non-colliding forest floor beyond the playable 30x30 area keeps
    // the camera from staring into empty sky at the map edge.
    const backdropTexture = makeGroundTexture()
    backdropTexture.repeat.set(30, 30)
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ map: backdropTexture, color: 0xffffff, roughness: 1 }),
    )
    backdrop.rotation.x = -Math.PI / 2
    backdrop.position.set(15, -0.035, 15)
    backdrop.receiveShadow = false
    this.root.add(backdrop)
  }

  buildCovers(covers: CoverData[]): void {
    for (const cover of covers) {
      if (cover.type === 'tree') {
        this.buildTree(cover)
      } else if (cover.type === 'rock') {
        this.buildRock(cover)
      } else {
        this.buildWall(cover)
      }
    }
  }

  buildRadio(position: Vec3, radius: number): void {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.9, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0x48504d, roughness: 0.8, metalness: 0.3 }),
    )
    base.position.set(position.x, 0.18, position.z)
    base.castShadow = true
    base.receiveShadow = true
    this.radioGroup.add(base)

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.08, 3.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x8f9792, roughness: 0.45, metalness: 0.7 }),
    )
    mast.position.set(position.x, 2.15, position.z)
    mast.castShadow = true
    this.radioGroup.add(mast)

    const dish = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 0.28, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xb9c0b8, roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide }),
    )
    dish.position.set(position.x, 2.7, position.z)
    dish.rotation.x = Math.PI / 2
    this.radioGroup.add(dish)

    const beaconMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd34d,
      emissive: 0xffa000,
      emissiveIntensity: 1.8,
    })
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), beaconMaterial)
    this.beacon.position.set(position.x, 3.95, position.z)
    this.radioGroup.add(this.beacon)

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd34d,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.08, radius, 48), ringMaterial)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.set(position.x, 0.035, position.z)
    this.radioGroup.add(this.ring)

    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.55, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x5a513c, roughness: 0.9 }),
    )
    crate.position.set(position.x + 1.2, 0.28, position.z - 0.6)
    crate.castShadow = true
    crate.receiveShadow = true
    crate.layers.enable(Layers.Terrain)
    this.root.add(crate)
    this.physics.addStaticBox(
      { x: position.x + 1.2, y: 0.28, z: position.z - 0.6 },
      { x: 0.35, y: 0.28, z: 0.35 },
    )

    this.physics.addStaticBox(position, { x: 0.8, y: 0.18, z: 0.8 })
  }

  update(dt: number): void {
    this.clock += dt
    if (this.beacon) {
      const material = this.beacon.material as THREE.MeshStandardMaterial
      material.emissiveIntensity = 1.1 + Math.sin(this.clock * 4) * 0.7
    }
    if (this.ring) {
      const material = this.ring.material as THREE.MeshBasicMaterial
      material.opacity = 0.22 + (Math.sin(this.clock * 2.4) * 0.5 + 0.5) * 0.24
    }
  }

  createMarker(position: Vec3, color: number, name: string): THREE.Mesh {
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.05, 12),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 }),
    )
    marker.name = name
    marker.position.set(position.x, position.y + 0.03, position.z)
    this.root.add(marker)
    return marker
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial && material.map) material.map.dispose()
          material.dispose()
        }
      }
    })
    this.root.removeFromParent()
    this.root.clear()
  }

  private buildTree(cover: CoverData): void {
    const height = Math.max(2.6, cover.size.y)
    const radius = Math.max(0.18, cover.size.x * 0.18)
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 })
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius, height, 6), trunkMaterial)
    trunk.position.set(cover.position.x, height / 2, cover.position.z)
    trunk.castShadow = true
    trunk.receiveShadow = true
    trunk.layers.enable(Layers.Terrain)
    this.covers.add(trunk)

    const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x3f6b3d, roughness: 0.95 })
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(0.8, cover.size.x * 0.5), height * 0.75, 7),
      canopyMaterial,
    )
    canopy.position.set(cover.position.x, height * 0.82, cover.position.z)
    canopy.castShadow = true
    canopy.receiveShadow = true
    this.covers.add(canopy)

    this.physics.addStaticBox(
      { x: cover.position.x, y: height / 2, z: cover.position.z },
      { x: radius, y: height / 2, z: radius },
      STATIC_TREE_GROUPS,
    )
  }

  private buildRock(cover: CoverData): void {
    const geometry = new THREE.DodecahedronGeometry(0.75, 0)
    const material = new THREE.MeshStandardMaterial({ color: 0x737a70, roughness: 0.95 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(cover.position.x, cover.position.y, cover.position.z)
    mesh.scale.set(cover.size.x, cover.size.y, cover.size.z)
    mesh.rotation.y = (cover.position.x * 13.7 + cover.position.z * 7.1) % Math.PI
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.layers.enable(Layers.Terrain)
    this.covers.add(mesh)
    this.physics.addStaticBox(
      { x: cover.position.x, y: cover.position.y, z: cover.position.z },
      { x: cover.size.x * 0.65, y: cover.size.y * 0.7, z: cover.size.z * 0.65 },
    )
  }

  private buildWall(cover: CoverData): void {
    const color = cover.size.x > cover.size.z ? 0x8a7355 : 0x7d6a51
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(cover.size.x, cover.size.y, cover.size.z),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
    )
    mesh.position.set(cover.position.x, cover.position.y, cover.position.z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.layers.enable(Layers.Terrain)
    this.covers.add(mesh)
    this.physics.addStaticBox(
      { x: cover.position.x, y: cover.position.y, z: cover.position.z },
      { x: cover.size.x / 2, y: cover.size.y / 2, z: cover.size.z / 2 },
    )
  }
}

function makeGroundTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#6f8150'
    ctx.fillRect(0, 0, size, size)
    let seed = 1337
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    for (let i = 0; i < 2400; i += 1) {
      const x = random() * size
      const y = random() * size
      const shade = 70 + Math.floor(random() * 60)
      ctx.fillStyle = `rgba(${shade - 20}, ${shade + 20}, ${shade - 30}, 0.28)`
      ctx.fillRect(x, y, 1 + random() * 2, 1 + random() * 2)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(6, 6)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
