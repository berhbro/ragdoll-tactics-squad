export const Layers = {
  Default: 0,
  Terrain: 1,
  Target: 2,
  Unit: 3,
} as const

export const RaycastTargetLayer = Layers.Target
export const RaycastOcclusionLayer = Layers.Terrain

export const LayerNames = {
  [Layers.Default]: 'default',
  [Layers.Terrain]: 'terrain',
  [Layers.Target]: 'target',
  [Layers.Unit]: 'unit',
} as const
