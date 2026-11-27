import type { MineId, UnitId, Vec3 } from '../Data/Types'

export interface DetectorAPI {
  setEnabled(enabled: boolean): void
  update(dt: number, engineerId: UnitId): void
  getMineAhead(engineerId: UnitId): { mineId: MineId; position: Vec3; distance: number } | null
  isBeeping(engineerId: UnitId): boolean
}

export interface MovementCommand {
  moveTo(unitId: UnitId, position: Vec3): void
  queueMove(unitId: UnitId, position: Vec3): void
  stop(unitId: UnitId): void
  forceMoveThroughMine(unitId: UnitId, position: Vec3): void
  isMoving(unitId: UnitId): boolean
}
