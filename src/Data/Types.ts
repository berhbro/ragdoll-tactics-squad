// ============ 基础类型 ============
export interface Vec3 {
  x: number
  y: number
  z: number
}

export type UnitId = string
export type MineId = string

export type Team = 'player' | 'enemy'

export interface WeaponStats {
  range: number
  damage: number
  interval: number
  accuracy: number
  sfx: SfxName
}
export type UnitRole = 'engineer' | 'rifleman' | 'machinegunner'
export type EnemyType = 'sentinel' | 'patrol' | 'elite'
export type UnitState = 'alive' | 'downed' | 'dead'

/** The visual / gameplay archetype of a unit. Enemies share one archetype. */
export type UnitKind = UnitRole | 'enemy'

export type SfxName =
  | 'detectorBeep'
  | 'explosion'
  | 'gunshotRifle'
  | 'gunshotMg'
  | 'boltAction'
  | 'mineClick'
  | 'victory'

// ============ Level ============
export interface CoverData {
  position: Vec3
  size: Vec3
  type: 'tree' | 'wall' | 'rock'
}

export interface FixedMineData {
  id: MineId
  position: Vec3
}

export interface RandomMineZone {
  zoneId: string
  description?: string
  count: number
  candidateRegion: { min: Vec3; max: Vec3 }
  candidatePoints: Vec3[]
  seed: string
}

export interface EnemySpawnData {
  id: UnitId
  type: EnemyType
  spawn: Vec3
  patrolPoints?: Vec3[]
  defenseArea?: { min: Vec3; max: Vec3 }
}

export interface LevelData {
  version: string
  name: string
  mapSize: { width: number; depth: number }
  designUnit?: number
  playerSpawn: Vec3
  radio: { position: Vec3; radius: number }
  covers: CoverData[]
  fixedMines: FixedMineData[]
  randomMines: RandomMineZone[]
  randomMineSeed: number
  enemies: EnemySpawnData[]
}

// ============ 战斗 ============
export interface DamageEvent {
  targetId: UnitId
  sourceId?: UnitId
  amount: number
  damageType: 'bullet' | 'mine' | 'explosion'
  hitPoint?: Vec3
  impulse?: Vec3
}

export interface ExplosionImpulseEvent {
  center: Vec3
  radius: number
  strength: number
  sourceId?: UnitId
}

export interface UnitRecord {
  id: UnitId
  team: Team
  role: UnitKind
  displayName: string
  position: Vec3
  facing: number
  hp: number
  maxHp: number
  state: UnitState
  speed: number
}

export interface HealthComponent {
  unitId: UnitId
  team: Team
  role: UnitKind
  displayName: string
  hp: number
  maxHp: number
  state: UnitState
}

export interface GameStats {
  elapsedSeconds: number
  misfires: number
  downs: number
  failureReason?: string
}

export type GamePhase = 'menu' | 'playing' | 'paused' | 'won' | 'lost' | 'demo'

// ============ 交互 ============
export type InteractionKind = 'attack' | 'defuse' | 'rescue'
export type InteractionTargetType = 'enemy' | 'downedAlly' | 'mine'

export const KIND_BY_TARGET_TYPE: Record<InteractionTargetType, InteractionKind> = {
  enemy: 'attack',
  downedAlly: 'rescue',
  mine: 'defuse',
}

export interface HoverInfo {
  kind: InteractionKind
  targetType: InteractionTargetType
  id: string
  distance: number
}

// ============ 占领 ============
export type CaptureStatus = 'idle' | 'capturing' | 'paused' | 'complete'

export interface CaptureState {
  progress: number
  requiredSeconds: number
  inRangeAliveUnits: number
  enemiesAliveInZone: number
  status: CaptureStatus
  interruptedReason?: string
}

// ============ Ragdoll ============
export interface RagdollComponentConfig {
  bodyCount?: 6 | 7 | 8
}

// ============ Demo ============
export type DemoAction =
  | { type: 'select'; unitIds: UnitId[] }
  | { type: 'move'; unitIds: UnitId[]; position: Vec3 }
  | { type: 'queueMove'; unitIds: UnitId[]; position: Vec3 }
  | { type: 'interact'; targetType: InteractionTargetType; targetId: string }
  | { type: 'wait'; ms: number }
  | { type: 'capture' }
  | { type: 'end'; result: 'win' | 'lose' }

export interface DemoActionWithTime {
  t: number
  action: DemoAction
}

export interface DemoScript {
  seed: number
  actions: DemoActionWithTime[]
}

// ============ 事件 payload ============
export interface AudioPlayPayload {
  sfx: SfxName
  volume?: number
  position?: Vec3
}

export interface CaptureProgressPayload {
  progress: number
  requiredSeconds: number
  inRangeAliveUnits: number
  status: CaptureStatus
}

export interface CaptureCompletePayload {
  elapsedSeconds: number
}

export interface MinePulsePayload {
  intensity: number
}

export interface EnemyDeathPayload {
  unitId: UnitId
  position: Vec3
}

export interface UnitDownedPayload {
  unitId: UnitId
}

export interface UnitRevivedPayload {
  unitId: UnitId
  hp: number
}

export interface GameOverPayload {
  win: boolean
  reason: string
  stats: GameStats
}

export interface NotificationPayload {
  text: string
  tone?: 'info' | 'warn' | 'success'
}
