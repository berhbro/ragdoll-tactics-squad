import type { UnitId, UnitRole, Vec3 } from '../Data/Types'
import { eventBus } from '../core/EventBus'
import { PLAYER_SPEED } from '../config/constants'
import type { UnitRecord, UnitStore } from '../units/UnitStore'
import { UnitMovement } from './UnitMovement'

/** Owns player selection and routes movement commands to UnitMovement. */
export class SquadManager {
  readonly movement: UnitMovement
  private selected: UnitId[] = []
  private formationEnabled = true

  constructor(
    private readonly store: UnitStore,
    movement = new UnitMovement(),
  ) {
    this.movement = movement
    eventBus.on('moveCommand', this.onMoveCommand)
    eventBus.on('selectionRequested', this.onSelectionRequested)
  }

  addUnit(id: UnitId, role: UnitRole, position: Vec3): UnitRecord {
    const speed = PLAYER_SPEED[role]
    const unit = this.store.add({
      id,
      team: 'player',
      role,
      displayName: roleName(role),
      position,
      hp: 100,
      maxHp: 100,
      speed,
    })
    this.movement.register(id, position, speed)
    this.emitSquad()
    return unit
  }

  removeUnit(id: UnitId): void {
    this.store.remove(id)
    this.movement.unregister(id)
    this.selected = this.selected.filter((selectedId) => selectedId !== id)
    this.emitSquad()
  }

  select(unitIds: UnitId[]): void {
    this.selected = Array.from(new Set(unitIds)).filter((id) => {
      const unit = this.store.get(id)
      return unit?.team === 'player' && unit.state !== 'dead'
    })
    eventBus.emit('unitSelected', { unitIds: [...this.selected] })
  }

  getSelectedIds(): UnitId[] {
    return [...this.selected]
  }

  getSelectedAliveIds(): UnitId[] {
    return this.selected.filter((id) => this.store.isAlive(id))
  }

  isSelected(id: UnitId): boolean {
    return this.selected.includes(id)
  }

  getUnit(id: UnitId): UnitRecord | undefined {
    return this.store.get(id)
  }

  getAlivePositions(): Vec3[] {
    return this.store.alive('player').map((unit) => ({ ...unit.position }))
  }

  getAliveUnitsWithPositions(): { id: UnitId; position: Vec3 }[] {
    return this.store.alive('player').map((unit) => ({ id: unit.id, position: { ...unit.position } }))
  }

  update(dt: number): void {
    this.movement.update(dt)
    for (const unit of this.store.players()) {
      const position = this.movement.getPosition(unit.id)
      if (position) unit.position = position
    }
  }

  setFormationEnabled(enabled: boolean): void {
    this.formationEnabled = enabled
  }

  stopSelected(): void {
    this.selected.forEach((id) => this.movement.stop(id))
  }

  resetMovement(): void {
    this.movement.reset()
    this.emitSquad()
  }

  emitSquad(): void {
    eventBus.emit('squadUpdate', { units: this.store.snapshot('player') })
  }

  dispose(): void {
    eventBus.off('moveCommand', this.onMoveCommand)
    eventBus.off('selectionRequested', this.onSelectionRequested)
  }

  private onSelectionRequested = ({ unitIds }: { unitIds: UnitId[] }): void => {
    this.select(unitIds)
  }

  private formationTarget(position: Vec3, id: UnitId, index: number, count: number): Vec3 {
    if (!this.formationEnabled || count <= 1) return { ...position }
    const offsets: Record<string, Vec3> = {
      engineer: { x: 0, y: 0, z: 0 },
      rifleman: { x: -2.4, y: 0, z: 0.8 },
      machinegunner: { x: 2.4, y: 0, z: 0.8 },
    }
    const offset = offsets[id] ?? { x: (index - (count - 1) / 2) * 1.7, y: 0, z: 0 }
    return {
      x: Math.max(0.6, Math.min(29.4, position.x + offset.x)),
      y: position.y,
      z: Math.max(0.6, Math.min(29.4, position.z + offset.z)),
    }
  }

  private onMoveCommand = (command: {
    unitIds: UnitId[]
    position: Vec3
    queue: boolean
    forceMine: boolean
  }): void => {
    const requested = command.unitIds.length > 0 ? command.unitIds : this.selected
    const ids = requested.filter((id) => {
      const unit = this.store.get(id)
      return unit?.team === 'player' && unit.state === 'alive'
    })
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index]
      const unit = this.store.get(id)
      if (!unit) continue
      const target = this.formationTarget(command.position, id, index, ids.length)
      this.movement.setPosition(id, unit.position)
      if (command.queue) this.movement.queueMove(id, target)
      else if (command.forceMine) this.movement.forceMoveThroughMine(id, target)
      else this.movement.moveTo(id, target)
    }
  }
}

export function roleName(role: UnitRole): string {
  switch (role) {
    case 'engineer':
      return '工兵'
    case 'rifleman':
      return '步枪手'
    case 'machinegunner':
      return '机枪手'
  }
}
