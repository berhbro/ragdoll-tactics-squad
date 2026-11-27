import type { EnemyType, UnitRole, WeaponStats } from '../Data/Types'

export const MAP_SIZE = 30

export const CAMERA = {
  minDistance: 10,
  maxDistance: 25,
  minPitch: 40,
  maxPitch: 65,
  followLerp: 7,
  zoomLerp: 9,
  yawLerp: 10,
  menuDistance: 24,
  menuPitchOffset: 2,
} as const

export const INPUT = {
  dragThresholdPx: 6,
  raycastIntervalFrames: 3,
} as const

export const DETECTOR = {
  range: 3,
  angleDeg: 120,
  beepIntervalFar: 0.8,
  beepIntervalNear: 0.12,
  stopCooldownSec: 3,
} as const

export const DEFUSE = {
  approachDistance: 2,
  durationSec: 3,
  failRate: 0.1,
} as const

export const MINE = {
  count: 12,
  fixedCount: 10,
  randomCount: 2,
  triggerDelaySec: 0.8,
  damage: 100,
  blastRadius: 2.5,
} as const

export const CAPTURE = {
  requiredSeconds: 10,
  radioRadius: 2.5,
  enemyBlockRadius: 6,
} as const

export const RESCUE = {
  engineerSeconds: 2,
  otherSeconds: 4,
  deathTimeoutSec: 10,
  revivedHp: 20,
  range: 2.2,
} as const

export const SQUAD = {
  followMin: 3,
  followMax: 6,
  memberCount: 3,
  spacing: 1.15,
} as const

export const ENEMY = {
  visionRange: 15,
  visionAngleDeg: 90,
  hearingRange: 20,
  attackRange: 8,
  attackStopRange: 7.2,
  patrolChaseRange: 5,
  loseSightGraceSec: 3.5,
} as const

export const UNIT = {
  radius: 0.34,
  height: 1.8,
  capsuleHalfHeight: 0.56,
} as const

export const PLAYER_WEAPONS: Record<UnitRole, WeaponStats> = {
  engineer: { range: 10, damage: 14, interval: 0.75, accuracy: 0.72, sfx: 'gunshotRifle' },
  rifleman: { range: 14, damage: 17, interval: 0.62, accuracy: 0.78, sfx: 'gunshotRifle' },
  machinegunner: { range: 16, damage: 10, interval: 0.16, accuracy: 0.58, sfx: 'gunshotMg' },
}

export interface EnemyWeaponStats extends WeaponStats {
  speed: number
  hp: number
  chaseLeash: number
}

export const ENEMY_STATS: Record<EnemyType, EnemyWeaponStats> = {
  sentinel: {
    range: 8, damage: 7, interval: 1.25, accuracy: 0.6, sfx: 'gunshotRifle',
    speed: 1.35, hp: 90, chaseLeash: 1.5,
  },
  patrol: {
    range: 8, damage: 7, interval: 1.15, accuracy: 0.62, sfx: 'gunshotRifle',
    speed: 1.55, hp: 90, chaseLeash: 5,
  },
  elite: {
    range: 8.5, damage: 11, interval: 0.85, accuracy: 0.66, sfx: 'gunshotRifle',
    speed: 1.8, hp: 150, chaseLeash: 8,
  },
}

export const PLAYER_SPEED: Record<UnitRole, number> = {
  engineer: 3.3,
  rifleman: 3.5,
  machinegunner: 2.9,
}
