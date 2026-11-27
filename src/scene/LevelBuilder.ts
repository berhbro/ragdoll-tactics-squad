import type {
  CoverData,
  EnemySpawnData,
  FixedMineData,
  LevelData,
  RandomMineZone,
  Vec3,
} from '../Data/Types'
import { assetUrl } from '../config/assets'

export interface LevelRuntimeData {
  mapSize: { width: number; depth: number }
  playerSpawn: Vec3
  radio: { position: Vec3; radius: number }
  covers: CoverData[]
  fixedMines: FixedMineData[]
  randomMines: RandomMineZone[]
  randomMineSeed: number
  randomMineCount: number
  enemies: EnemySpawnData[]
}

/** Converts level JSON into immutable runtime spawn data. */
export class LevelBuilder {
  static fromData(data: LevelData): LevelRuntimeData {
    if (!data || !Array.isArray(data.enemies) || !Array.isArray(data.covers)) {
      throw new Error('Invalid level data: covers and enemies are required')
    }
    if (data.enemies.some((enemy) => !enemy.id || !enemy.spawn)) {
      throw new Error('Invalid enemy spawn data')
    }
    return {
      mapSize: { ...data.mapSize },
      playerSpawn: { ...data.playerSpawn },
      radio: { position: { ...data.radio.position }, radius: data.radio.radius },
      covers: data.covers.map((cover) => ({
        ...cover,
        position: { ...cover.position },
        size: { ...cover.size },
      })),
      fixedMines: data.fixedMines.map((mine) => ({ id: mine.id, position: { ...mine.position } })),
      randomMines: (data.randomMines ?? []).map((zone) => ({
        ...zone,
        candidateRegion: {
          min: { ...zone.candidateRegion.min },
          max: { ...zone.candidateRegion.max },
        },
        candidatePoints: zone.candidatePoints.map((point) => ({ ...point })),
      })),
      randomMineSeed: data.randomMineSeed,
      randomMineCount: (data.randomMines ?? []).reduce((total, zone) => total + zone.count, 0),
      enemies: data.enemies.map((enemy) => ({
        ...enemy,
        spawn: { ...enemy.spawn },
        patrolPoints: enemy.patrolPoints?.map((point) => ({ ...point })),
        defenseArea: enemy.defenseArea
          ? { min: { ...enemy.defenseArea.min }, max: { ...enemy.defenseArea.max } }
          : undefined,
      })),
    }
  }

  static async load(url: string = 'data/level01.json'): Promise<LevelRuntimeData> {
    const response = await fetch(assetUrl(url))
    if (!response.ok) throw new Error(`Failed to load level ${url}: ${response.status}`)
    return LevelBuilder.fromData((await response.json()) as LevelData)
  }
}
