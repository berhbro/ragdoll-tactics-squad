import * as THREE from 'three'
import { eventBus } from '../core/EventBus'
import { Stats } from '../core/Stats'
import {
  CAPTURE,
  DETECTOR,
  UNIT,
} from '../config/constants'
import type {
  ExplosionImpulseEvent,
  MineId,
  UnitId,
  UnitRole,
  Vec3,
} from '../Data/Types'
import { AssetLoader } from '../managers/AssetLoader'
import { Defuse } from '../managers/Defuse'
import { Detector } from '../managers/Detector'
import { MinefieldManager, checkMineTriggers } from '../managers/MinefieldManager'
import { SquadManager } from '../managers/SquadManager'
import { UnitMovement } from '../managers/UnitMovement'
import { CaptureManager } from '../capture/CaptureManager'
import { PhysicsWorld, type CharacterHandle } from '../physics/PhysicsWorld'
import { SceneManager } from '../scene/SceneManager'
import type { LevelRuntimeData } from '../scene/LevelBuilder'
import { DamageSystem } from '../systems/DamageSystem'
import { CombatSystem } from '../systems/CombatSystem'
import { PlayerCombat } from '../systems/PlayerCombat'
import { MineExplosionSystem } from '../systems/MineExplosionSystem'
import { RescueSystem } from '../systems/RescueSystem'
import { FxSystem } from '../effects/FxSystem'
import { EnemyAI } from '../ai/EnemyAI'
import { RagdollComponent } from '../units/RagdollComponent'
import { UnitStore } from '../units/UnitStore'
import { UnitVisual } from '../units/UnitVisual'

export type BattleMode = 'normal' | 'demo'

export interface DebugUnit {
  id: string
  team: string
  role: string
  hp: number
  state: string
  x: number
  z: number
}

/**
 * One self-contained mission instance. Game creates a fresh Battle for every
 * start/restart, so resetting is a dispose + rebuild instead of fragile state
 * patching.
 */
export class Battle {
  readonly store = new UnitStore()
  readonly stats = new Stats()
  readonly physics = new PhysicsWorld()
  readonly squad: SquadManager

  private readonly level: LevelRuntimeData
  private readonly assets: AssetLoader
  private readonly scene: THREE.Scene
  private readonly damage: DamageSystem
  private readonly combat: CombatSystem
  private readonly playerCombat: PlayerCombat
  private readonly enemyAI: EnemyAI
  private readonly minefield: MinefieldManager
  private readonly detector: Detector
  private readonly defuse: Defuse
  private readonly mineExplosion: MineExplosionSystem
  private readonly rescue: RescueSystem
  private readonly capture: CaptureManager
  private readonly moveResolver = (id: UnitId, _from: Vec3, to: Vec3): Vec3 => {
    const character = this.characters.get(id)
    return character ? this.physics.moveCharacter(character, to) : to
  }

  private sceneManager: SceneManager | null = null
  private fx: FxSystem | null = null
  private readonly visuals = new Map<UnitId, UnitVisual>()
  private readonly characters = new Map<UnitId, CharacterHandle>()
  private readonly ragdolls = new Map<UnitId, RagdollComponent>()
  private readonly ragdollSince = new Map<UnitId, number>()
  private readonly mineMeshes = new Map<MineId, THREE.Group>()
  private readonly mineHideAt = new Map<MineId, number>()
  private readonly selectionRings: THREE.Mesh[] = []
  private readonly prevPositions = new Map<UnitId, Vec3>()

  private clock = 0
  private statsTimer = 0
  private guardCooldown = 0
  private engineerBypassGuard = false
  private engineerForward: Vec3 = { x: 0, y: 0, z: 1 }
  private lastDownId: UnitId | undefined
  private over = false
  private disposed = false
  private selectedSnapshot: UnitId[] = []

  constructor(
    scene: THREE.Scene,
    assets: AssetLoader,
    level: LevelRuntimeData,
    mode: BattleMode = 'normal',
  ) {
    this.scene = scene
    this.assets = assets
    this.level = level

    this.damage = new DamageSystem(this.store, this.stats)
    this.combat = new CombatSystem(this.store, (from, to) => !this.physics.isLineBlocked(from, to))
    this.squad = new SquadManager(this.store, new UnitMovement(this.moveResolver))
    this.squad.setFormationEnabled(mode === 'normal')
    this.playerCombat = new PlayerCombat(
      this.store,
      this.combat,
      (unitId) => this.isBusy(unitId),
      () => this.squad.getSelectedAliveIds(),
      mode === 'demo' ? 1.25 : 1,
    )
    this.enemyAI = new EnemyAI(
      this.store,
      this.combat,
      this.moveResolver,
      mode === 'demo' ? 0.32 : 1,
    )

    this.minefield = new MinefieldManager({
      fixedMines: level.fixedMines,
      randomMines: level.randomMines,
      randomMineSeed: level.randomMineSeed,
    })
    this.detector = new Detector(this.minefield)
    // The demo is a showcase: a random defuse failure would leave the engineer
    // downed behind the squad and make the rest of the script meaningless.
    this.defuse = new Defuse(this.minefield, this.store, mode === 'demo' ? { failureRate: 0 } : {})
    this.mineExplosion = new MineExplosionSystem(this.minefield, this.store)
    this.rescue = new RescueSystem(this.store, this.damage)
    this.capture = new CaptureManager(level.radio.position, level.radio.radius, CAPTURE.requiredSeconds)

    eventBus.on('unitDowned', this.onUnitDowned)
    eventBus.on('unitDied', this.onUnitDied)
    eventBus.on('unitRevived', this.onUnitRevived)
    eventBus.on('mineDetected', this.onMineDetected)
    eventBus.on('mineTriggered', this.onMineTriggered)
    eventBus.on('mineDefused', this.onMineDefused)
    eventBus.on('explosionImpulse', this.onExplosion)
    eventBus.on('shotFired', this.onShotFired)
    eventBus.on('moveCommand', this.onMoveCommand)
    eventBus.on('interactionRequested', this.onInteractionRequested)
    eventBus.on('captureComplete', this.onCaptureComplete)
    eventBus.on('unitSelected', this.onUnitSelected)
  }

  async build(): Promise<void> {
    await this.physics.init()
    this.sceneManager = new SceneManager(this.scene, this.physics)
    this.fx = new FxSystem(this.scene)

    this.sceneManager.buildGround({ width: 30, depth: 30 })
    this.sceneManager.buildCovers(this.level.covers)
    this.sceneManager.buildRadio(this.level.radio.position, this.level.radio.radius)

    await this.assets.loadAllUnitAssets()
    await this.spawnPlayers()
    await this.spawnEnemies()
    this.spawnMines()
    this.spawnSelectionRings()

    this.squad.select([])
    this.damage.emitSquad()
    this.capture.update(0, this.captureContext())
    this.emitStats()
  }

  update(dt: number): void {
    if (this.disposed || this.over) return
    const step = Math.max(0, Math.min(0.05, dt))
    this.clock += step
    this.stats.tick(step)

    this.squad.update(step)
    this.enemyAI.update(step)
    this.separateUnits()
    this.playerCombat.update(step)

    const engineer = this.store.get('engineer')
    if (engineer && engineer.state === 'alive') {
      const forward = this.squad.movement.isMoving('engineer')
        ? this.engineerForward
        : { x: Math.sin(engineer.facing), y: 0, z: Math.cos(engineer.facing) }
      this.detector.setEngineerTransform('engineer', engineer.position, forward)
      this.detector.update(step, 'engineer')
      const ahead = this.detector.getMineAhead('engineer')
      if (
        ahead
        && !this.engineerBypassGuard
        && this.clock >= this.guardCooldown
        && this.squad.movement.isMoving('engineer')
        && ahead.distance <= 2.8
      ) {
        this.squad.movement.stop('engineer')
        this.guardCooldown = this.clock + DETECTOR.stopCooldownSec
        eventBus.emit('notify', {
          text: '探雷器报警：工兵已停下。再次右键可强行通过',
          tone: 'warn',
        })
      }
    }
    if (this.defuse.isBusy) this.defuse.update(step)
    this.mineExplosion.update(step)
    this.rescue.update(step)

    checkMineTriggers(
      this.minefield,
      this.store.alive('player').map((unit) => ({ ...unit, state: unit.state })),
    )

    if (!this.over) {
      this.capture.update(step, this.captureContext())
      if (this.store.alive('player').length === 0) {
        this.finish(false)
      }
    }

    this.sceneManager?.update(step)
    this.checkRagdolls()
    this.syncWorld(step)
    this.syncMines()
    this.syncSelectionRings(step)
    this.fx?.update(step)

    this.statsTimer += step
    if (this.statsTimer >= 0.25) {
      this.statsTimer = 0
      this.emitStats()
    }
  }

  fixedUpdate(dt: number): void {
    if (this.disposed || this.over) return
    this.physics.step(dt)
    this.physics.syncMeshes()
  }

  getCameraTarget(): Vec3 | null {
    return this.store.center('player', true) ?? this.store.center('enemy', false)
  }

  getSelectedIds(): UnitId[] {
    return this.squad.getSelectedIds()
  }

  /** Debug-only relocation used by the browser smoke tests. */
  debugTeleport(unitId: UnitId, x: number, z: number): void {
    const unit = this.store.get(unitId)
    if (!unit) return
    unit.position = { x, y: 0, z }
    if (unit.team === 'player') this.squad.movement.setPosition(unitId, unit.position)
    const character = this.characters.get(unitId)
    if (character) this.physics.teleportCharacter(character, unit.position)
  }

  getVisuals(): Map<UnitId, UnitVisual> {
    return this.visuals
  }

  selectAll(): void {
    this.squad.select(['engineer', 'rifleman', 'machinegunner'])
  }

  isOver(): boolean {
    return this.over
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    eventBus.off('unitDowned', this.onUnitDowned)
    eventBus.off('unitDied', this.onUnitDied)
    eventBus.off('unitRevived', this.onUnitRevived)
    eventBus.off('mineDetected', this.onMineDetected)
    eventBus.off('mineTriggered', this.onMineTriggered)
    eventBus.off('mineDefused', this.onMineDefused)
    eventBus.off('explosionImpulse', this.onExplosion)
    eventBus.off('shotFired', this.onShotFired)
    eventBus.off('moveCommand', this.onMoveCommand)
    eventBus.off('interactionRequested', this.onInteractionRequested)
    eventBus.off('captureComplete', this.onCaptureComplete)
    eventBus.off('unitSelected', this.onUnitSelected)

    this.squad.dispose()
    this.defuse.dispose()
    this.rescue.dispose()
    this.enemyAI.dispose()
    this.mineExplosion.dispose()
    this.damage.dispose()

    for (const ragdoll of this.ragdolls.values()) ragdoll.dispose()
    this.ragdolls.clear()
    this.ragdollSince.clear()
    for (const visual of this.visuals.values()) visual.dispose()
    this.visuals.clear()
    for (const ring of this.selectionRings) {
      ring.geometry.dispose()
      const material = ring.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material.dispose()
      ring.removeFromParent()
    }
    this.selectionRings.length = 0
    for (const group of this.mineMeshes.values()) disposeObject(group)
    this.mineMeshes.clear()
    this.sceneManager?.dispose()
    this.fx?.dispose()
    this.physics.dispose()
    this.store.clear()
  }

  getDebugState(): {
    over: boolean
    players: DebugUnit[]
    enemies: DebugUnit[]
    mines: { id: string; revealed: boolean; defused: boolean; triggered: boolean }[]
    selected: string[]
    capture: number
    radio: Vec3
    cameraTarget: Vec3 | null
    defuse: { busy: boolean; active: boolean; phase: string; target?: string }
    rescue: { phase: string; target?: string; rescuer?: string }
    ragdolls: { id: string; center: Vec3 }[]
  } {
    const units = (team: 'player' | 'enemy'): DebugUnit[] =>
      this.store
        .all()
        .filter((unit) => unit.team === team)
        .map((unit) => ({
          id: unit.id,
          team: unit.team,
          role: unit.role,
          hp: Math.round(unit.hp),
          state: unit.state,
          x: Math.round(unit.position.x * 100) / 100,
          z: Math.round(unit.position.z * 100) / 100,
        }))
    return {
      over: this.over,
      players: units('player'),
      enemies: units('enemy'),
      mines: this.minefield.mines.map((mine) => ({
        id: mine.id,
        revealed: mine.revealed,
        defused: mine.defused,
        triggered: mine.triggered,
      })),
      selected: this.squad.getSelectedIds(),
      capture: this.capture.getProgress(),
      radio: { ...this.level.radio.position },
      cameraTarget: this.getCameraTarget(),
      defuse: {
        busy: this.defuse.isBusy,
        active: this.defuse.isActive,
        phase: this.defuse.phaseName,
        target: this.defuse.targetMineId,
      },
      rescue: {
        phase: this.rescue.activePhase,
        target: this.rescue.activeTargetId,
        rescuer: this.rescue.activeRescuerId,
      },
      ragdolls: Array.from(this.ragdolls, ([id, ragdoll]) => ({ id, center: ragdoll.getCenter() })),
    }
  }

  // ---------------------------------------------------------------- spawning

  private async spawnPlayers(): Promise<void> {
    const spawn = this.level.playerSpawn
    const positions: Record<UnitRole, Vec3> = {
      engineer: { x: spawn.x, y: 0, z: spawn.z },
      rifleman: { x: spawn.x + 1.25, y: 0, z: spawn.z + 0.45 },
      machinegunner: { x: spawn.x + 0.5, y: 0, z: spawn.z + 1.4 },
    }
    const roles: UnitRole[] = ['engineer', 'rifleman', 'machinegunner']
    for (const role of roles) {
      const unit = this.squad.addUnit(role, role, positions[role])
      unit.facing = Math.atan2(15 - unit.position.x, 15 - unit.position.z)
      this.createCharacter(role, unit.position)
      const visual = await this.assets.createUnitVisual({ unitId: role, role, position: unit.position })
      visual.setTransform(unit.position, unit.facing)
      this.scene.add(visual)
      this.visuals.set(role, visual)
      this.prevPositions.set(role, { ...unit.position })
    }
  }

  private async spawnEnemies(): Promise<void> {
    for (const data of this.level.enemies) {
      this.enemyAI.addEnemy(data)
      const unit = this.store.get(data.id)
      if (!unit) continue
      this.createCharacter(unit.id, unit.position)
      const visual = await this.assets.createUnitVisual({
        unitId: unit.id,
        role: 'enemy',
        position: unit.position,
      })
      visual.setInteractionKind('attack')
      visual.setTransform(unit.position, unit.facing)
      this.scene.add(visual)
      this.visuals.set(unit.id, visual)
      this.prevPositions.set(unit.id, { ...unit.position })
    }
  }

  private createCharacter(id: UnitId, position: Vec3): void {
    const character = this.physics.createCharacter(
      { x: position.x, y: 0, z: position.z },
      UNIT.radius,
      UNIT.capsuleHalfHeight,
    )
    this.characters.set(id, character)
  }

  private spawnMines(): void {
    for (const mine of this.minefield.mines) {
      const group = new THREE.Group()
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.24, 0.07, 12),
        new THREE.MeshStandardMaterial({ color: 0x2b2f2a, roughness: 0.7, metalness: 0.5 }),
      )
      disc.position.y = 0.035
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xff4d2e, emissive: 0xff2100, emissiveIntensity: 1.2 }),
      )
      light.position.y = 0.085
      group.add(disc, light)
      group.position.set(mine.position.x, 0, mine.position.z)
      group.visible = false
      group.traverse((child) => {
        child.layers.enable(2)
        child.userData.interactionKind = 'defuse'
        child.userData.interactionId = mine.id
      })
      group.userData.interactionKind = 'defuse'
      group.userData.interactionId = mine.id
      this.scene.add(group)
      this.mineMeshes.set(mine.id, group)
    }
  }

  private spawnSelectionRings(): void {
    for (let i = 0; i < 3; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x8de07a,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 28), material)
      ring.rotation.x = -Math.PI / 2
      ring.visible = false
      ring.renderOrder = 2
      this.scene.add(ring)
      this.selectionRings.push(ring)
    }
  }

  // ---------------------------------------------------------------- events

  private onUnitSelected = (): void => {
    this.selectedSnapshot = this.squad.getSelectedIds()
  }

  private onUnitDowned = ({ unitId }: { unitId: UnitId }): void => {
    const unit = this.store.get(unitId)
    if (!unit || unit.team !== 'player') return
    if (unitId === 'engineer') eventBus.emit('minePulse', { intensity: 0 })
    this.lastDownId = unitId
    this.squad.movement.stop(unitId)
    const character = this.characters.get(unitId)
    if (character) this.physics.setCharacterEnabled(character, false)
    this.visuals.get(unitId)?.setVisible(false)
    this.spawnRagdoll(unitId, true)
    eventBus.emit('notify', {
      text: `${unit.displayName} 倒下了！选中队友后按 F 救援`,
      tone: 'warn',
    })
    eventBus.emit('audioPlay', { sfx: 'boltAction', volume: 0.6 })
  }

  private onUnitDied = ({ unitId }: { unitId: UnitId }): void => {
    const unit = this.store.get(unitId)
    if (!unit) return
    const character = this.characters.get(unitId)
    if (character) this.physics.setCharacterEnabled(character, false)
    this.visuals.get(unitId)?.setVisible(false)
    const ragdoll = this.ragdolls.get(unitId)
    if (ragdoll) {
      ragdoll.setDowned(false)
    } else {
      this.spawnRagdoll(unitId, false)
    }
    if (unit.team === 'player') {
      this.squad.movement.stop(unitId)
      eventBus.emit('notify', { text: `${unit.displayName} 阵亡`, tone: 'warn' })
    }
  }

  private onUnitRevived = ({ unitId }: { unitId: UnitId }): void => {
    const unit = this.store.get(unitId)
    if (!unit) return
    const ragdoll = this.ragdolls.get(unitId)
    if (ragdoll) {
      ragdoll.dispose()
      this.ragdolls.delete(unitId)
      this.ragdollSince.delete(unitId)
    }
    const visual = this.visuals.get(unitId)
    if (visual) {
      visual.setVisible(true)
      visual.setTransform(unit.position, unit.facing)
    }
    const character = this.characters.get(unitId)
    if (character) {
      this.physics.setCharacterEnabled(character, true)
      this.physics.teleportCharacter(character, { x: unit.position.x, y: 0, z: unit.position.z })
    }
  }

  private onMineDetected = ({ mineId }: { mineId: MineId }): void => {
    const mesh = this.mineMeshes.get(mineId)
    if (mesh) mesh.visible = true
    eventBus.emit('notify', { text: '探雷器发现地雷！', tone: 'warn' })
  }

  private onMineTriggered = ({ mineId }: { mineId: MineId }): void => {
    this.mineHideAt.set(mineId, this.clock + 0.8)
    eventBus.emit('cameraShake', { strength: 0.18 })
  }

  private onMineDefused = ({ mineId }: { mineId: MineId }): void => {
    const mesh = this.mineMeshes.get(mineId)
    if (mesh) mesh.visible = false
    eventBus.emit('notify', { text: '已排雷', tone: 'success' })
    eventBus.emit('audioPlay', { sfx: 'boltAction', volume: 0.3 })
  }

  private onExplosion = (payload: ExplosionImpulseEvent): void => {
    this.fx?.explosion(payload.center, payload.radius)
    this.physics.applyExplosionImpulse(payload.center, payload.radius, payload.strength)
    this.stats.addMisfire()
    this.enemyAI.alert(payload.center)
    if (payload.sourceId) {
      const mesh = this.mineMeshes.get(payload.sourceId)
      if (mesh) mesh.visible = false
    }
  }

  private onShotFired = (payload: { from: Vec3; to: Vec3 }): void => {
    this.fx?.shot(payload.from, payload.to)
  }

  private onCaptureComplete = (): void => {
    this.finish(true)
  }

  private onMoveCommand = (command: {
    unitIds: UnitId[]
    position: Vec3
    queue: boolean
    forceMine: boolean
  }): void => {
    const ids = command.unitIds.length > 0 ? command.unitIds : this.squad.getSelectedIds()
    if (ids.includes('engineer') && !command.forceMine) {
      this.engineerBypassGuard = false
    }
    for (const id of ids) {
      const unit = this.store.get(id)
      if (!unit || unit.team !== 'player' || unit.state !== 'alive') continue
      const dx = command.position.x - unit.position.x
      const dz = command.position.z - unit.position.z
      unit.facing = Math.atan2(dx, dz)
      if (id === 'engineer') {
        const length = Math.hypot(dx, dz) || 1
        this.engineerForward = { x: dx / length, y: 0, z: dz / length }
      }
    }
    if (!command.forceMine) this.fx?.marker(command.position)

    if (command.forceMine) {
      if (ids.includes('engineer')) this.engineerBypassGuard = true
      return
    }
    const engineer = this.store.get('engineer')
    if (!engineer || engineer.state !== 'alive') return
    if (!ids.includes(engineer.id)) return
    if (this.clock < this.guardCooldown) return

    const dx = command.position.x - engineer.position.x
    const dz = command.position.z - engineer.position.z
    const length = Math.hypot(dx, dz)
    if (length < 0.2) return
    const mine = this.minefield.detect(
      engineer.position,
      { x: dx / length, y: 0, z: dz / length },
      DETECTOR.range,
      (DETECTOR.angleDeg * Math.PI) / 360,
    )
    if (!mine) return
    const distance = Math.hypot(mine.position.x - engineer.position.x, mine.position.z - engineer.position.z)
    if (distance > 2.8) return

    this.squad.movement.stop(engineer.id)
    this.guardCooldown = this.clock + DETECTOR.stopCooldownSec
    eventBus.emit('notify', {
      text: '前方有地雷，工兵已停下。再次右键可强行通过',
      tone: 'warn',
    })
  }

  private onInteractionRequested = (payload: { kind: string; targetId: string }): void => {
    if (payload.kind === 'attack') {
      if (this.squad.getSelectedAliveIds().length === 0) {
        eventBus.emit('notify', { text: '先选择至少一名队员', tone: 'info' })
        return
      }
      if (!this.playerCombat.focus(payload.targetId)) {
        eventBus.emit('notify', { text: '无法攻击该目标', tone: 'info' })
      }
      return
    }

    if (payload.kind === 'defuse') {
      const engineer = this.store.get('engineer')
      if (!engineer || !this.squad.isSelected(engineer.id)) {
        eventBus.emit('notify', { text: '只有选中的工兵可以排雷', tone: 'info' })
        return
      }
      if (this.defuse.isBusy) return
      this.defuse.request(payload.targetId, engineer.id)
      return
    }

    if (payload.kind === 'rescue') {
      const rescuer = this.squad.getSelectedAliveIds()[0]
      this.rescue.request(payload.targetId, rescuer)
    }
  }

  // ---------------------------------------------------------------- helpers

  /** Soft Rapier-assisted spacing: characters ignore each other's capsules
   * while moving, then this pass pushes overlapping bodies apart. */
  private separateUnits(): void {
    const units = this.store.alive()
    const minDistance = 0.7
    for (let i = 0; i < units.length; i += 1) {
      for (let j = i + 1; j < units.length; j += 1) {
        const a = units[i]
        const b = units[j]
        const dx = b.position.x - a.position.x
        const dz = b.position.z - a.position.z
        const distance = Math.hypot(dx, dz)
        if (distance >= minDistance) continue
        const push = distance < 1e-4 ? minDistance * 0.5 : (minDistance - distance) * 0.5
        const nx = distance < 1e-4 ? 1 : dx / distance
        const nz = distance < 1e-4 ? 0 : dz / distance
        this.pushUnit(a.id, a.position.x - nx * push, a.position.z - nz * push)
        this.pushUnit(b.id, b.position.x + nx * push, b.position.z + nz * push)
      }
    }
  }

  private pushUnit(id: UnitId, x: number, z: number): void {
    const unit = this.store.get(id)
    if (!unit) return
    const character = this.characters.get(id)
    const desired = { x, y: 0, z }
    const actual = character ? this.physics.moveCharacter(character, desired) : desired
    unit.position = { ...actual }
    if (unit.team === 'player') this.squad.movement.setPosition(id, actual)
  }

  private isBusy(unitId: UnitId): boolean {
    return (this.defuse.isBusy && this.defuse.engineer === unitId)
      || this.rescue.activeRescuerId === unitId
  }

  private spawnRagdoll(unitId: UnitId, downed: boolean): void {
    if (this.ragdolls.has(unitId)) return
    const unit = this.store.get(unitId)
    const visual = this.visuals.get(unitId)
    if (!unit || !visual) return
    const ragdoll = new RagdollComponent(
      this.scene,
      this.physics,
      visual,
      unit.role,
      unit.team,
      unit.position,
      unit.facing,
    )
    ragdoll.setDowned(downed && unit.team === 'player')
    ragdoll.activate()
    this.ragdolls.set(unitId, ragdoll)
    this.ragdollSince.set(unitId, this.clock)
  }

  private captureContext(): { aliveUnitPositions: Vec3[]; enemiesAliveInZone: number } {
    return {
      aliveUnitPositions: this.store.alive('player').map((unit) => ({ ...unit.position })),
      enemiesAliveInZone: this.store.alive('enemy').filter(
        (unit) =>
          Math.hypot(
            unit.position.x - this.level.radio.position.x,
            unit.position.z - this.level.radio.position.z,
          ) <= CAPTURE.enemyBlockRadius,
      ).length,
    }
  }

  private checkRagdolls(): void {
    for (const [unitId, ragdoll] of this.ragdolls) {
      const since = this.ragdollSince.get(unitId) ?? this.clock
      if (this.clock - since < 3) continue
      const center = ragdoll.getCenter()
      if (center.y > 1.8 || center.y < -0.8) {
        ragdoll.resetToGround()
        this.ragdollSince.set(unitId, this.clock)
      }
    }
  }

  private syncWorld(_dt: number): void {
    for (const unit of this.store.all()) {
      if (unit.state === 'alive' && Math.abs(unit.position.y) > 1e-4) unit.position.y = 0
      const visual = this.visuals.get(unit.id)
      if (!visual) continue
      if (unit.state === 'alive') {
        visual.setVisible(true)
        visual.setTransform(unit.position, unit.facing)
        const previous = this.prevPositions.get(unit.id)
        const moved = previous
          ? Math.hypot(previous.x - unit.position.x, previous.z - unit.position.z) > 0.004
          : false
        const isPlayerMoving = unit.team === 'player' && this.squad.movement.isMoving(unit.id)
        visual.setWalking(moved || isPlayerMoving ? 1 : 0, this.clock)
      } else {
        visual.setVisible(false)
      }
      this.prevPositions.set(unit.id, { ...unit.position })
    }
  }

  private syncMines(): void {
    for (const mine of this.minefield.mines) {
      const mesh = this.mineMeshes.get(mine.id)
      if (!mesh) continue
      if (mine.defused) {
        mesh.visible = false
        continue
      }
      if (mine.triggered) {
        const hideAt = this.mineHideAt.get(mine.id) ?? 0
        mesh.visible = this.clock < hideAt && Math.floor(this.clock * 18) % 2 === 0
        continue
      }
      mesh.visible = mine.revealed
    }
  }

  private syncSelectionRings(dt: number): void {
    const selected = this.selectedSnapshot
    let index = 0
    for (const ring of this.selectionRings) {
      const id = selected[index]
      const unit = id ? this.store.get(id) : undefined
      if (!unit || unit.state !== 'alive') {
        ring.visible = false
        index += 1
        continue
      }
      ring.visible = true
      ring.position.set(unit.position.x, 0.045, unit.position.z)
      const material = ring.material as THREE.MeshBasicMaterial
      material.opacity = 0.55 + Math.sin(this.clock * 4 + index) * 0.2
      index += 1
    }
    void dt
  }

  private emitStats(): void {
    eventBus.emit('statsUpdate', { stats: this.stats.snapshot() })
  }

  private finish(win: boolean): void {
    if (this.over) return
    this.over = true
    const elapsed = this.stats.snapshot().elapsedSeconds
    let reason = '电台已占领'
    if (!win) {
      const last = this.lastDownId ? this.store.get(this.lastDownId) : undefined
      const distance = last
        ? Math.hypot(
            last.position.x - this.level.radio.position.x,
            last.position.z - this.level.radio.position.z,
          )
        : 0
      reason = last
        ? `全队失去战斗力：${last.displayName} 在距离电台 ${distance.toFixed(1)} 米处倒下，共触发 ${this.stats.snapshot().misfires} 颗地雷。`
        : `全队失去战斗力，共触发 ${this.stats.snapshot().misfires} 颗地雷。`
    }
    this.stats.setFailureReason(reason)
    const stats = this.stats.snapshot()
    eventBus.emit('gameOver', { win, reason, stats })
    if (win) {
      eventBus.emit('audioPlay', { sfx: 'victory', volume: 0.9 })
    }
    eventBus.emit('notify', {
      text: win ? `任务完成！用时 ${elapsed.toFixed(0)} 秒` : '任务失败',
      tone: win ? 'success' : 'warn',
    })
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material.dispose()
  })
  root.removeFromParent()
}

