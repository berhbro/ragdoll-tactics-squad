import { eventBus } from '../core/EventBus'
import type { EventMap, EventName } from '../core/EventBus'
import type { HealthComponent, HoverInfo, UnitId } from '../Data/Types'

const roles = ['engineer', 'rifleman', 'machinegunner'] as const
const labels = { engineer: '工兵', rifleman: '步枪手', machinegunner: '机枪手' }
const baseHint = '左键选择 · 右键移动 · Shift / Alt + 右键追加路径 · F 交互'

export class HUD {
  readonly element = document.createElement('section')
  private readonly squad = document.createElement('div')
  private readonly capture = document.createElement('div')
  private readonly hover = document.createElement('div')
  private readonly feedback = document.createElement('div')
  private readonly volume: HTMLInputElement
  private readonly mute: HTMLButtonElement
  private readonly cleanups: Array<() => void> = []
  private selected = new Set<UnitId>()
  private currentUnits: HealthComponent[] = []
  private feedbackTimer: number | undefined
  private lastPulseAt = -Infinity

  constructor(private readonly audio: {
    getVolume(): number
    getMuted(): boolean
    setVolume(v: number): void
    toggleMuted(): void
  }) {
    this.element.className = 'hud hidden'
    this.squad.className = 'hud-squad'
    this.capture.className = 'capture-widget'
    this.hover.className = 'hud-hint'
    this.hover.textContent = baseHint
    this.feedback.className = 'screen-feedback'
    this.element.innerHTML = '<div class="hud-audio"><label>音量 <input aria-label="音量" class="volume" type="range" min="0" max="1" step="0.01"></label><button aria-label="切换静音" class="mute" type="button"></button></div>'
    this.capture.innerHTML = '<span>RADIO CAPTURE</span><strong>0%</strong><div class="capture-track"><i></i></div>'
    this.element.prepend(this.squad)
    this.element.append(this.capture, this.hover, this.feedback)
    this.volume = this.element.querySelector('.volume') as HTMLInputElement
    this.mute = this.element.querySelector('.mute') as HTMLButtonElement
    this.volume.addEventListener('input', () => audio.setVolume(Number(this.volume.value)))
    this.mute.addEventListener('click', () => audio.toggleMuted())
    window.addEventListener('rts-audio-changed', this.refreshAudio)
    this.cleanups.push(() => window.removeEventListener('rts-audio-changed', this.refreshAudio))

    this.on('squadUpdate', ({ units }) => { this.currentUnits = units; this.renderSquad() })
    this.on('unitSelected', ({ unitIds }) => { this.selected = new Set(unitIds); this.renderSquad() })
    this.on('captureProgress', ({ progress }) => {
      const percent = Math.round(Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * 100)
      this.setCapturePercent(percent)
    })
    this.on('restartRequest', () => this.setCapturePercent(0))
    this.on('hoverChanged', ({ target }) => { this.hover.textContent = target ? `${this.hoverText(target)} · F 智能交互` : baseHint })
    this.on('minePulse', ({ intensity }) => {
      const now = performance.now()
      if (intensity > 0.04 && now - this.lastPulseAt > 220) {
        this.lastPulseAt = now
        this.flash('yellow', intensity)
      }
    })
    this.on('damage', ({ targetId, amount }) => {
      // HealthComponent now carries the authoritative team field. Only actual
      // player targets may trigger the red-screen feedback.
      if (this.currentUnits.some((unit) => unit.team === 'player' && unit.unitId === targetId)) {
        const intensity = Math.max(0.28, Math.min(0.72, 0.28 + Math.max(0, amount) / 140))
        this.flash('red', intensity)
      }
    })
    this.renderSquad()
    this.refreshAudio()
  }

  show(): void { this.element.classList.remove('hidden') }
  hide(): void { this.element.classList.add('hidden') }
  dispose(): void {
    this.cleanups.forEach((fn) => fn())
    if (this.feedbackTimer !== undefined) window.clearTimeout(this.feedbackTimer)
    this.element.remove()
  }

  private on<K extends EventName>(name: K, fn: (payload: EventMap[K]) => void): void {
    eventBus.on(name, fn)
    this.cleanups.push(() => eventBus.off(name, fn))
  }

  private setCapturePercent(percent: number): void {
    this.capture.querySelector('strong')!.textContent = `${percent}%`
    ;(this.capture.querySelector('i') as HTMLElement).style.width = `${percent}%`
  }

  private renderSquad(): void {
    this.squad.innerHTML = roles.map((role) => {
      const unit = this.currentUnits.find((item) => item.unitId === role)
      const percentage = unit ? Math.max(0, Math.min(100, Math.round(100 * unit.hp / Math.max(1, unit.maxHp)))) : 0
      const status = unit ? (unit.state === 'alive' ? '作战中' : unit.state === 'downed' ? '倒地' : '阵亡') : '等待小队数据'
      const hp = unit ? `${Math.max(0, Math.round(unit.hp))}/${Math.round(unit.maxHp)}` : '—'
      const selected = this.selected.has(role) ? ' selected' : ''
      return `<article class="squad-card${selected}"><b>${labels[role]}</b><span class="hp"><i style="width:${percentage}%"></i></span><small>${status} · ${hp}</small></article>`
    }).join('')
  }

  private hoverText(target: HoverInfo): string {
    const names = { attack: '攻击敌人', defuse: '排除地雷', rescue: '救援队友' }
    return `${names[target.kind]}（${target.id}，${target.distance.toFixed(1)}m）`
  }

  private flash(kind: 'red' | 'yellow', intensity: number): void {
    this.feedback.className = `screen-feedback ${kind}`
    this.feedback.style.opacity = String(Math.max(0, Math.min(0.55, intensity)))
    if (this.feedbackTimer !== undefined) window.clearTimeout(this.feedbackTimer)
    this.feedbackTimer = window.setTimeout(() => { this.feedback.style.opacity = '0' }, 180)
  }

  private refreshAudio = (): void => {
    this.volume.value = String(this.audio.getVolume())
    this.mute.textContent = this.audio.getMuted() ? '🔇 已静音' : '🔊 音效'
    this.mute.setAttribute('aria-pressed', String(this.audio.getMuted()))
  }
}
