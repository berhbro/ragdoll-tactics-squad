import { eventBus } from '../core/EventBus'
import type { GameOverPayload, GamePhase, GameStats, NotificationPayload } from '../Data/Types'
import { HUD } from './HUD'
import { PauseMenu } from './PauseMenu'
import { ResultPanel } from './ResultPanel'
import { StartMenu } from './StartMenu'

export interface UIActions {
  onStart: () => void
  onDemo: () => void
  onResume: () => void
  onRestart: () => void
  onMenu: () => void
  onToggleMute: () => void
  onVolume: (volume: number) => void
}

type ActionKind = 'defuse' | 'rescue'

/**
 * Facade over the independently authored StartMenu, PauseMenu, ResultPanel and
 * HUD components. Game only talks to this class; the child components keep
 * their own DOM, styles and EventBus contracts.
 */
export class UIManager {
  private readonly root: HTMLElement
  private readonly actions: UIActions
  private readonly startMenu: StartMenu
  private readonly pauseMenu: PauseMenu
  private readonly resultPanel: ResultPanel
  private readonly hud: HUD

  private readonly status: HTMLElement
  private readonly timer: HTMLElement
  private readonly demoBadge: HTMLElement
  private readonly demoExit: HTMLButtonElement
  private readonly toast: HTMLElement
  private readonly actionPanel: HTMLElement
  private readonly actionLabel: HTMLElement
  private readonly actionFill: HTMLElement
  private readonly selectionBox: HTMLElement
  private readonly loading: HTMLElement
  private readonly loadingText: HTMLElement

  private phase: GamePhase = 'menu'
  private muted: boolean
  private volume = 0.65
  private loadingVisible = false
  private actionKind: ActionKind | null = null
  private toastTimer = 0

  private readonly hudAudio = {
    getVolume: (): number => this.volume,
    getMuted: (): boolean => this.muted,
    setVolume: (value: number): void => {
      this.volume = Math.max(0, Math.min(1, value))
      this.actions.onVolume(this.volume)
    },
    toggleMuted: (): void => this.actions.onToggleMute(),
  }

  constructor(root: HTMLElement, actions: UIActions, muted: boolean) {
    this.root = root
    this.actions = actions
    this.muted = muted

    this.startMenu = new StartMenu({
      onStart: () => this.actions.onStart(),
      onDemo: () => {
        this.startMenu.setDemoLoading(true)
        this.actions.onDemo()
      },
    })
    this.pauseMenu = new PauseMenu()
    this.pauseMenu.element.classList.add('pause-menu')
    this.resultPanel = new ResultPanel()
    this.resultPanel.element.classList.add('result-panel')
    this.hud = new HUD(this.hudAudio)

    this.status = document.createElement('div')
    this.status.className = 'top-center rts-status'
    this.status.innerHTML = '<div class="mission-timer">00:00</div><div class="objective">目标：清空守军，占领电台</div><div class="demo-badge hidden">WATCH DEMO · 自动演示</div><button type="button" class="demo-exit hidden">退出演示</button>'
    this.timer = this.status.querySelector('.mission-timer') as HTMLElement
    this.demoBadge = this.status.querySelector('.demo-badge') as HTMLElement
    this.demoExit = this.status.querySelector('.demo-exit') as HTMLButtonElement
    this.demoExit.addEventListener('click', () => this.actions.onMenu())

    this.toast = document.createElement('div')
    this.toast.className = 'toast rts-toast'

    this.actionPanel = document.createElement('div')
    this.actionPanel.className = 'action-panel rts-action hidden'
    this.actionPanel.innerHTML = '<div class="action-label"><span>排雷中…</span><b></b></div><div class="action-track"><div class="action-fill"></div></div>'
    this.actionLabel = this.actionPanel.querySelector('.action-label') as HTMLElement
    this.actionFill = this.actionPanel.querySelector('.action-fill') as HTMLElement

    this.selectionBox = document.createElement('div')
    this.selectionBox.className = 'selection-box rts-selection'

    this.loading = document.createElement('div')
    this.loading.className = 'overlay hidden rts-loading'
    this.loading.innerHTML = '<div class="loading-card"><div class="spinner"></div><div class="loading-text">正在部署小队…</div></div>'
    this.loadingText = this.loading.querySelector('.loading-text') as HTMLElement

    this.root.replaceChildren(
      this.startMenu.element,
      this.pauseMenu.element,
      this.resultPanel.element,
      this.hud.element,
      this.status,
      this.toast,
      this.actionPanel,
      this.selectionBox,
      this.loading,
    )

    this.startMenu.show()
    this.startMenu.setReady(false)
    this.hud.hide()
    this.pauseMenu.setPaused(false)
    this.resultPanel.hide()
    this.wireEvents()
  }

  setPhase(phase: GamePhase): void {
    this.phase = phase
    if (phase === 'menu') {
      this.startMenu.show()
      this.startMenu.setReady(!this.loadingVisible)
      this.hud.hide()
      this.pauseMenu.setPaused(false)
      this.resultPanel.hide()
      this.hideAction()
    } else {
      this.startMenu.hide()
      this.hud.show()
      this.pauseMenu.setPaused(phase === 'paused')
      if (phase !== 'won' && phase !== 'lost') this.resultPanel.hide()
      if (phase !== 'demo') {
        this.demoBadge.classList.add('hidden')
        this.demoExit.classList.add('hidden')
      } else {
        this.demoBadge.classList.remove('hidden')
        this.demoExit.classList.remove('hidden')
      }
      if (phase === 'paused') this.hideAction()
    }
    if (phase === 'menu') {
      this.demoBadge.classList.add('hidden')
      this.demoExit.classList.add('hidden')
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    window.dispatchEvent(new Event('rts-audio-changed'))
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    window.dispatchEvent(new Event('rts-audio-changed'))
  }

  showLoading(show: boolean, text = '正在部署小队…'): void {
    this.loadingVisible = show
    this.loading.classList.toggle('hidden', !show)
    this.loadingText.textContent = text
    if (!show && this.phase === 'menu') this.startMenu.setReady(true)
    if (show && this.phase === 'menu') this.startMenu.setReady(false)
  }

  showSelectionBox(x1: number, y1: number, x2: number, y2: number): void {
    this.selectionBox.style.display = 'block'
    this.selectionBox.style.left = `${Math.min(x1, x2)}px`
    this.selectionBox.style.top = `${Math.min(y1, y2)}px`
    this.selectionBox.style.width = `${Math.abs(x2 - x1)}px`
    this.selectionBox.style.height = `${Math.abs(y2 - y1)}px`
  }

  hideSelectionBox(): void {
    this.selectionBox.style.display = 'none'
  }

  dispose(): void {
    eventBus.off('resumeRequest', this.onResumeRequest)
    eventBus.off('restartRequest', this.onRestartRequest)
    eventBus.off('mainMenuRequest', this.onMainMenuRequest)
    eventBus.off('gameOver', this.onGameOver)
    eventBus.off('gameStateChanged', this.onPhase)
    eventBus.off('statsUpdate', this.onStatsUpdate)
    eventBus.off('notify', this.onNotify)
    eventBus.off('defuseStarted', this.onDefuseStarted)
    eventBus.off('defuseProgress', this.onDefuseProgress)
    eventBus.off('defuseCompleted', this.onActionDone)
    eventBus.off('defuseCancelled', this.onActionDone)
    eventBus.off('rescueStarted', this.onRescueStarted)
    eventBus.off('rescueProgress', this.onRescueProgress)
    eventBus.off('rescueCompleted', this.onActionDone)
    eventBus.off('rescueCancelled', this.onActionDone)
    window.clearTimeout(this.toastTimer)
    this.hud.dispose()
    this.root.replaceChildren()
  }

  private wireEvents(): void {
    eventBus.on('resumeRequest', this.onResumeRequest)
    eventBus.on('restartRequest', this.onRestartRequest)
    eventBus.on('mainMenuRequest', this.onMainMenuRequest)
    eventBus.on('gameStateChanged', this.onPhase)
    eventBus.on('gameOver', this.onGameOver)
    eventBus.on('statsUpdate', this.onStatsUpdate)
    eventBus.on('notify', this.onNotify)
    eventBus.on('defuseStarted', this.onDefuseStarted)
    eventBus.on('defuseProgress', this.onDefuseProgress)
    eventBus.on('defuseCompleted', this.onActionDone)
    eventBus.on('defuseCancelled', this.onActionDone)
    eventBus.on('rescueStarted', this.onRescueStarted)
    eventBus.on('rescueProgress', this.onRescueProgress)
    eventBus.on('rescueCompleted', this.onActionDone)
    eventBus.on('rescueCancelled', this.onActionDone)
  }

  private onResumeRequest = (): void => this.actions.onResume()
  private onRestartRequest = (): void => this.actions.onRestart()
  private onMainMenuRequest = (): void => this.actions.onMenu()

  private onPhase = ({ state }: { state: GamePhase }): void => this.setPhase(state)

  private onStatsUpdate = ({ stats }: { stats: GameStats }): void => {
    this.timer.textContent = formatTime(stats.elapsedSeconds)
  }

  private onNotify = (payload: NotificationPayload): void => {
    // A menu overlay sits above toasts, so surface startup/demo failures in the
    // menu's visible status line instead of only logging or toasting them.
    if (this.phase === 'menu' && payload.tone === 'warn') this.startMenu.setStatus(payload.text)
    this.toast.textContent = payload.text
    this.toast.classList.remove('is-warn', 'is-success')
    if (payload.tone === 'warn') this.toast.classList.add('is-warn')
    if (payload.tone === 'success') this.toast.classList.add('is-success')
    this.toast.classList.add('is-visible')
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('is-visible'), 2600)
  }

  private onDefuseStarted = ({ mineId }: { mineId: string }): void => {
    this.showAction('defuse', '排雷中…', mineId)
  }

  private onDefuseProgress = ({ progress }: { progress: number }): void => {
    if (this.actionKind === 'defuse') this.actionFill.style.width = `${Math.round(progress * 100)}%`
  }

  private onRescueStarted = ({ targetId }: { targetId: string }): void => {
    this.showAction('rescue', '救援中…', targetId)
  }

  private onRescueProgress = ({ progress }: { progress: number }): void => {
    if (this.actionKind === 'rescue') this.actionFill.style.width = `${Math.round(progress * 100)}%`
  }

  private onActionDone = (): void => this.hideAction()

  private onGameOver = (payload: GameOverPayload): void => {
    this.hideAction()
    this.toast.classList.remove('is-visible')
    this.resultPanel.show(payload)
  }

  private showAction(kind: ActionKind, label: string, id: string): void {
    this.actionKind = kind
    const labelEl = this.actionLabel.querySelector('span')
    const idEl = this.actionLabel.querySelector('b')
    if (labelEl) labelEl.textContent = label
    if (idEl) idEl.textContent = id
    this.actionFill.style.width = '0%'
    this.actionPanel.classList.remove('hidden')
  }

  private hideAction(): void {
    this.actionKind = null
    this.actionPanel.classList.add('hidden')
  }
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
