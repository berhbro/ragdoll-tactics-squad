import { Game } from './app/Game'
import './styles/main.css'
import './styles/ui.css'

const app = document.getElementById('app')
if (!app) throw new Error('#app not found')

const game = new Game(app)

game
  .init()
  .then(() => game.start())
  .catch((error: unknown) => {
    console.error('[main] failed to start', error)
    const message = document.createElement('div')
    message.style.cssText =
      'position:fixed;inset:0;display:grid;place-items:center;background:#10140f;color:#e8edda;font:14px sans-serif;z-index:99;padding:24px;text-align:center'
    message.textContent = `启动失败：${String(error)}`
    document.body.appendChild(message)
  })
