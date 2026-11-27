export const ModelPaths = {
  engineer: 'models/squad_engineer.glb',
  rifleman: 'models/squad_rifleman.glb',
  machinegunner: 'models/squad_machinegunner.glb',
  enemyGuard: 'models/enemy_basic.glb',
} as const

export const AudioPaths = {
  detectorBeep: 'audio/detector_beep.ogg',
  explosion: 'audio/explosion.ogg',
  gunshotRifle: 'audio/gunshot_rifle.ogg',
  gunshotMg: 'audio/gunshot_mg.ogg',
  boltAction: 'audio/bolt_action.ogg',
  mineClick: 'audio/mine_click.ogg',
  victory: 'audio/victory.ogg',
} as const

export const DataPaths = {
  level01: 'data/level01.json',
  demoPath01: 'data/demoPath01.json',
} as const

export type ModelKey = keyof typeof ModelPaths
export type AudioKey = keyof typeof AudioPaths
export type DataKey = keyof typeof DataPaths

/** Resolve a public asset against Vite's base URL so `base: './'` deployments work. */
export function assetUrl(path: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('/')) return path
  const base = import.meta.env.BASE_URL || '/'
  return `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\.?\//, '')}`
}
