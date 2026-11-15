// Рубка: кадр 480×270, пиксельный слой на canvas и текстовый слой поверх.
// Здесь живут масштаб, цикл отрисовки, пульт, плоттер, кнопки времени и очередь сцен.

import { SCRIPTS } from '../content/stations'
import { FINAL_WAIT, GEN, HINTS, statusLine } from '../content/ui-text'
import {
  activeLegs,
  advance,
  type AdvanceMode,
  canAdvance as engineCanAdvance,
  courseState,
  depart,
  deserialize,
  type GameState,
  isIdle,
  journalView,
  nextLabel,
  newGame,
  type Notice,
  porogDelay,
  posAt,
  serialize,
  sessionsOf,
  signalEnd,
  simulatePlan,
  stationView,
  type StationView,
  tugPos,
} from '../sim/engine'
import { dist, FINALS, isFinal, MIN_FLIGHT, type Leg, MODES, place, placeName, type Point, SEATS, STATION, type StationId, STATIONS } from '../sim/world'
import { api } from './api'
import { audio } from './audio'
import { add, clear, h } from './dom'
import { clock, dur, hours, short } from './format'
import { C } from './palette'
import * as P from './panels'
import { drawConsole, fillRect, H, PANEL, ring, Sky, W, WIN_H, type WindowState } from './scene'

export interface Settings {
  sound: boolean
  volume: number
  music: boolean
  bigText: boolean
  /** Четыре подсказки первого дня в строке состояния. */
  hints: boolean
}

type Scene =
  | { k: 'file'; id: string }
  | { k: 'evening' }
  | { k: 'arrive'; n: Extract<Notice, { k: 'arrive' }> }
  | { k: 'zoya' }
  | { k: 'porogTurn' }
  | { k: 'final' }
  | { k: 'drift' }
  | { k: 'journal' }
  | { k: 'planner' }
  | { k: 'dock'; id: StationId }

const AGE_FRESH = 2
const AGE_MID = 6

/** Плоттер: световые часы → пиксели. */
const MAP = { x0: PANEL.center.x + 4, y0: PANEL.center.y + 4, minX: -2.5, maxY: 4.3, k: 11.5 }
function mx(x: number) {
  return MAP.x0 + (x - MAP.minX) * MAP.k
}
function my(y: number) {
  return MAP.y0 + (MAP.maxY - y) * MAP.k
}

export class App {
  readonly stage: HTMLElement
  readonly frame: HTMLElement
  readonly cv: HTMLCanvasElement
  readonly cx: CanvasRenderingContext2D
  readonly ui: HTMLElement
  readonly hudEl: HTMLElement
  readonly layer: HTMLElement
  readonly toastEl: HTMLElement
  s: GameState | null = null
  mode: 'title' | 'play' | 'black' = 'title'
  settings: Settings = { sound: true, volume: 0.7, music: true, bigText: false, hints: true }
  /** Что игрок уже открыл в первый день: от этого зависят подсказки. Не сохраняется: остальное видно по состоянию. */
  hintSeen = { polynya: false, planner: false }
  /** Одноразовые фразы о новых инструментах (раздел 10, правило 8). Не сохраняются. */
  onceSeen = { drain: false, modeSwitch: false }
  /** Сколько топлива дал слив на станции, пока шла партия: для экрана стоянки. */
  drained: Partial<Record<StationId, number>> = {}
  readonly sky = new Sky()
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  hasSave = false

  /** Визуальное время: кольца и буксир доезжают до нового положения за 400–800 мс. */
  vis = { t: 0, from: 0, to: 0, start: 0, dur: 600, p0: { x: 0, y: 0 } as Point, p1: { x: 0, y: 0 } as Point }
  private last = performance.now()
  private queue: Scene[] = []
  panelOpen: string | null = null
  private panelOnClose: (() => void) | null = null
  private toastTimer: number | null = null
  selected: StationId | null = null
  blinkUntil = 0
  /** Планировщик правит черновик, пока не нажали «Утвердить». */
  draft: Leg[] | null = null

  private rows: HTMLElement[] = []
  private moreB: HTMLElement | null = null
  /** Номер места строки в списке (−1 — свёрнута). Нужен и для маркеров на холсте. */
  private rowSlot: number[] = STATIONS.map((_, i) => i)
  /** Развёрнут ли список станций, до которых не успеть. */
  private listOpen = false
  private right: Record<string, HTMLElement> = {}
  private hint!: HTMLElement
  private tip!: HTMLElement
  private strip!: HTMLElement
  private stripState!: HTMLElement
  private stripHint!: HTMLElement
  private labels = new Map<string, HTMLElement>()
  private labelSize = new Map<string, { w: number; h: number }>()

  constructor(stage: HTMLElement) {
    this.stage = stage
    this.frame = h('div', { class: 'frame' })
    this.cv = h('canvas', { class: 'px-layer', width: W, height: H })
    this.cx = this.cv.getContext('2d')!
    this.cx.imageSmoothingEnabled = false
    this.ui = h('div', { class: 'ui' })
    this.hudEl = h('div', { class: 'hud' })
    this.layer = h('div', { class: 'layer' })
    this.toastEl = h('div', { class: 'notice-toast data', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' })
    this.ui.append(this.hudEl, this.layer, this.toastEl)
    this.frame.append(this.cv, this.ui)
    stage.append(this.frame)
    this.buildHud()
    window.addEventListener('resize', () => this.fit())
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => (this.reduced = e.matches))
    window.addEventListener('keydown', (e) => this.onKey(e))
    this.fit()
    requestAnimationFrame((t) => this.loop(t))
  }

  // ——— масштаб ———

  fit(): void {
    const dpr = window.devicePixelRatio || 1
    const k = Math.max(1, Math.floor(Math.min((window.innerWidth * dpr) / W, (window.innerHeight * dpr) / H)))
    const s = k / dpr
    const wpx = W * s
    const hpx = H * s
    const left = Math.round(((window.innerWidth - wpx) / 2) * dpr) / dpr
    const top = Math.round(((window.innerHeight - hpx) / 2) * dpr) / dpr
    Object.assign(this.frame.style, { width: `${wpx}px`, height: `${hpx}px`, left: `${left}px`, top: `${top}px` })
    this.cv.style.width = `${wpx}px`
    this.cv.style.height = `${hpx}px`
    this.frame.style.setProperty('--u', `${s}px`)
    this.frame.classList.toggle('big-text', this.settings.bigText)
    this.labelSize.clear()
  }

  // ——— сохранения ———

  async loadSettings(): Promise<void> {
    const raw = await api.readSave('settings')
    if (raw) {
      try {
        Object.assign(this.settings, JSON.parse(raw))
      } catch {
        /* битые настройки — по умолчанию */
      }
    }
    audio.configure(this.settings.sound, this.settings.volume, this.settings.music)
    this.fit()
  }

  saveSettings(): void {
    void api.writeSave('settings', JSON.stringify(this.settings))
    audio.configure(this.settings.sound, this.settings.volume, this.settings.music)
    if (this.s && this.mode === 'play' && this.settings.sound) audio.humOn()
    this.fit()
  }

  async loadRun(): Promise<GameState | null> {
    const raw = await api.readSave('run')
    return raw ? deserialize(raw) : null
  }

  save(): void {
    if (this.s) void api.writeSave('run', serialize(this.s))
  }

  // ——— режимы ———

  showTitle(): void {
    this.mode = 'title'
    this.draft = null
    this.s = null
    this.queue = []
    this.closePanel(false, false)
    this.hudEl.classList.add('hidden')
    audio.humOff()
    audio.musicContext(true)
    P.title(this)
  }

  newRun(): void {
    this.hintSeen = { polynya: false, planner: false }
    this.onceSeen = { drain: false, modeSwitch: false }
    this.drained = {}
    this.draft = null
    this.s = newGame()
    this.save()
    this.mode = 'play'
    this.hudEl.classList.remove('hidden')
    this.syncVis(true)
    this.refresh()
    audio.musicOn()
    audio.humOn()
    P.prologue(this, () => {
      this.queue.push({ k: 'file', id: 'm1' })
      this.next()
    })
  }

  resume(s: GameState): void {
    this.draft = null
    this.drained = {}
    this.s = s
    this.mode = 'play'
    this.hudEl.classList.remove('hidden')
    this.syncVis(true)
    this.refresh()
    audio.musicOn()
    audio.humOn()
    this.closePanel(false, false)
    if (s.final.stage !== 'none') {
      P.finalStage(this)
      return
    }
    if (s.eveningDue !== null) {
      const v = journalView(s)
      if (v.course.length || v.others.length) this.queue.push({ k: 'journal' })
      this.queue.push({ k: 'evening' })
    }
    this.next()
  }

  // ——— время ———

  syncVis(instant = false): void {
    if (!this.s) return
    const now = performance.now()
    const cur = this.visPos()
    this.vis.from = instant ? this.s.t : this.vis.t
    this.vis.to = this.s.t
    this.vis.p0 = instant ? tugPos(this.s) : cur
    this.vis.p1 = tugPos(this.s)
    this.vis.start = now
    const span = Math.abs(this.vis.to - this.vis.from)
    this.vis.dur = instant ? 0 : Math.min(800, 400 + span * 40)
    if (instant) this.vis.t = this.s.t
  }

  private visPos(): Point {
    const k = this.visK()
    return { x: this.vis.p0.x + (this.vis.p1.x - this.vis.p0.x) * k, y: this.vis.p0.y + (this.vis.p1.y - this.vis.p0.y) * k }
  }

  private visK(): number {
    if (this.vis.dur <= 0) return 1
    const k = Math.min(1, (performance.now() - this.vis.start) / this.vis.dur)
    return 1 - (1 - k) ** 3
  }

  canAdvance(): boolean {
    const s = this.s
    return !!s && this.mode === 'play' && engineCanAdvance(s) && s.final.stage !== 'flight' && !this.modalOpen()
  }

  modalOpen(): boolean {
    return this.layer.querySelector('.panel.modal') !== null
  }

  step(m: AdvanceMode): void {
    if (!this.canAdvance() || !this.s) return
    // Черновик правился на старых числах: после хода времени он устарел.
    this.draft = null
    audio.tick()
    const notices = advance(this.s, m)
    this.afterChange(notices, m === 'next')
  }

  /**
   * После шага времени. `stop` — это остановка «Дальше»: журнал открывается утром после сводки,
   * вечером перед сообщением Вере и днём, когда пришла новость по курсу.
   */
  afterChange(notices: Notice[], stop = false): void {
    if (!this.s) return
    this.syncVis()
    // Звук и всплывающая строка — только от тех, с кем можно что-то сделать: на курсе или успеваю,
    // и от новостей об отклонениях. Серые строки зовут в журнале и в списке, не дёргая игрока.
    const s0 = this.s
    const loud = (n: Extract<Notice, { k: 'session' }>) => {
      if (n.id.includes(':dev')) return true
      const st = stationView(s0, n.st).status
      return st === 'course' || st === 'off'
    }
    const incoming = [...new Set(notices.filter((n): n is Extract<Notice, { k: 'session' }> => n.k === 'session' && loud(n)).map((n) => n.st))]
    if (incoming.length) this.notifyStations(incoming)
    const journal = stop ? this.journalSlot(notices) : null
    if (journal === 'before') this.queue.push({ k: 'journal' })
    for (const n of notices) this.handle(n)
    if (journal === 'after') this.queue.push({ k: 'journal' })
    this.save()
    this.refresh()
    this.next()
  }

  /** Где в очереди стоит журнал: перед вечерним сообщением, после остальных экранов остановки или нигде. */
  private journalSlot(notices: Notice[]): 'before' | 'after' | null {
    const s = this.s!
    const screens = notices.some((n) => n.k === 'arrive' || n.k === 'zoya' || n.k === 'final' || n.k === 'porogTurn' || n.k === 'ending')
    if (screens) return null
    const v = journalView(s)
    if (!v.course.length && !v.others.length) return null
    if (notices.some((n) => n.k === 'evening')) return 'before'
    return 'after'
  }

  private notifyStations(ids: StationId[]): void {
    if (this.panelOpen || this.s?.ending || (this.s?.final.stage !== 'none' && this.s?.final.stage !== 'cont')) return
    const names = ids.map((id) => `«${STATION[id].name}»`)
    const shown = names.slice(0, 2).join(', ')
    const rest = names.length > 2 ? ` и ещё ${names.length - 2}` : ''
    this.toastEl.textContent = `${names.length === 1 ? 'НОВОЕ СООБЩЕНИЕ' : 'НОВЫЕ СООБЩЕНИЯ'} · ${shown}${rest}`
    this.toastEl.classList.add('visible')
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('visible')
      this.toastTimer = null
    }, 6500)
    audio.notice()
  }

  private handle(n: Notice): void {
    const s = this.s!
    switch (n.k) {
      case 'morning':
        if (n.file) {
          this.blinkUntil = performance.now() + 5000
          if (s.vera.channelOn) this.queue.push({ k: 'file', id: n.file })
        }
        break
      case 'evening':
        this.queue.push({ k: 'evening' })
        break
      case 'arrive':
        this.queue.push({ k: 'arrive', n })
        if (!isFinal(n.to)) this.queue.push({ k: 'dock', id: n.to })
        break
      case 'drain':
        this.drained[n.st] = n.fuel
        break
      case 'zoya':
        this.queue.push({ k: 'zoya' })
        break
      case 'porogTurn':
        this.queue.push({ k: 'porogTurn' })
        break
      case 'final':
        this.queue.push({ k: 'final' })
        break
      case 'ending':
        if (n.kind === 'drift') this.queue.push({ k: 'drift' })
        break
      case 'depart':
        if (s.final.stage === 'cont' && isFinal(n.to)) {
          s.final.stage = 'flight'
          this.queue.push({ k: 'final' })
        }
        if (this.draft) this.draft = null
        break
      case 'idle':
        if (s.final.stage === 'cont' && !activeLegs(s).some((l) => !isFinal(l.to))) {
          s.final.stage = 'flight'
          this.queue.push({ k: 'final' })
        } else this.queue.push({ k: 'planner' })
        break
      default:
        break
    }
  }

  /** Следующая сцена из очереди, если ничего не открыто модально. */
  next(): void {
    if (this.modalOpen()) return
    const sc = this.queue.shift()
    if (!sc || !this.s) return
    switch (sc.k) {
      case 'file':
        P.channel(this, sc.id, true)
        break
      case 'evening':
        P.evening(this)
        break
      case 'arrive':
        P.arrival(this, sc.n)
        break
      case 'zoya':
        P.zoya(this)
        break
      case 'porogTurn':
        P.porogTurn(this)
        break
      case 'final':
        this.queue = []
        P.finalStage(this)
        break
      case 'drift':
        P.drift(this)
        break
      case 'journal':
        P.journal(this, true)
        break
      case 'planner':
        P.planner(this)
        break
      case 'dock':
        P.dock(this, sc.id)
        break
    }
  }

  departNow(): void {
    if (!this.s || !isIdle(this.s)) return
    const n = depart(this.s)
    this.afterChange(n)
  }

  // ——— панели ———

  openPanel(el: HTMLElement, id: string, modal = false, onClose?: () => void): void {
    this.closePanel(false, false)
    this.toastEl.classList.remove('visible')
    el.classList.add('panel')
    if (modal) el.classList.add('modal')
    el.dataset.id = id
    this.layer.append(el)
    this.panelOpen = id
    this.panelOnClose = onClose ?? null
    requestAnimationFrame(() => el.classList.add('shown'))
    this.refresh()
  }

  closePanel(advanceQueue = true, runOnClose = true): void {
    const had = this.layer.firstElementChild
    const onClose = this.panelOnClose
    clear(this.layer)
    this.panelOpen = null
    this.panelOnClose = null
    this.selected = null
    audio.toneOff()
    audio.breathOff()
    audio.musicDuck(false)
    if (had) this.refresh()
    if (had && runOnClose && onClose) {
      onClose()
      return
    }
    if (advanceQueue && had) this.next()
  }

  // ——— клавиши ———

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (e.key === 'Escape') {
        ;(e.target as HTMLElement).blur()
        if (this.panelOpen === 'settings') this.closePanel()
        e.preventDefault()
      }
      return
    }
    if (e.key === 'Escape') {
      if (this.panelOpen === 'title') return
      if (this.panelOpen && !this.modalOpen()) {
        this.closePanel()
        e.preventDefault()
        return
      }
      if (!this.panelOpen && this.mode === 'play') {
        P.menu(this)
        e.preventDefault()
      }
      return
    }
    // Пробел при открытой панели нажимает только чистое «Дальше»: отправку, утверждение и распоряжение — никогда.
    if (e.code === 'Space' && this.mode === 'play' && this.panelOpen) {
      const b = this.layer.querySelector<HTMLButtonElement>('.p-foot [data-space]:not(:disabled)')
      if (b) {
        e.preventDefault()
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur()
        b.click()
      }
      return
    }
    if (this.mode !== 'play' || this.modalOpen()) return
    const map: Record<string, () => void> = {
      Space: () => this.step('next'),
      KeyP: () => P.planner(this),
      KeyJ: () => P.journal(this, false),
      KeyK: () => P.channel(this, null, false),
      KeyC: () => P.channel(this, null, false),
      KeyB: () => P.board(this),
      KeyA: () => P.archive(this),
    }
    const fn = map[e.code]
    if (fn) {
      e.preventDefault()
      // Кнопка в фокусе после щелчка сама ответила бы на пробел: тогда время пошло бы дважды.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur()
      fn()
    }
  }

  // ——— пульт (текст) ———

  private buildHud(): void {
    const hud = this.hudEl
    const L = PANEL.left
    hud.append(
      h(
        'div',
        { class: 'row-head data small dimtxt', style: { ...pos(L.x + 1, L.y + 1.5), width: u(L.w - 2), height: u(7) } },
        h('span', null, 'станция'),
        h('span', { class: 'c-n' }, 'чел'),
        h('span', null, 'возраст'),
        h('span', null, 'статус и запас'),
      ),
    )
    STATIONS.forEach((d, i) => {
      const row = h(
        'button',
        {
          class: 'row data',
          style: { ...pos(L.x + 1, L.y + 10 + i * 6), width: u(L.w - 2), height: u(6) },
          onclick: () => {
            if (d.id === 'polynya') this.hintSeen.polynya = true
            P.card(this, d.id)
          },
          onmouseenter: () => (this.selectedHover = d.id),
          onmouseleave: () => (this.selectedHover = null),
        },
        h('span', { class: 'c-name' }, d.name),
        h('span', { class: 'c-n' }, String(d.people)),
        h('span', { class: 'c-age' }),
        h('span', { class: 'c-m' }),
      )
      this.rows.push(row)
      hud.append(row)
    })
    // Строка-переключатель: станции «не успеть» свёрнуты, чтобы первый экран не был стеной из 14 строк.
    this.moreB = h('button', {
      class: 'row data more dimtxt',
      style: { ...pos(L.x + 1, L.y + 10 + STATIONS.length * 6), width: u(L.w - 2), height: u(6) },
      onclick: () => {
        this.listOpen = !this.listOpen
        this.refresh()
      },
    })
    hud.append(this.moreB)

    const R = PANEL.right
    const r = this.right
    r.delay = h('button', { class: 'data link', style: { ...pos(R.x + 11, R.y + 1.2), width: u(R.w - 13) }, title: 'Канал «Порог» · K', onclick: () => P.channel(this, null, false) })
    r.clock = h('div', { class: 'data clock', style: pos(R.x + 3, R.y + 10) })
    r.state = h('div', { class: 'px lbl small right', style: { ...pos(R.x + 70, R.y + 11), width: u(R.w - 73) } })
    r.fuelLbl = h('div', { class: 'px lbl', style: pos(R.x + 3, R.y + 20) }, 'ТОПЛИВО')
    r.fuel = h('div', { class: 'data right', style: { ...pos(R.x + 70, R.y + 21), width: u(R.w - 73) } })
    r.seatsLbl = h('div', { class: 'px lbl', style: pos(R.x + 48, R.y + 40) }, 'МЕСТА')
    r.seats = h('div', { class: 'data', style: pos(R.x + 48, R.y + 48) })
    // Время: широкая «Дальше» с подписью, куда она ведёт, и малая «+1 час».
    this.nextB = h('span', { class: 'nx-b data' })
    r.next = h(
      'button',
      {
        class: 'btn px next primary',
        style: { ...pos(R.x + 1, R.y + 55), width: u(104), height: u(13) },
        title: 'Дальше · пробел',
        onclick: () => this.step('next'),
      },
      h('span', { class: 'nx-a' }, 'ДАЛЬШЕ'),
      this.nextB,
    )
    r.hour = h(
      'button',
      { class: 'btn px', style: { ...pos(R.x + 107, R.y + 55), width: u(42), height: u(13) }, title: '+1 час', onclick: () => this.step('1h') },
      '+1 ЧАС',
    )
    const sb = (label: string, i: number, fn: () => void, title: string) =>
      h('button', { class: 'btn px', style: { ...pos(R.x + 1 + i * 29.8, R.y + 70), width: u(28.6), height: u(8) }, title, onclick: fn }, label)
    r.b1 = sb('КУРС', 0, () => P.planner(this), 'Планировщик курса · P')
    r.b2 = sb('ЖУРНАЛ', 1, () => P.journal(this, false), 'Журнал · J')
    r.b3 = sb('БОРТ', 2, () => P.board(this), 'Борт и почта · B')
    r.b4 = sb('АРХИВ', 3, () => P.archive(this), 'Архив файлов · A')
    r.b5 = sb('МЕНЮ', 4, () => P.menu(this), 'Меню · Esc')
    this.hint = h('div', { class: 'data hint', style: { ...pos(R.x + 3, R.y + 80), width: u(R.w - 6) } })
    hud.append(...Object.values(r), this.hint)

    // Подписи плоттера: DOM поверх холста, мыши не мешают.
    this.tip = h('div', { class: 'data tip hidden' })

    // Строка состояния: всегда видна, панели начинаются ниже неё.
    this.stripState = h('span', { class: 'strip-state' })
    this.stripHint = h('span', { class: 'strip-hint hidden' })
    this.strip = h(
      'button',
      { class: 'strip data hidden', title: 'Открыть планировщик', onclick: () => this.openFromStrip() },
      this.stripState,
      this.stripHint,
    )
    hud.append(this.strip)

    // Подсказка над плоттером и клики по точкам станций.
    const C0 = PANEL.center
    const hit = h('div', {
      class: 'plot-hit',
      style: { ...pos(C0.x, C0.y), width: u(C0.w), height: u(C0.h) },
    })
    hit.addEventListener('mousemove', (e) => this.plotHover(e, hit))
    hit.addEventListener('mouseleave', () => {
      this.tip.classList.add('hidden')
      this.selectedHover = null
    })
    hit.addEventListener('click', (e) => {
      const id = this.plotPick(e, hit)
      if (id) {
        if (id === 'polynya') this.hintSeen.polynya = true
        P.card(this, id)
      }
    })
    hud.append(hit, this.tip)
  }

  selectedHover: StationId | null = null
  private nextB!: HTMLElement

  private plotPick(e: MouseEvent, el: HTMLElement): StationId | null {
    const r = el.getBoundingClientRect()
    const sx = PANEL.center.x + ((e.clientX - r.left) / r.width) * PANEL.center.w
    const sy = PANEL.center.y + ((e.clientY - r.top) / r.height) * PANEL.center.h
    let best: StationId | null = null
    let bd = 5
    for (const d of STATIONS) {
      const dd = Math.hypot(mx(d.x) - sx, my(d.y) - sy)
      if (dd < bd) {
        bd = dd
        best = d.id
      }
    }
    return best
  }

  private plotHover(e: MouseEvent, el: HTMLElement): void {
    const id = this.plotPick(e, el)
    this.selectedHover = id
    if (!id) {
      this.tip.classList.add('hidden')
      return
    }
    const d = STATION[id]
    this.tip.textContent = `«${d.name}» · ${d.people} чел.`
    this.tip.classList.remove('hidden')
    const w = this.tip.offsetWidth / (this.frame.clientWidth / W)
    const left = Math.max(PANEL.center.x + 1, Math.min(mx(d.x) + 4, PANEL.center.x + PANEL.center.w - w - 1))
    Object.assign(this.tip.style, pos(left, my(d.y) - 7))
  }

  /** Первая фраза первого дня, которой ещё не сделано действие. */
  hintText(): string | null {
    const s = this.s
    if (!s || this.mode !== 'play' || !this.settings.hints || s.t > 1e-6) return null
    if (s.tug.started) return HINTS[3]!
    if (this.hintSeen.planner) return HINTS[2]!
    if (this.hintSeen.polynya) return HINTS[1]!
    return HINTS[0]!
  }

  /** Щелчок по строке состояния: планировщик, у строки с бедой. */
  private openFromStrip(): void {
    const s = this.s
    if (!s || this.mode !== 'play' || this.modalOpen()) return
    const c = courseState(s)
    P.planner(this, c.k === 'late' ? c.st : c.k === 'fuel' ? 'last' : undefined)
  }

  private refreshStrip(): void {
    const s = this.s!
    const show = this.mode === 'play' && !s.ending && (s.final.stage === 'none' || s.final.stage === 'cont')
    this.strip.classList.toggle('hidden', !show)
    if (!show) return
    const c = courseState(s)
    clear(this.stripState)
    // Текст строки — из ui-text.ts. Красным только число опоздания.
    const line = statusLine(c)
    const at = c.k === 'late' ? line.indexOf('опоздание') : -1
    if (at < 0) this.stripState.append(line)
    else this.stripState.append(line.slice(0, at), h('span', { class: 'late' }, line.slice(at)))
    const hint = this.hintText()
    this.stripHint.textContent = hint ?? ''
    this.stripHint.classList.toggle('hidden', !hint)
  }

  /** Свернуть строки «не успеть» под одну строку-переключатель; выбранную, непрочитанную и подсказанную оставить. */
  private layoutRows(s: GameState, plan: ReturnType<typeof simulatePlan>): void {
    const L = PANEL.left
    let k = 0
    let hidden = 0
    let hiddenNew = 0
    // Развёрнутые 14 строк и кнопка «свернуть» не влезают в панель с шагом 6, поэтому шаг сжимается.
    const pitch = this.listOpen ? 5.5 : 6
    STATIONS.forEach((d, i) => {
      const v = stationView(s, d.id, plan)
      const row = this.rows[i]!
      const keep =
        this.listOpen ||
        v.status !== 'out' ||
        this.selected === d.id ||
        (d.id === 'polynya' && !this.hintSeen.polynya && !s.tug.flight && s.t < 12)
      row.style.display = keep ? '' : 'none'
      this.rowSlot[i] = keep ? k : -1
      if (keep) {
        Object.assign(row.style, pos(L.x + 1, L.y + 10 + k * pitch), { height: u(pitch) })
        k++
      } else {
        hidden++
        if (s.st[d.id].unread) hiddenNew++
      }
    })
    const more = this.moreB!
    if (hidden === 0 && !this.listOpen) {
      more.style.display = 'none'
      return
    }
    more.style.display = ''
    Object.assign(more.style, pos(L.x + 1, L.y + 10 + k * pitch), { height: u(pitch) })
    more.textContent = this.listOpen ? 'свернуть «не успеть»' : `ещё ${hidden}: не успеть${hiddenNew ? ` · новых ${hiddenNew}` : ''} ▾`
  }

  /** Обновить текст пульта под состояние. */
  refresh(): void {
    const s = this.s
    if (!s) return
    audio.musicContext(s.vera.channelOn && this.mode !== 'black' && s.final.stage !== 'screen')
    const plan = simulatePlan(s, activeLegs(s))
    STATIONS.forEach((d, i) => {
      const v = stationView(s, d.id, plan)
      const row = this.rows[i]!
      const [, , age, m] = row.children as unknown as HTMLElement[]
      row.className = `row data ${rowClass(v)}${s.st[d.id].unread ? ' unread' : ''}${this.selected === d.id ? ' sel' : ''}`
      age!.textContent = v.age === null ? '—' : ageShort(v.age)
      m!.className = 'c-m'
      clear(m!)
      if (v.status === 'silent') m!.textContent = 'молчит'
      else if (v.status === 'aboard') m!.textContent = 'на борту'
      else {
        m!.append(STATUS_WORD[v.status])
        if (v.status === 'out' && v.margin === null) m!.append(': нет топлива')
        else if (v.margin !== null) {
          m!.append(', ')
          // Числа за двое суток читаются как сутки: «запас 150,6 ч» новичку ни о чём не говорит.
          const far = Math.abs(v.margin) > 48
          const span = far ? `${Math.round(Math.abs(v.margin) / 24)} сут` : hours(v.margin)
          m!.append(v.margin < 0 ? h('span', { class: 'late' }, `опоздание ${span}`) : `запас ${span}`)
        }
      }
    })
    this.layoutRows(s, plan)

    const r = this.right
    const delay = porogDelay(s)
    r.delay!.textContent = s.vera.channelOn ? `КАНАЛ · ЗАДЕРЖКА ${dur(delay)}` : `КАНАЛ ВЫКЛ · ${dur(delay)}`
    r.clock!.textContent = `ДЕНЬ ${Math.floor((s.t + 8) / 24) + 1} · ${clock(s.t)}`
    const f = s.tug.flight
    r.state!.textContent = s.ending && !f ? 'СТОЯНКА' : f ? (f.mode === 'burn' ? 'ФОРСАЖ' : f.mode === 'cruise' ? 'КРЕЙСЕР' : 'ЭКОНОМ') : s.tug.dockUntil !== null ? 'СТЫКОВКА' : 'СТОЯНКА'
    r.fuel!.textContent = `${Math.round(s.tug.fuel)}`
    r.seats!.textContent = `${s.tug.aboard.length} из ${SEATS}`
    const busy = !this.canAdvance()
    const lbl = nextLabel(s)
    this.nextB.textContent = lbl.slice(lbl.indexOf(': ') + 2)
    for (const k of ['next', 'hour']) (r[k] as HTMLButtonElement).disabled = busy
    for (const k of ['b1', 'b2', 'b3', 'b4', 'b5']) {
      const b = r[k] as HTMLButtonElement
      b.disabled = this.mode !== 'play' || this.modalOpen()
    }
    for (const k of ['b1', 'b2', 'b3', 'b4'])
      r[k]!.classList.toggle('on', this.panelOpen === { b1: 'planner', b2: 'journal', b3: 'board', b4: 'archive' }[k])
    this.refreshStrip()

    // Что с буксиром и «Вылет».
    clear(this.hint)
    if (s.ending && !f) {
      this.hint.append(h('span', null, s.ending.kind === 'drift' ? 'Топлива нет ни на один перелёт.' : `«${placeName(s.tug.at ?? 'pereval')}». Ждём двадцать первых суток.`))
    } else if (f) {
      const late = !isFinal(f.to) ? signalEnd(s, f.to) - f.arrive : null
      add(
        this.hint,
        h('span', null, `→ «${placeName(f.to)}» · прибытие ${short(f.arrive)}`),
        late !== null && late < 0 ? h('span', { class: 'late' }, ` · опоздание ${hours(late)}`) : null,
      )
    } else if (s.tug.dockUntil !== null) {
      add(
        this.hint,
        h('span', null, `Стыковка у «${GEN[s.tug.at!]}» до ${short(s.tug.dockUntil)} `),
        s.tug.at && !isFinal(s.tug.at)
          ? h('button', { class: 'btn px go', disabled: this.mode !== 'play' || this.modalOpen(), onclick: () => P.dock(this, s.tug.at as StationId), title: 'Экран стоянки' }, 'СТОЯНКА')
          : null,
      )
    } else if (s.tug.at && !isFinal(s.tug.at) && (s.plan[0]?.to === 'pereval' && s.final.stage === 'none')) {
      this.hint.append(
        h('span', null, `${FINAL_WAIT} Ждать — «Дальше». `),
        h('button', { class: 'btn px go', disabled: busy, onclick: () => P.dock(this, s.tug.at as StationId) }, 'СТОЯНКА'),
      )
    } else if (s.plan.length) {
      const leg = s.plan[0]!
      const md = MODES[leg.mode]
      const can = s.tug.fuel + 1e-7 >= md.acc + md.brk
      this.hint.append(
        h('span', null, s.tug.started ? 'Стоянка. ' : 'Курс загружен. Буксир стоит. '),
        h(
          'button',
          { class: 'btn px go', disabled: !can || busy, onclick: () => this.departNow(), title: `${md.name}, разгон ${md.acc}` },
          `ВЫЛЕТ → ${placeName(leg.to).toUpperCase().slice(0, 12)}`,
        ),
      )
    } else {
      this.hint.append(h('span', null, s.tug.fuel < MIN_FLIGHT ? 'Топлива нет ни на один перелёт.' : 'Стоянка. Курс пуст.'))
    }
  }

  // ——— подписи плоттера ———

  private hideLabels(): void {
    for (const el of this.labels.values()) el.style.visibility = 'hidden'
  }

  /** Подписи у буксира, станций курса и «Перевала»: каждая встаёт туда, где не накрывает соседнюю. */
  private plotLabels(): void {
    const s = this.s
    if (!s || this.mode !== 'play') return this.hideLabels()
    const C0 = PANEL.center
    const box = { x0: C0.x + 1, y0: C0.y + 1, x1: C0.x + C0.w - 1, y1: C0.y + C0.h - 1 }
    const tp = this.visPos()
    const entries: { key: string; text: string; px: number; py: number; cls: string }[] = [{ key: 'tug', text: 'буксир', px: mx(tp.x), py: my(tp.y), cls: 'tug' }]
    for (const leg of this.draft ?? activeLegs(s)) {
      if (isFinal(leg.to) || entries.some((e) => e.key === leg.to)) continue
      const d = STATION[leg.to]
      entries.push({ key: leg.to, text: d.name, px: Math.round(mx(d.x)), py: Math.round(my(d.y)), cls: '' })
    }
    entries.push({ key: 'pereval', text: 'Перевал', px: Math.round(mx(FINALS.pereval.x)), py: Math.round(my(FINALS.pereval.y)), cls: 'far' })
    const scale = this.frame.clientWidth / W
    const placed: { x: number; y: number; w: number; h: number }[] = []
    const used = new Set<string>()
    for (const e of entries) {
      used.add(e.key)
      let el = this.labels.get(e.key)
      if (!el) {
        el = h('div', { class: `plot-label data ${e.cls}` })
        this.labels.set(e.key, el)
        this.hudEl.insertBefore(el, this.tip)
      }
      if (el.textContent !== e.text) {
        el.textContent = e.text
        this.labelSize.delete(e.text)
      }
      let sz = this.labelSize.get(e.text)
      if (!sz) {
        el.style.visibility = 'hidden'
        sz = { w: el.offsetWidth / scale, h: el.offsetHeight / scale }
        this.labelSize.set(e.text, sz)
      }
      const { w, h: hh } = sz
      const cands = [
        { x: e.px + 4, y: e.py + 1 - hh / 2 },
        { x: e.px - 2 - w, y: e.py + 1 - hh / 2 },
        { x: e.px + 1 - w / 2, y: e.py - 2 - hh },
        { x: e.px + 1 - w / 2, y: e.py + 4 },
      ]
      let at: { x: number; y: number } | null = null
      for (const c of cands) {
        const x = Math.max(box.x0, Math.min(c.x, box.x1 - w))
        const y = Math.max(box.y0, Math.min(c.y, box.y1 - hh))
        if (placed.every((p) => x + w + 0.5 <= p.x || p.x + p.w + 0.5 <= x || y + hh + 0.3 <= p.y || p.y + p.h + 0.3 <= y)) {
          at = { x, y }
          break
        }
      }
      if (!at) {
        el.style.visibility = 'hidden'
        continue
      }
      placed.push({ ...at, w, h: hh })
      el.style.visibility = 'visible'
      el.style.left = u(at.x)
      el.style.top = u(at.y)
    }
    for (const [k, el] of this.labels) if (!used.has(k)) el.style.visibility = 'hidden'
  }

  // ——— отрисовка ———

  private loop(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    if (this.s && this.vis.t !== this.vis.to) {
      const k = this.visK()
      this.vis.t = this.vis.from + (this.vis.to - this.vis.from) * k
    }
    this.draw(dt, now / 1000)
    requestAnimationFrame((t) => this.loop(t))
  }

  private windowState(): WindowState {
    const s = this.s
    const st: WindowState = { speed: 0, heading: 0, silhouette: null, reduced: this.reduced }
    if (this.mode === 'title' || !s) return { ...st, speed: 0.5, heading: -0.2 }
    const f = s.tug.flight
    if (f) {
      st.speed = f.mode === 'burn' ? 2.6 : f.mode === 'cruise' ? 1.6 : 1
      const to = place(f.to)
      const a = Math.atan2(to.y - f.fy, to.x - f.fx)
      st.heading = Math.max(-1, Math.min(1, Math.sin(a) * 0.9 + Math.cos(a) * 0.1))
    } else if (s.tug.at) {
      const at = s.tug.at
      if (at === 'pereval') st.silhouette = { seed: 99, lights: 12, hub: true }
      else if (at === 'porog') st.silhouette = { seed: 77, lights: 0 }
      else {
        const rt = s.st[at]
        const idx = STATIONS.findIndex((d) => d.id === at)
        st.silhouette = { seed: idx + 1, lights: rt.rescued && s.tug.dockUntil !== null ? 2 + (idx % 2) : 0 }
      }
    }
    return st
  }

  private draw(dt: number, now: number): void {
    const x = this.cx
    if (this.mode === 'black') {
      this.hideLabels()
      fillRect(x, C.void, 0, 0, W, H)
      return
    }
    this.sky.draw(x, this.windowState(), dt, now)
    drawConsole(x)
    if (this.mode === 'title' || !this.s) {
      this.hideLabels()
      // Пустой пульт в меню: лампа горит ровно.
      fillRect(x, C.amber, PANEL.right.x + 3, PANEL.right.y + 3, 6, 6)
      return
    }
    this.drawList(x)
    this.drawPlot(x)
    this.drawRight(x, now)
    this.plotLabels()
  }

  private drawList(x: CanvasRenderingContext2D): void {
    const s = this.s!
    const L = PANEL.left
    STATIONS.forEach((d, i) => {
      const rt = s.st[d.id]
      if (this.rowSlot[i]! < 0) return
      const y = L.y + 10 + this.rowSlot[i]! * (this.listOpen ? 5.5 : 6) + 2
      const v: StationView = stationView(s, d.id)
      const col = v.status === 'silent' ? C.steel : v.status === 'aboard' ? C.text : C.ice
      fillRect(x, col, L.x + 3, y, 2, 2)
      if (rt.unread && v.status !== 'aboard') fillRect(x, C.fresh, L.x, y - 1, 1, 4)
    })
  }

  private drawPlot(x: CanvasRenderingContext2D): void {
    const s = this.s!
    const Cp = PANEL.center
    const clip = { x: Cp.x, y: Cp.y, w: Cp.w, h: Cp.h }
    const t = this.vis.t
    const tp = this.visPos()

    // Полоса Шквала: едва заметная.
    x.fillStyle = C.body
    for (const [px, py] of BAND) x.fillRect(px, py, 1, 1)

    // Кольца сигналов станций.
    for (const d of STATIONS) {
      const rt = s.st[d.id]
      const reach = dist(d, tp)
      for (const ss of sessionsOf(s, d.id)) {
        if (ss.at > t) continue
        const rad = t - ss.at
        // Кольцо видно, пока идёт к буксиру, и ещё немного после.
        if (rad > reach + 0.35) continue
        const fade = Math.max(0.25, 1 - rad / 9)
        ring(x, mx(d.x), my(d.y), rad * MAP.k, C.cold, clip, fade)
      }
      // Ответ игрока: кольцо от буксира.
      if (rt.reply && t >= rt.reply.sent && t <= rt.reply.arrives + 0.6) {
        const p0 = posAt(s, rt.reply.sent)
        ring(x, mx(p0.x), my(p0.y), (t - rt.reply.sent) * MAP.k, C.fresh, clip, 0.9)
      }
    }
    // Вечерние сообщения на «Порог».
    for (const e of s.evenings) {
      const p0 = posAt(s, e.sent)
      const reach = dist(p0, FINALS.porog)
      if (t >= e.sent && t - e.sent <= reach + 0.3) ring(x, mx(p0.x), my(p0.y), (t - e.sent) * MAP.k, C.fresh, clip, 0.6)
    }
    // Кольца Веры. До раскрытия плоттер верит заголовкам и рисует их от «Порога».
    const relay = { x: tp.x + 0.42, y: tp.y + 0.28 }
    const morning = Math.ceil((t - 1e-6) / 24) * 24
    for (const m of [morning - 24, morning]) {
      if (m < 0 || m > 480) continue
      if (!s.vera.revealed) {
        const d0 = porogDelay(s, Math.min(m, s.t))
        const sent = m - d0
        const rad = t - sent
        if (rad > 0 && rad < d0 + 0.8) ring(x, mx(FINALS.porog.x), my(FINALS.porog.y), rad * MAP.k, C.amber, clip, Math.max(0.35, 1 - rad / 14))
      } else {
        const d0 = dist(relay, tp)
        const rad = t - (m - d0)
        if (rad > 0 && rad < d0 + 0.6) ring(x, mx(relay.x), my(relay.y), rad * MAP.k, C.amber, clip, 1)
      }
    }

    // Курс: пунктир.
    const legs = this.draft ?? activeLegs(s)
    let from = tp
    for (const leg of legs) {
      const to = place(leg.to)
      const steps = Math.max(1, Math.floor(dist(from, to) * MAP.k / 2))
      for (let i = 0; i <= steps; i += 2) {
        const k = i / steps
        fillRect(x, this.draft ? C.text : C.dim, Math.round(mx(from.x + (to.x - from.x) * k)), Math.round(my(from.y + (to.y - from.y) * k)), 1, 1)
      }
      from = to
    }

    // «Порог», «Перевал».
    fillRect(x, s.vera.revealed ? C.steel : C.text, Math.round(mx(FINALS.porog.x)), Math.round(my(FINALS.porog.y)), 2, 2)
    const pv = FINALS.pereval
    x.strokeStyle = C.dim
    fillRect(x, C.dim, Math.round(mx(pv.x)) - 1, Math.round(my(pv.y)) - 1, 3, 1)
    fillRect(x, C.dim, Math.round(mx(pv.x)) - 1, Math.round(my(pv.y)) + 1, 3, 1)
    fillRect(x, C.dim, Math.round(mx(pv.x)) - 1, Math.round(my(pv.y)), 1, 1)
    fillRect(x, C.dim, Math.round(mx(pv.x)) + 1, Math.round(my(pv.y)), 1, 1)

    // Станции.
    for (const d of STATIONS) {
      const v = stationView(s, d.id)
      const col = v.status === 'silent' ? C.steel : v.status === 'aboard' ? C.edge : C.ice
      const px = Math.round(mx(d.x))
      const py = Math.round(my(d.y))
      fillRect(x, col, px, py, 2, 2)
      if (this.selected === d.id || this.selectedHover === d.id) {
        x.fillStyle = C.fresh
        x.fillRect(px - 2, py - 2, 6, 1)
        x.fillRect(px - 2, py + 3, 6, 1)
        x.fillRect(px - 2, py - 2, 1, 6)
        x.fillRect(px + 3, py - 2, 1, 6)
      }
    }

    // Ретранслятор после раскрытия.
    if (s.vera.revealed) fillRect(x, C.amber, Math.round(mx(relay.x)), Math.round(my(relay.y)), 1, 1)

    // Буксир: треугольник 3×3 по курсу.
    const bx = Math.round(mx(tp.x))
    const by = Math.round(my(tp.y))
    const f = s.tug.flight
    const ang = f ? Math.atan2(place(f.to).y - f.fy, place(f.to).x - f.fx) : 0
    const dirX = Math.round(Math.cos(ang))
    const dirY = -Math.round(Math.sin(ang))
    x.fillStyle = C.fresh
    x.fillRect(bx, by, 1, 1)
    x.fillRect(bx - 1 + (dirX < 0 ? 2 : 0), by - 1, 1, 1)
    x.fillRect(bx - 1 + (dirX < 0 ? 2 : 0), by + 1, 1, 1)
    x.fillRect(bx - 1 + (dirX < 0 ? 2 : 0), by, 1, 1)
    x.fillRect(bx + dirX, by + dirY, 1, 1)
  }

  private drawRight(x: CanvasRenderingContext2D, now: number): void {
    const s = this.s!
    const R = PANEL.right
    // Лампа канала.
    const blink = performance.now() < this.blinkUntil && Math.floor(now * 2) % 2 === 1
    const lampCol = !s.vera.channelOn ? C.steel : blink ? C.steel : C.amber
    fillRect(x, lampCol, R.x + 3, R.y + 3, 6, 6)

    // Топливо: 50 делений по 2 единицы. Риска на 12.
    const fuel = Math.max(0, s.tug.fuel)
    const plan = simulatePlan(s, this.draft ?? activeLegs(s))
    const after = plan.legs.length ? Math.max(0, plan.legs[plan.legs.length - 1]!.fuelAfter) : fuel
    const y0 = R.y + 30
    for (let i = 0; i < 50; i++) {
      const lo = i * 2
      const col = lo + 1 <= after ? C.text : lo + 1 <= fuel ? C.steel : C.edge
      fillRect(x, col, R.x + 1 + i * 3, y0, 2, 5)
    }
    fillRect(x, C.fresh, R.x + 1 + 6 * 3 - 1, y0 - 2, 1, 9)

    // Места: 12 квадратов в два ряда.
    const n = s.tug.aboard.length
    for (let i = 0; i < SEATS; i++) {
      const cx = R.x + 3 + (i % 6) * 7
      const cy = R.y + 41 + Math.floor(i / 6) * 7
      if (i < n) fillRect(x, C.text, cx, cy, 5, 5)
      else {
        x.fillStyle = C.edge
        x.fillRect(cx, cy, 5, 1)
        x.fillRect(cx, cy + 4, 5, 1)
        x.fillRect(cx, cy, 1, 5)
        x.fillRect(cx + 4, cy, 1, 5)
      }
    }
  }
}

const BAND: [number, number][] = (() => {
  const out: [number, number][] = []
  const Cp = PANEL.center
  for (let py = Cp.y; py < Cp.y + Cp.h; py++) {
    for (let px = Cp.x; px < Cp.x + Cp.w; px++) {
      const ly = MAP.maxY - (py - MAP.y0) / MAP.k
      const lx = MAP.minX + (px - MAP.x0) / MAP.k
      if (Math.abs(ly - (0.35 + lx * 0.02)) < 3.4 && (px + py * 3) % 11 === 0) out.push([px, py])
    }
  }
  return out
})()

function u(n: number): string {
  return `calc(var(--u) * ${n})`
}

export function pos(x: number, y: number): Record<string, string> {
  return { left: u(x), top: u(y) }
}

function ageShort(a: number): string {
  const m = Math.max(0, Math.round(a * 60))
  const hh = Math.floor(m / 60)
  const mm = m % 60
  if (hh >= 48) return `${Math.round(hh / 24)} сут`
  if (hh >= 10) return `${hh} ч`
  if (hh === 0) return `${mm} мин`
  return `${hh} ч ${String(mm).padStart(2, '0')}`
}

/** Пять статусов простыми словами (механика 2.0, раздел 5). */
const STATUS_WORD: Record<Exclude<StationView['status'], 'silent' | 'aboard'>, string> = {
  course: 'на курсе',
  off: 'можно успеть',
  out: 'не успеть',
}

function rowClass(v: StationView): string {
  if (v.status === 'silent') return 'old silent'
  if (v.status === 'aboard') return 'mid'
  if (v.age === null) return 'old'
  if (v.age < AGE_FRESH) return 'fresh'
  if (v.age < AGE_MID) return 'mid'
  return 'old'
}

export { SCRIPTS }
