import type {
  HealthComponent,
  Team,
  UnitId,
  UnitRecord,
  UnitState,
  Vec3,
} from '../Data/Types'

export type { UnitRecord }

/** Single source of truth for gameplay state (position, hp, state) of every unit. */
export class UnitStore {
  private readonly records = new Map<UnitId, UnitRecord>()

  add(record: Omit<UnitRecord, 'facing' | 'state'> & Partial<Pick<UnitRecord, 'facing' | 'state'>>): UnitRecord {
    const unit: UnitRecord = {
      ...record,
      position: { ...record.position },
      facing: record.facing ?? 0,
      state: record.state ?? 'alive',
    }
    this.records.set(unit.id, unit)
    return unit
  }

  remove(id: UnitId): void {
    this.records.delete(id)
  }

  clear(): void {
    this.records.clear()
  }

  get(id: UnitId): UnitRecord | undefined {
    return this.records.get(id)
  }

  all(): UnitRecord[] {
    return Array.from(this.records.values())
  }

  players(): UnitRecord[] {
    return this.all().filter((unit) => unit.team === 'player')
  }

  enemies(): UnitRecord[] {
    return this.all().filter((unit) => unit.team === 'enemy')
  }

  alive(team?: Team): UnitRecord[] {
    return this.all().filter((unit) => unit.state === 'alive' && (!team || unit.team === team))
  }

  isAlive(id: UnitId): boolean {
    return this.records.get(id)?.state === 'alive'
  }

  setPosition(id: UnitId, position: Vec3): void {
    const unit = this.records.get(id)
    if (!unit) return
    unit.position = { ...position }
  }

  setFacing(id: UnitId, facing: number): void {
    const unit = this.records.get(id)
    if (unit) unit.facing = facing
  }

  setState(id: UnitId, state: UnitState): void {
    const unit = this.records.get(id)
    if (unit) unit.state = state
  }

  /** Centroid of units that still matter to the camera. */
  center(team: Team, includeDowned = true): Vec3 | null {
    const units = this.all().filter(
      (unit) => unit.team === team && (unit.state === 'alive' || (includeDowned && unit.state === 'downed')),
    )
    if (units.length === 0) return null
    let x = 0
    let y = 0
    let z = 0
    for (const unit of units) {
      x += unit.position.x
      y += unit.position.y
      z += unit.position.z
    }
    return { x: x / units.length, y: y / units.length, z: z / units.length }
  }

  snapshot(team?: Team): HealthComponent[] {
    return this.all()
      .filter((unit) => !team || unit.team === team)
      .map((unit) => ({
        unitId: unit.id,
        team: unit.team,
        role: unit.role,
        displayName: unit.displayName,
        hp: unit.hp,
        maxHp: unit.maxHp,
        state: unit.state,
      }))
  }
}
