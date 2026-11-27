import { eventBus } from '../core/EventBus'
import type { GameOverPayload } from '../Data/Types'

export class ResultPanel {
  readonly element = document.createElement('section')
  constructor() {
    this.element.className = 'overlay hidden result'
    this.element.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).dataset.action
      if (action === 'restart') eventBus.emit('restartRequest', undefined)
      if (action === 'menu') eventBus.emit('mainMenuRequest', undefined)
    })
  }
  show(result: GameOverPayload): void {
    this.element.innerHTML = `<div class="panel"><p class="eyebrow">${result.win ? 'MISSION COMPLETE' : 'MISSION FAILED'}</p><h2>${result.win ? '任务完成' : '任务失败'}</h2><p class="result-reason"></p><dl><dt>通关时间</dt><dd>${result.stats.elapsedSeconds.toFixed(1)}s</dd><dt>误爆次数</dt><dd>${result.stats.misfires}</dd><dt>倒地次数</dt><dd>${result.stats.downs}</dd></dl><div class="menu-actions"><button type="button" data-action="restart">重新开始</button><button type="button" data-action="menu" class="secondary">返回主菜单</button></div></div>`
    // The reason comes from game events: use textContent rather than injecting HTML.
    ;(this.element.querySelector('.result-reason') as HTMLElement).textContent = result.win ? '' : result.reason
    this.element.classList.remove('hidden')
  }
  hide(): void { this.element.classList.add('hidden') }
}
