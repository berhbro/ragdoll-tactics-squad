import * as THREE from 'three'
import type { HoverTarget } from './InteractionManager'

export class HoverIndicator {
  private readonly scene: THREE.Scene
  private readonly red: THREE.Sprite
  private readonly green: THREE.Sprite
  private readonly yellow: THREE.Sprite
  private time = 0
  private readonly box = new THREE.Box3()
  private readonly center = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.red = this.makeSprite('#ff3b3b')
    this.green = this.makeSprite('#3bff6b')
    this.yellow = this.makeSprite('#ffd43b')
    this.scene.add(this.red, this.green, this.yellow)
    this.hideAll()
  }

  update(hovered: HoverTarget | null, dt: number): void {
    this.time += dt
    this.hideAll()
    if (!hovered) return

    const sprite =
      hovered.kind === 'attack'
        ? this.red
        : hovered.kind === 'defuse'
          ? this.yellow
          : this.green

    this.box.setFromObject(hovered.object)
    if (this.box.isEmpty()) return
    this.box.getCenter(this.center)

    const bob = Math.sin(this.time * 3) * 0.08
    const top = this.box.max.y + 0.6 + bob
    sprite.position.set(this.center.x, top, this.center.z)
    sprite.visible = true
  }

  private hideAll(): void {
    this.red.visible = false
    this.green.visible = false
    this.yellow.visible = false
  }

  private makeSprite(color: string): THREE.Sprite {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, size, size)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(size / 2, size)
      ctx.lineTo(0, 0)
      ctx.lineTo(size, 0)
      ctx.closePath()
      ctx.fill()
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(0.5, 0.5, 0.5)
    sprite.visible = false
    return sprite
  }
}
