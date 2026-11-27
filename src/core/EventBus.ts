import type {
  AudioPlayPayload,
  CaptureCompletePayload,
  CaptureProgressPayload,
  DamageEvent,
  EnemyDeathPayload,
  ExplosionImpulseEvent,
  GameOverPayload,
  GamePhase,
  GameStats,
  HealthComponent,
  HoverInfo,
  InteractionKind,
  MineId,
  MinePulsePayload,
  NotificationPayload,
  UnitDownedPayload,
  UnitId,
  UnitRevivedPayload,
  UnitState,
  Vec3,
} from '../Data/Types'

export interface EventMap {
  // 已有
  audioPlay: AudioPlayPayload
  captureProgress: CaptureProgressPayload
  captureComplete: CaptureCompletePayload
  minePulse: MinePulsePayload
  damage: DamageEvent
  enemyDeath: EnemyDeathPayload
  unitDowned: UnitDownedPayload
  unitRevived: UnitRevivedPayload
  gameOver: GameOverPayload

  // 单位
  unitSelected: { unitIds: UnitId[] }
  unitStateChanged: { unitId: UnitId; state: UnitState }
  unitDied: { unitId: UnitId }

  // 指令
  moveCommand: { unitIds: UnitId[]; position: Vec3; queue: boolean; forceMine: boolean }
  selectionRequested: { unitIds: UnitId[] }
  interactionRequested: { kind: InteractionKind; targetId: string }
  notify: NotificationPayload
  cameraShake: { strength: number }

  // 战斗
  shotFired: { unitId: UnitId; from: Vec3; to: Vec3 }
  explosionImpulse: ExplosionImpulseEvent

  // 地雷/排雷
  mineDetected: { mineId: MineId; position: Vec3 }
  mineTriggered: { mineId: MineId; position: Vec3; victims: UnitId[] }
  mineDefused: { mineId: MineId }
  defuseStarted: { mineId: MineId; engineerId: UnitId; durationMs: number }
  defuseProgress: { mineId: MineId; progress: number }
  defuseCompleted: { mineId: MineId; success: boolean }
  defuseCancelled: { mineId: MineId }

  // 救援
  rescueStarted: { targetId: UnitId; rescuerId: UnitId; durationMs: number }
  rescueProgress: { targetId: UnitId; progress: number }
  rescueCompleted: { targetId: UnitId; rescuerId: UnitId }
  rescueCancelled: { targetId: UnitId }

  // 交互/悬停
  hoverChanged: { target: HoverInfo | null }

  // 占领中断
  captureInterrupted: { reason: string }

  // 游戏状态/统计
  gameStateChanged: { state: GamePhase }
  statsUpdate: { stats: GameStats }
  squadUpdate: { units: HealthComponent[] }

  // UI commands (consumed by the host game when available)
  muteToggle: undefined
  resumeRequest: undefined
  restartRequest: undefined
  mainMenuRequest: undefined
  pauseToggle: undefined
}

export type EventName = keyof EventMap
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void

type AnyHandler = (payload: unknown) => void

export class EventBus {
  private handlers = new Map<EventName, Set<AnyHandler>>()

  on<K extends EventName>(name: K, fn: EventHandler<K>): void {
    let set = this.handlers.get(name)
    if (!set) {
      set = new Set()
      this.handlers.set(name, set)
    }
    set.add(fn as AnyHandler)
  }

  off<K extends EventName>(name: K, fn: EventHandler<K>): void {
    this.handlers.get(name)?.delete(fn as AnyHandler)
  }

  once<K extends EventName>(name: K, fn: EventHandler<K>): void {
    const wrapper: EventHandler<K> = (payload) => {
      this.off(name, wrapper)
      fn(payload)
    }
    this.on(name, wrapper)
  }

  emit<K extends EventName>(name: K, payload: EventMap[K]): void {
    const set = this.handlers.get(name)
    if (!set || set.size === 0) return
    for (const fn of Array.from(set)) {
      try {
        ;(fn as EventHandler<K>)(payload)
      } catch (err) {
        console.error(`[EventBus] handler error for "${name}"`, err)
      }
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}

export const eventBus = new EventBus()

export const EventNames = {
  AudioPlay: 'audioPlay',
  CaptureProgress: 'captureProgress',
  CaptureComplete: 'captureComplete',
  MinePulse: 'minePulse',
  Damage: 'damage',
  EnemyDeath: 'enemyDeath',
  UnitDowned: 'unitDowned',
  UnitRevived: 'unitRevived',
  GameOver: 'gameOver',

  UnitSelected: 'unitSelected',
  UnitStateChanged: 'unitStateChanged',
  UnitDied: 'unitDied',
  
  MoveCommand: 'moveCommand',
  SelectionRequested: 'selectionRequested',
  InteractionRequested: 'interactionRequested',
  Notify: 'notify',
  CameraShake: 'cameraShake',

  ShotFired: 'shotFired',
  ExplosionImpulse: 'explosionImpulse',
  MineDetected: 'mineDetected',
  MineTriggered: 'mineTriggered',
  MineDefused: 'mineDefused',
  DefuseStarted: 'defuseStarted',
  DefuseProgress: 'defuseProgress',
  DefuseCompleted: 'defuseCompleted',
  DefuseCancelled: 'defuseCancelled',
  RescueStarted: 'rescueStarted',
  RescueProgress: 'rescueProgress',
  RescueCompleted: 'rescueCompleted',
  RescueCancelled: 'rescueCancelled',
  HoverChanged: 'hoverChanged',
  CaptureInterrupted: 'captureInterrupted',
  GameStateChanged: 'gameStateChanged',
  StatsUpdate: 'statsUpdate',
  SquadUpdate: 'squadUpdate',
  MuteToggle: 'muteToggle',
  ResumeRequest: 'resumeRequest',
  RestartRequest: 'restartRequest',
  MainMenuRequest: 'mainMenuRequest',
} as const satisfies Record<string, EventName>
