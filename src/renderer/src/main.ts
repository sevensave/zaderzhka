import '@fontsource/pixelify-sans/400.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/400-italic.css'
import '@fontsource/pt-serif/400.css'
import '@fontsource/pt-serif/400-italic.css'
import './style.css'
import { App } from '../../ui/app'

async function boot() {
  const stage = document.getElementById('stage')!
  // Шрифты до первого кадра: иначе пульт мигнёт системным шрифтом.
  await Promise.all([
    document.fonts.load('16px "Pixelify Sans"', 'ЗАДЕРЖКА'),
    document.fonts.load('16px "IBM Plex Mono"', 'день 1'),
    document.fonts.load('16px "PT Serif"', 'Доброе утро'),
    document.fonts.load('italic 16px "PT Serif"', 'пауза'),
  ]).catch(() => {})
  const app = new App(stage)
  await app.loadSettings()
  app.showTitle()
  if (__DEV__) (window as unknown as { __z: App }).__z = app
}

void boot()
