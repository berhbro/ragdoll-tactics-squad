export interface StartMenuActions { onStart(): void; onDemo(): void }

export class StartMenu {
  readonly element = document.createElement('section')
  private readonly status: HTMLElement
  private readonly start: HTMLButtonElement
  private readonly demo: HTMLButtonElement

  constructor(actions: StartMenuActions) {
    this.element.className = 'overlay start-menu'
    this.element.innerHTML = `<div class="panel"><p class="eyebrow">TACTICAL RAGDOLL OPS</p><h1>Ragdoll Tactics Squad</h1><p>指挥三人小队，排雷、救援并夺取电台。</p><div class="menu-actions"><button data-action="start" type="button">开始游戏</button><button data-action="demo" type="button" class="secondary">观看演示</button></div><p class="menu-status" role="status"></p><ul><li>左键：选择队员</li><li>右键：移动</li><li><b>Shift / Alt + 右键：追加路径</b></li><li>F：智能交互　M：静音　Esc：暂停　滚轮：缩放</li></ul></div>`
    this.status = this.element.querySelector('.menu-status') as HTMLElement
    this.start = this.element.querySelector('[data-action="start"]') as HTMLButtonElement
    this.demo = this.element.querySelector('[data-action="demo"]') as HTMLButtonElement
    this.start.addEventListener('click', actions.onStart)
    this.demo.addEventListener('click', actions.onDemo)
    this.setReady(false)
  }

  setReady(ready: boolean): void {
    this.start.disabled = !ready
    this.demo.disabled = !ready
    this.demo.textContent = '观看演示'
    if (ready) this.status.textContent = ''
    else this.status.textContent = '正在初始化游戏...'
  }

  setDemoLoading(loading: boolean): void {
    this.start.disabled = loading
    this.demo.disabled = loading
    this.demo.textContent = loading ? '正在准备演示…' : '观看演示'
    if (loading) this.status.textContent = '正在加载自动演示，请稍候…'
  }

  setStatus(message: string): void { this.status.textContent = message }
  show(): void { this.element.classList.remove('hidden') }
  hide(): void { this.element.classList.add('hidden') }
}
