import { eventBus } from '../core/EventBus'
import { ENEMY, ENEMY_STATS } from '../config/constants'
import type { EnemySpawnData, EnemyType, UnitId, Vec3 } from '../Data/Types'
import type { CombatSystem } from '../systems/CombatSystem'
import type { UnitRecord, UnitStore } from '../units/UnitStore'

export type EnemyState = 'guard' | 'patrol' | 'chase' | 'attack' | 'search' | 'dead'

interface Agent {
  id: UnitId
  type: EnemyType
  spawn: Vec3
  defenseArea?: { min: Vec3; max: Vec3 }
  patrolPoints: Vec3[]
  patrolIndex: number
  state: EnemyState
  targetId?: UnitId
  lastKnown?: Vec3
  lostSight: number
  scanTimer: number
  fireCooldown: number
  waitTimer: number
  facingBase: number
  scanPhase: number
}

export type EnemyMoveResolver = (unitId: UnitId, from: Vec3, desired: Vec3) => Vec3

/**
 * Heuristic enemy controller shared by all eight enemies. It stops at ~7.2 m
 * (inside the 8 m attack range) and shoots instead of walking into the player.
 */
export class EnemyAI {
  readonly agents = new Map<UnitId, Agent>()
  private clock = 0

  constructor(
    private readonly store: UnitStore,
    private readonly combat: CombatSystem,
    private readonly resolveMove: EnemyMoveResolver = (_id, _from, desired) => desired,
    private readonly damageScale = 1,
  ) {
    eventBus.on('shotFired', this.onShotFired)
    eventBus.on('explosionImpulse', this.onExplosion)
  }

  addEnemy(data: EnemySpawnData): void {
    const stats = ENEMY_STATS[data.type]
    this.store.add({
      id: data.id,
      team: 'enemy',
      role: 'enemy',
      displayName: enemyName(data.type),
      position: data.spawn,
      hp: stats.hp,
      maxHp: stats.hp,
      speed: stats.speed,
      facing: Math.atan2(15 - data.spawn.x, 15 - data.spawn.z),
    })
    this.agents.set(data.id, {
      id: data.id,
      type: data.type,
      spawn: { ...data.spawn },
      defenseArea: data.defenseArea,
      patrolPoints: (data.patrolPoints ?? []).map((point) => ({ ...point })),
      patrolIndex: 0,
      state: data.patrolPoints?.length ? 'patrol' : 'guard',
      lostSight: 0,
      scanTimer: Math.random() * 0.2,
      fireCooldown: Math.random() * 0.8,
      waitTimer: 0,
      facingBase: Math.atan2(15 - data.spawn.x, 15 - data.spawn.z),
      scanPhase: Math.random() * Math.PI * 2,
    })
  }

  update(dt: number): void {
    const step = Math.max(0, dt)
    this.clock += step

    for (const agent of this.agents.values()) {
      const unit = this.store.get(agent.id)
      if (!unit || unit.state !== 'alive') {
        agent.state = 'dead'
        continue
      }

      agent.fireCooldown = Math.max(0, agent.fireCooldown - step)
      agent.scanTimer -= step
      agent.waitTimer = Math.max(0, agent.waitTimer - step)

      if (agent.scanTimer <= 0) {
        agent.scanTimer = 0.25
        this.scan(agent, unit)
      }

      const target = agent.targetId ? this.store.get(agent.targetId) : undefined
      if (target && target.state !== 'alive') {
        agent.targetId = undefined
      }

      const currentTarget = agent.targetId ? this.store.get(agent.targetId) : undefined
      if (currentTarget) {
        this.engage(agent, unit, currentTarget, step)
        continue
      }

      if (agent.state === 'search' && agent.lastKnown) {
        const reached = this.moveToward(agent, unit, agent.lastKnown, step)
        if (reached) {
          agent.lastKnown = undefined
          agent.waitTimer = 1.2
          agent.state = agent.patrolPoints.length > 0 ? 'patrol' : 'guard'
        }
        continue
      }

      if (agent.patrolPoints.length > 0) {
        this.patrol(agent, unit, step)
      } else {
        this.guard(agent, unit, step)
      }
    }
  }

  alert(position: Vec3, radius = ENEMY.hearingRange): void {
    for (const agent of this.agents.values()) {
      const unit = this.store.get(agent.id)
      if (!unit || unit.state !== 'alive') continue
      if (distanceXZ(unit.position, position) > radius) continue
      agent.lastKnown = { ...position }
      if (!agent.targetId) agent.state = 'search'
    }
  }

  getAliveCount(): number {
    return this.store.alive('enemy').length
  }

  dispose(): void {
    eventBus.off('shotFired', this.onShotFired)
    eventBus.off('explosionImpulse', this.onExplosion)
  }

  private scan(agent: Agent, unit: UnitRecord): void {
    const current = agent.targetId ? this.store.get(agent.targetId) : undefined
    if (current && current.state === 'alive' && this.canSeePlayer(agent, unit, current)) {
      agent.lastKnown = { ...current.position }
      agent.lostSight = 0
      if (agent.state !== 'attack') agent.state = 'chase'
      return
    }

    let best: UnitRecord | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const player of this.store.alive('player')) {
      const distance = distanceXZ(unit.position, player.position)
      if (distance > ENEMY.visionRange || distance >= bestDistance) continue

      // The 90-degree cone is bypassed by hearing/being shot at, which sets
      // lastKnown. A sentinel that was alerted will look toward that noise.
      const alerted = agent.state === 'search' || agent.lastKnown !== undefined
      if (!alerted && !this.inVisionCone(unit, player.position)) continue
      if (!this.combat.canSee(agent.id, player.id, ENEMY.visionRange)) continue
      best = player
      bestDistance = distance
    }

    if (best) {
      if (agent.targetId !== best.id) {
        agent.targetId = best.id
        agent.lostSight = 0
      }
      agent.lastKnown = { ...best.position }
      agent.lostSight = 0
      if (agent.state !== 'attack') agent.state = 'chase'
      return
    }

    if (agent.targetId) {
      agent.lostSight += 0.25
      if (agent.lostSight > ENEMY.loseSightGraceSec) {
        agent.targetId = undefined
        agent.state = 'search'
      }
    }
  }

  private engage(agent: Agent, unit: UnitRecord, target: UnitRecord, dt: number): void {
    const distance = distanceXZ(unit.position, target.position)
    const stats = ENEMY_STATS[agent.type]
    unit.facing = Math.atan2(target.position.x - unit.position.x, target.position.z - unit.position.z)

    if (distance <= stats.range && this.combat.canSee(agent.id, target.id, stats.range)) {
      agent.state = 'attack'
      agent.lastKnown = { ...target.position }
      if (agent.fireCooldown <= 0) {
        this.combat.fire({
          attackerId: agent.id,
          targetId: target.id,
          weapon: stats,
          damageScale: this.damageScale,
        })
        agent.fireCooldown = stats.interval * (0.9 + Math.random() * 0.25)
      }
      return
    }

    // Do not turn into a zombie: stop just inside the 8 m firing envelope.
    if (distance <= ENEMY.attackStopRange) {
      agent.state = 'attack'
      return
    }

    agent.state = 'chase'
    const destination = this.leash(agent, unit.position, target.position)
    const reached = this.moveToward(agent, unit, destination, dt)
    if (reached) {
      unit.facing = Math.atan2(target.position.x - unit.position.x, target.position.z - unit.position.z)
    }
  }

  private patrol(agent: Agent, unit: UnitRecord, dt: number): void {
    const point = agent.patrolPoints[agent.patrolIndex]
    if (!point) {
      this.guard(agent, unit, dt)
      return
    }
    if (this.moveToward(agent, unit, point, dt)) {
      agent.patrolIndex = (agent.patrolIndex + 1) % agent.patrolPoints.length
      agent.waitTimer = 0.8
    }
  }

  private guard(agent: Agent, unit: UnitRecord, dt: number): void {
    agent.scanPhase += dt * 0.35
    unit.facing = agent.facingBase + Math.sin(agent.scanPhase) * 0.9
  }

  private moveToward(agent: Agent, unit: UnitRecord, target: Vec3, dt: number): boolean {
    const dx = target.x - unit.position.x
    const dz = target.z - unit.position.z
    const distance = Math.hypot(dx, dz)
    if (distance <= 0.3) return true

    const stats = ENEMY_STATS[agent.type]
    const amount = Math.min(distance, stats.speed * dt)
    const desired = {
      x: unit.position.x + (dx / distance) * amount,
      y: unit.position.y,
      z: unit.position.z + (dz / distance) * amount,
    }
    const actual = this.resolveMove(unit.id, unit.position, desired)
    unit.position = { x: actual.x, y: target.y, z: actual.z }
    unit.facing = Math.atan2(dx, dz)
    return Math.hypot(actual.x - target.x, actual.z - target.z) <= 0.3
  }

  /** Sentinels barely leave their post; patrols and elites get a bounded chase. */
  private leash(agent: Agent, from: Vec3, target: Vec3): Vec3 {
    const stats = ENEMY_STATS[agent.type]
    const anchor = agent.defenseArea
      ? {
          x: (agent.defenseArea.min.x + agent.defenseArea.max.x) / 2,
          y: 0,
          z: (agent.defenseArea.min.z + agent.defenseArea.max.z) / 2,
        }
      : agent.spawn
    const limit = agent.defenseArea
      ? Math.max(
          agent.defenseArea.max.x - agent.defenseArea.min.x,
          agent.defenseArea.max.z - agent.defenseArea.min.z,
        ) / 2 + stats.chaseLeash
      : stats.chaseLeash
    const dx = target.x - anchor.x
    const dz = target.z - anchor.z
    const distance = Math.hypot(dx, dz)
    if (distance <= limit) return { ...target }
    return {
      x: anchor.x + (dx / distance) * limit,
      y: from.y,
      z: anchor.z + (dz / distance) * limit,
    }
  }

  private canSeePlayer(agent: Agent, unit: UnitRecord, target: UnitRecord): boolean {
    if (distanceXZ(unit.position, target.position) > ENEMY.visionRange) return false
    if (!this.inVisionCone(unit, target.position) && agent.state !== 'attack' && agent.state !== 'chase') {
      return false
    }
    return this.combat.canSee(agent.id, target.id, ENEMY.visionRange)
  }

  private inVisionCone(unit: UnitRecord, target: Vec3): boolean {
    const dx = target.x - unit.position.x
    const dz = target.z - unit.position.z
    const length = Math.hypot(dx, dz)
    if (length < 1e-4) return true
    const facingX = Math.sin(unit.facing)
    const facingZ = Math.cos(unit.facing)
    const dot = (dx / length) * facingX + (dz / length) * facingZ
    return dot >= Math.cos((ENEMY.visionAngleDeg * Math.PI) / 360)
  }

  private onShotFired = (payload: { unitId: UnitId; from: Vec3 }): void => {
    const shooter = this.store.get(payload.unitId)
    if (shooter?.team !== 'player') return
    this.alert(payload.from)
  }

  private onExplosion = (payload: { center: Vec3 }): void => {
    this.alert(payload.center)
  }
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function enemyName(type: EnemyType): string {
  switch (type) {
    case 'sentinel':
      return '哨兵'
    case 'patrol':
      return '巡逻兵'
    case 'elite':
      return '精英守卫'
  }
}
