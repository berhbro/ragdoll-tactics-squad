import type { MovementCommand } from './Interfaces'
import type { UnitId, Vec3 } from '../Data/Types'

interface Agent {
  position: Vec3
  speed: number
  target: Vec3 | null
  queue: Vec3[]
  moving: boolean
}

export type MovementResolver = (unitId: UnitId, from: Vec3, to: Vec3) => Vec3

/** Straight-line ground movement with a shortest-path queue. */
export class UnitMovement implements MovementCommand {
  private readonly agents = new Map<UnitId, Agent>()

  constructor(private readonly resolve?: MovementResolver) {}

  register(unitId: UnitId, position: Vec3, speed = 3): void {
    this.agents.set(unitId, {
      position: { ...position },
      speed,
      target: null,
      queue: [],
      moving: false,
    })
  }

  unregister(unitId: UnitId): void {
    this.agents.delete(unitId)
  }

  moveTo(unitId: UnitId, position: Vec3): void {
    const agent = this.agents.get(unitId)
    if (!agent) return
    agent.target = { ...position }
    agent.queue = []
    agent.moving = true
  }

  queueMove(unitId: UnitId, position: Vec3): void {
    const agent = this.agents.get(unitId)
    if (!agent) return
    if (agent.target) {
      agent.queue.push({ ...position })
    } else {
      agent.target = { ...position }
      agent.moving = true
    }
  }

  stop(unitId: UnitId): void {
    const agent = this.agents.get(unitId)
    if (!agent) return
    agent.target = null
    agent.queue = []
    agent.moving = false
  }

  forceMoveThroughMine(unitId: UnitId, position: Vec3): void {
    this.moveTo(unitId, position)
  }

  isMoving(unitId: UnitId): boolean {
    return this.agents.get(unitId)?.moving ?? false
  }

  getQueue(unitId: UnitId): Vec3[] {
    const agent = this.agents.get(unitId)
    if (!agent) return []
    return [...(agent.target ? [agent.target] : []), ...agent.queue]
  }

  update(dt: number): void {
    const step = Math.max(0, Number.isFinite(dt) ? dt : 0)
    for (const [id, agent] of this.agents) {
      if (!agent.target) {
        agent.moving = false
        continue
      }

      const target = agent.target
      const dx = target.x - agent.position.x
      const dz = target.z - agent.position.z
      const distance = Math.hypot(dx, dz)
      if (distance <= 0.22) {
        agent.position = { ...target }
        agent.target = agent.queue.shift() ?? null
        agent.moving = agent.target !== null
        continue
      }

      const amount = Math.min(distance, agent.speed * step)
      const desired = {
        x: agent.position.x + (dx / distance) * amount,
        y: agent.position.y,
        z: agent.position.z + (dz / distance) * amount,
      }
      if (this.resolve) {
        agent.position = this.resolve(id, agent.position, desired)
      } else {
        agent.position = desired
      }
      agent.position.y = target.y
      agent.moving = true
    }
  }

  getPosition(unitId: UnitId): Vec3 | undefined {
    const position = this.agents.get(unitId)?.position
    return position ? { ...position } : undefined
  }

  setPosition(unitId: UnitId, position: Vec3): void {
    const agent = this.agents.get(unitId)
    if (agent) agent.position = { ...position }
  }

  getPositions(): Map<UnitId, Vec3> {
    return new Map(Array.from(this.agents, ([id, agent]) => [id, { ...agent.position }]))
  }

  reset(): void {
    for (const agent of this.agents.values()) {
      agent.target = null
      agent.queue = []
      agent.moving = false
    }
  }
}
