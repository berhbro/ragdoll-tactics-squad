import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { ModelPaths, assetUrl } from '../config/assets'
import { UnitVisual, type UnitVisualConfig, type VisualRole } from '../units/UnitVisual'

export const MODEL_PATHS: Record<VisualRole, string> = {
  engineer: ModelPaths.engineer,
  rifleman: ModelPaths.rifleman,
  machinegunner: ModelPaths.machinegunner,
  enemy: ModelPaths.enemyGuard,
}

export interface AssetLoaderOptions {
  loader?: GLTFLoader
}

/** Loads each source once and clones skeletons for independent unit instances. */
export class AssetLoader {
  private readonly loader: GLTFLoader
  private readonly cache = new Map<VisualRole, Promise<GLTF>>()

  constructor(options: AssetLoaderOptions = {}) {
    this.loader = options.loader ?? new GLTFLoader()
  }

  async loadUnitAsset(role: VisualRole): Promise<GLTF> {
    const cached = this.cache.get(role)
    if (cached) return cached
    const path = assetUrl(MODEL_PATHS[role])
    const request = this.loader.loadAsync(path).catch((error) => {
      this.cache.delete(role)
      throw new Error(`Failed to load ${role} model at ${path}: ${String(error)}`)
    })
    this.cache.set(role, request)
    return request
  }

  async loadAllUnitAssets(): Promise<Record<VisualRole, GLTF>> {
    const roles: VisualRole[] = ['engineer', 'rifleman', 'machinegunner', 'enemy']
    const entries = await Promise.all(
      roles.map(async (role) => [role, await this.loadUnitAsset(role)] as const),
    )
    return Object.fromEntries(entries) as Record<VisualRole, GLTF>
  }

  async createUnitVisual(config: UnitVisualConfig): Promise<UnitVisual> {
    const asset = await this.loadUnitAsset(config.role)
    const visual = new UnitVisual(config.unitId, config.role, config)
    const clone = cloneSkeleton(asset.scene)
    clone.traverse((object) => {
      object.castShadow = config.castShadow ?? true
      object.receiveShadow = config.receiveShadow ?? true
    })
    visual.mount(clone)
    return visual
  }

  clearCache(): void {
    this.cache.clear()
  }
}
