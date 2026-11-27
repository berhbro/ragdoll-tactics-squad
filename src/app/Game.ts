import * as THREE from 'three'
import { InputManager } from '../input/InputManager'
import { InteractionManager } from '../interaction/InteractionManager'
import { HoverIndicator } from '../interaction/HoverIndicator'
import { GameState } from '../core/GameState'
import { GameLoop } from '../core/GameLoop'
import { TacticalCamera } from '../camera/TacticalCamera'
import { eventBus } from '../core/EventBus'
import { AudioManager } from '../audio/AudioManager'
import { UIManager } from '../ui/UIManager'
import { AssetLoader } from '../managers/AssetLoader'
import { SelectionSystem } from '../systems/SelectionSystem'
import { LevelBuilder, type LevelRuntimeData } from '../scene/LevelBuilder'
import { DataPaths, assetUrl } from '../config/assets'
import { Battle, type BattleMode } from './Battle'
import { DemoPlayer } from '../demo/DemoPlayer'
import { KIND_BY_TARGET_TYPE } from '../Data/Types'
import type {
  DemoScript,
  GameOverPayload,
  GamePhase,
  InteractionKind,
  UnitId,
  UnitRole,
  Vec3,
} from '../Data/Types'

const ROLE_ORDER: UnitRole[] = ['engineer', 'rifleman', 'machinegunner']

/**
 * Application shell: renderer, input, camera, menus and mission lifecycle.
 * Gameplay itself lives in Battle and its systems.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly canvas: HTMLCanvasElement
  private readonly input: InputManager
  private readonly interaction: InteractionManager
  private readonly hoverIndicator: HoverIndicator
  private readonly tacticalCamera: TacticalCamera
  private readonly state = new GameState()
  private readonly audio = new AudioManager()
  private readonly ui: UIManager
  private readonly assets = new AssetLoader()
  private readonly loop: GameLoop

  private level: LevelRuntimeData | null = null
  private battle: Battle | null = null
  private selection: SelectionSystem | null = null
  private demo: DemoPlayer | null = null
  private mode: BattleMode = 'normal'
  private pausedFrom: GamePhase = 'playing'
  private runToken = 0
  private boxStart = new THREE.Vector2()
  private menuTimer = 0
  private started = false
  private lastTarget: Vec3 = { x: 15, y: 0, z: 15 }

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)
    this.canvas = this.renderer.domElement
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xa8c4cf)
    this.scene.fog = new THREE.Fog(0xa8c4cf, 42, 92)

    this.camera = new THREE.PerspectiveCamera(
      50,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      220,
    )
    this.camera.position.set(12, 18, 28)

    const hemi = new THREE.HemisphereLight(0xd9ecff, 0x3b4a2f, 1.15)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff0c7, 2.1)
    sun.position.set(18, 30, 12)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -24
    sun.shadow.camera.right = 24
    sun.shadow.camera.top = 24
    sun.shadow.camera.bottom = -24
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 70
    sun.shadow.bias = -0.0006
    this.scene.add(sun)
    this.scene.add(sun.target)
    sun.target.position.set(15, 0, 15)

    this.input = new InputManager(this.canvas)
    this.interaction = new InteractionManager(this.scene, this.camera, this.input, this.canvas)
    this.hoverIndicator = new HoverIndicator(this.scene)
    this.tacticalCamera = new TacticalCamera(this.camera, this.input)

    const uiRoot = document.createElement('div')
    uiRoot.id = 'ui-root'
    container.appendChild(uiRoot)
    this.ui = new UIManager(
      uiRoot,
      {
        onStart: () => void this.startRun('normal'),
        onDemo: () => void this.startRun('demo'),
        onResume: () => this.resumeGame(),
        onRestart: () => void this.startRun(this.mode),
        onMenu: () => void this.returnToMenu(),
        onToggleMute: () => this.toggleMute(),
        onVolume: (volume) => {
          this.audio.unlock()
          this.audio.setVolume(volume)
        },
      },
      this.audio.getMuted(),
    )
    this.ui.setVolume(this.audio.getVolume())

    this.wireInput()
    eventBus.on('cameraShake', this.onCameraShake)
    eventBus.on('gameOver', this.onGameOver)
    window.addEventListener('resize', this.onResize)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('pointerdown', this.onFirstPointer, { once: true })

    this.loop = new GameLoop(this.onUpdate, this.onFixedUpdate, this.onRender)
    this.tacticalCamera.setTargetImmediate({ x: 15, y: 0, z: 15 })
    this.tacticalCamera.setDistance(24)
    this.tacticalCamera.setYaw(0.55)
    this.tacticalCamera.setEnabled(false)

    if (import.meta.env.DEV) this.installDebugApi()
  }

  async init(): Promise<void> {
    this.ui.showLoading(true, '正在加载战场…')
    try {
      await this.assets.loadAllUnitAssets()
      this.level = await LevelBuilder.load(DataPaths.level01)
      await this.buildPreview()
      this.ui.setPhase('menu')
      this.state.setPhase('menu')
      this.ui.showLoading(false)
    } catch (error) {
      console.error('[Game] init failed', error)
      this.ui.showLoading(true, `加载失败：${String(error)}`)
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.loop.start()
  }

  // --------------------------------------------------------------- lifecycle

  private async buildPreview(): Promise<void> {
    if (!this.level) return
    this.disposeBattle()
    const battle = new Battle(this.scene, this.assets, this.level, 'normal')
    await battle.build()
    this.battle = battle
    this.selection = new SelectionSystem(this.camera, this.canvas, battle.squad, battle.getVisuals())
    this.tacticalCamera.setTargetImmediate({ x: 15, y: 0, z: 15 })
    this.tacticalCamera.setDistance(24)
    this.tacticalCamera.setYaw(0.55)
    this.tacticalCamera.setEnabled(false)
    this.input.disable()
  }

  private async startRun(mode: BattleMode): Promise<void> {
    if (!this.level) return
    const token = ++this.runToken
    window.clearTimeout(this.menuTimer)
    this.ui.showLoading(true, mode === 'demo' ? '正在准备演示…' : '正在部署小队…')
    this.input.disable()
    this.demo?.stop()
    this.demo = null
    this.disposeBattle()

    let created: Battle | null = null
    try {
      created = new Battle(this.scene, this.assets, this.level, mode)
      await created.build()
      if (token !== this.runToken) {
        created.dispose()
        return
      }
      const battle = created
      this.battle = battle
      this.mode = mode
      this.selection = new SelectionSystem(this.camera, this.canvas, battle.squad, battle.getVisuals())
      const target = battle.getCameraTarget() ?? { x: 15, y: 0, z: 15 }
      this.lastTarget = target
      this.tacticalCamera.setTargetImmediate(target)
      this.tacticalCamera.setDistance(18)
      this.tacticalCamera.setYaw(0)
      this.tacticalCamera.setEnabled(true)
      this.audio.unlock()

      if (mode === 'demo') {
        this.state.setPhase('demo')
        this.input.disable()
        await this.loadDemo(battle)
      } else {
        this.state.setPhase('playing')
        battle.selectAll()
        this.input.enable()
      }
      this.ui.showLoading(false)
    } catch (error) {
      created?.dispose()
      console.error('[Game] start failed', error)
      this.ui.showLoading(false)
      this.ui.setPhase('menu')
      this.state.setPhase('menu')
      eventBus.emit('notify', { text: `启动失败：${String(error)}`, tone: 'warn' })
    }
  }

  private async returnToMenu(): Promise<void> {
    this.runToken += 1
    window.clearTimeout(this.menuTimer)
    this.demo?.stop()
    this.demo = null
    this.ui.showLoading(true, '正在返回主菜单…')
    this.state.setPhase('menu')
    this.input.disable()
    this.tacticalCamera.setEnabled(false)
    await this.buildPreview()
    this.ui.setPhase('menu')
    this.ui.showLoading(false)
  }

  private disposeBattle(): void {
    this.demo?.stop()
    this.demo = null
    this.selection = null
    this.battle?.dispose()
    this.battle = null
    this.interaction.clear()
    this.hoverIndicator.update(null, 0)
  }

  private async loadDemo(battle: Battle): Promise<void> {
    const response = await fetch(assetUrl(DataPaths.demoPath01))
    if (!response.ok) throw new Error(`演示脚本加载失败 (${response.status})`)
    const script = (await response.json()) as DemoScript
    this.demo = new DemoPlayer({
      onInputEnabledChange: () => {
        // The demo owns the squad; player input stays off even when the runner
        // briefly reports enabled.
        this.input.disable()
      },
      onStatusChange: () => {},
      onComplete: (result) => this.finishDemo(result),
      commandContext: {
        select: (unitIds: string[]) => eventBus.emit('selectionRequested', { unitIds }),
        move: (unitIds: string[], position: Vec3, queued: boolean) =>
          eventBus.emit('moveCommand', {
            unitIds,
            position,
            queue: queued,
            forceMine: true,
          }),
        interact: (targetType, targetId) => {
          const kind = KIND_BY_TARGET_TYPE[targetType] as InteractionKind
          eventBus.emit('interactionRequested', { kind, targetId })
        },
        capture: () => {},
        end: (result) => this.finishDemo(result),
        wait: () => {},
      },
    })
    this.demo.load(script)
    this.demo.play()
    void battle
  }

  private finishDemo(_result: 'win' | 'lose'): void {
    if (this.state.getPhase() !== 'demo') return
    this.demo?.stop()
    this.input.disable()
    eventBus.emit('notify', { text: '演示结束，返回主菜单', tone: 'info' })
    window.clearTimeout(this.menuTimer)
    this.menuTimer = window.setTimeout(() => {
      if (this.state.getPhase() === 'demo') void this.returnToMenu()
    }, 1400)
  }

  private onGameOver = (payload: GameOverPayload): void => {
    if (this.state.isOver()) return
    this.state.setPhase(payload.win ? 'won' : 'lost')
    this.input.disable()
    this.demo?.stop()
    this.tacticalCamera.setEnabled(true)
    if (this.mode === 'demo') {
      window.clearTimeout(this.menuTimer)
      this.menuTimer = window.setTimeout(() => {
        if (this.state.isOver()) void this.returnToMenu()
      }, 3600)
    }
  }

  // ------------------------------------------------------------------- input

  private wireInput(): void {
    this.input.on('selectStart', (payload) => {
      if (!this.canSelect()) return
      this.boxStart.set(payload.x, payload.y)
      this.ui.hideSelectionBox()
    })
    this.input.on('selectMove', (payload) => {
      if (!this.canSelect()) return
      if (payload.dragging) {
        this.ui.showSelectionBox(payload.startX, payload.startY, payload.x, payload.y)
      }
    })
    this.input.on('selectEnd', (payload) => {
      if (!this.canSelect() || !this.selection) return
      this.ui.hideSelectionBox()
      if (payload.isDrag) {
        this.selection.handleBox(this.boxStart.x, this.boxStart.y, payload.x, payload.y, payload.queue)
      } else {
        this.selection.handleClick(payload.x, payload.y, payload.queue)
      }
    })
    this.input.on('moveTo', (payload) => this.onMoveTo(payload))
    this.input.on('quickSelect', ({ slot }) => {
      if (!this.canSelect()) return
      const role = ROLE_ORDER[slot - 1]
      eventBus.emit('selectionRequested', { unitIds: [role] })
    })
    this.input.on('stopAll', () => {
      if (!this.canSelect() || !this.battle) return
      this.battle.squad.stopSelected()
      eventBus.emit('notify', { text: '小队原地警戒', tone: 'info' })
    })
    this.input.on('muteToggle', () => this.toggleMute())
    this.input.on('pauseToggle', () => this.onPauseToggle())
    window.addEventListener('keydown', this.onGlobalKey)
  }

  private onMoveTo(payload: { x: number; y: number; queue: boolean }): void {
    if (!this.canSelect() || !this.battle || this.state.isDemo()) return
    const rect = this.canvas.getBoundingClientRect()
    const ndcX = ((payload.x - rect.left) / rect.width) * 2 - 1
    const ndcY = -((payload.y - rect.top) / rect.height) * 2 + 1
    const ground = this.tacticalCamera.screenToGround(ndcX, ndcY)
    if (!ground) return
    const target = {
      x: Math.max(0.6, Math.min(29.4, ground.x)),
      y: 0,
      z: Math.max(0.6, Math.min(29.4, ground.z)),
    }
    const selected = this.battle.getSelectedIds()
    if (selected.length === 0) {
      eventBus.emit('notify', { text: '先左键选择队员，再右键移动', tone: 'info' })
      return
    }
    eventBus.emit('moveCommand', {
      unitIds: selected,
      position: target,
      queue: payload.queue,
      forceMine: false,
    })
  }

  private onGlobalKey = (event: KeyboardEvent): void => {
    if (event.repeat || event.defaultPrevented) return
    const phase = this.state.getPhase()
    if (phase === 'paused' && event.key === 'Escape') {
      event.preventDefault()
      this.resumeGame()
      return
    }
    if (phase === 'demo' && event.key === 'Escape') {
      event.preventDefault()
      this.finishDemo('lose')
      return
    }
    if (!this.input.isEnabled() && (event.key === 'm' || event.key === 'M')) {
      this.toggleMute()
    }
  }

  private onPauseToggle(): void {
    const phase = this.state.getPhase()
    if (phase === 'playing' || phase === 'demo') {
      this.pauseGame()
    } else if (phase === 'paused') {
      this.resumeGame()
    }
  }

  private pauseGame(): void {
    if (!this.state.isPlaying()) return
    this.pausedFrom = this.state.getPhase()
    this.state.setPhase('paused')
    this.input.disable()
  }

  private resumeGame(): void {
    if (this.state.getPhase() !== 'paused') return
    this.state.setPhase(this.pausedFrom)
    if (this.pausedFrom !== 'demo') this.input.enable()
  }

  private canSelect(): boolean {
    return this.state.getPhase() === 'playing' && this.input.isEnabled()
  }

  private toggleMute(): void {
    this.audio.unlock()
    const muted = this.audio.toggleMuted()
    this.ui.setMuted(muted)
  }

  // -------------------------------------------------------------------- loop

  private onUpdate = (dt: number): void => {
    const phase = this.state.getPhase()
    if (phase === 'playing' || phase === 'demo') {
      // Demo timestamps are gameplay time; keep the runner in lockstep with the
      // fixed 50 ms simulation step instead of the render frame delta.
      const simulationDt = Math.min(0.05, dt)
      this.battle?.update(simulationDt)
      if (phase === 'demo' && this.demo?.isPlaying()) this.demo.update(simulationDt)
      const target = this.battle?.getCameraTarget()
      if (target) {
        this.lastTarget = target
        this.tacticalCamera.setTarget(target)
      }
    } else if (phase === 'menu') {
      this.tacticalCamera.setTarget({ x: 15, y: 0, z: 15 })
      this.tacticalCamera.setDistance(24)
      this.tacticalCamera.setYaw(this.tacticalCamera.getYaw() + dt * 0.035)
    } else {
      this.tacticalCamera.setTarget(this.lastTarget)
    }

    this.tacticalCamera.update(dt)

    if (phase === 'playing') {
      this.interaction.update(dt)
      this.hoverIndicator.update(this.interaction.getHovered(), dt)
    } else if (phase === 'paused') {
      this.hoverIndicator.update(null, dt)
    } else {
      this.interaction.update(dt)
      this.hoverIndicator.update(null, dt)
    }
  }

  private onFixedUpdate = (dt: number): void => {
    const phase = this.state.getPhase()
    if (phase === 'playing' || phase === 'demo') this.battle?.fixedUpdate(dt)
  }

  private onRender = (): void => {
    this.renderer.render(this.scene, this.camera)
  }

  private onResize = (): void => {
    const container = this.renderer.domElement.parentElement
    if (!container) return
    const width = container.clientWidth
    const height = container.clientHeight
    this.camera.aspect = Math.max(1, width) / Math.max(1, height)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private onVisibility = (): void => {
    if (document.hidden && this.state.isPlaying()) this.pauseGame()
  }

  private onFirstPointer = (): void => {
    this.audio.unlock()
  }

  private onCameraShake = ({ strength }: { strength: number }): void => {
    this.tacticalCamera.addShake(strength)
  }

  // ------------------------------------------------------------------- debug

  private installDebugApi(): void {
    const api = {
      getPhase: () => this.state.getPhase(),
      getInputEnabled: () => this.input.isEnabled(),
      getState: () => this.battle?.getDebugState() ?? null,
      getCamera: () => ({
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
        yaw: this.tacticalCamera.getYaw(),
        distance: this.tacticalCamera.getDistance(),
      }),
      start: (mode: 'normal' | 'demo' = 'normal') => this.startRun(mode),
      menu: () => this.returnToMenu(),
      select: (unitIds: UnitId[]) => eventBus.emit('selectionRequested', { unitIds }),
      move: (unitIds: UnitId[], x: number, z: number, queue = false, forceMine = false) =>
        eventBus.emit('moveCommand', {
          unitIds,
          position: { x, y: 0, z },
          queue,
          forceMine,
        }),
      project: (x: number, y: number, z: number) => {
        const v = new THREE.Vector3(x, y, z).project(this.camera)
        return {
          x: ((v.x + 1) / 2) * this.canvas.clientWidth,
          y: ((1 - v.y) / 2) * this.canvas.clientHeight,
        }
      },
      interact: (kind: InteractionKind, targetId: string) =>
        eventBus.emit('interactionRequested', { kind, targetId }),
      damage: (targetId: string, amount: number) =>
        eventBus.emit('damage', { targetId, amount, damageType: 'bullet' }),
      teleport: (unitId: string, x: number, z: number) => this.battle?.debugTeleport(unitId, x, z),
      pause: () => this.pauseGame(),
    }
    ;(window as unknown as { __RTS__: typeof api }).__RTS__ = api
  }
}
