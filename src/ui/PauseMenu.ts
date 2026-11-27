import { eventBus } from '../core/EventBus'

export class PauseMenu {
  readonly element = document.createElement('section')
  constructor() {
    this.element.className = 'overlay hidden'
    this.element.innerHTML = '<div class="panel"><p class="eyebrow">SQUAD PAUSED</p><h2>行动暂停</h2><div class="menu-actions"><button data-action="resume">继续</button><button data-action="restart" class="secondary">重新开始</button><button data-action="menu" class="secondary">返回主菜单</button></div></div>'
    this.element.querySelector('[data-action="resume"]')!.addEventListener('click', () => eventBus.emit('resumeRequest', undefined))
    this.element.querySelector('[data-action="restart"]')!.addEventListener('click', () => eventBus.emit('restartRequest', undefined))
    this.element.querySelector('[data-action="menu"]')!.addEventListener('click', () => eventBus.emit('mainMenuRequest', undefined))
  }
  setPaused(paused: boolean): void { this.element.classList.toggle('hidden', !paused) }
}
