// Экраны поверх пульта: карточка сигнала, планировщик, канал, архив, борт, эфир и финал.
// Панель закрывает пульт и нижнюю часть окна; верхние 48 пикселей космоса видны всегда.

import { personStatus } from '../content/board'
import { eveningOptions, eveningText, LAST_WORDS } from '../content/evenings'
import { PEOPLE } from '../content/people'
import {
  DRIFT_SCENE,
  epilogueArrival,
  epilogueOpening,
  PEREVAL_EARLY,
  porogTurnScene,
  PROLOGUE,
  RECEIPT_AFTER,
  RECEIPT_BEFORE,
  ZOYA_SCENE,
} from '../content/scenes'
import { replyText, SCRIPTS } from '../content/stations'
import {
  confirmCourse,
  FINAL_WAIT,
  GEN,
  LAST_FLIGHT_HINT,
  WORD_EFFECT,
  DRAIN_ONCE,
  drainLive,
  drainSilent,
  ECO_CONSEQUENCES,
  ECO_NO_UNDO,
  HELP,
  JOURNAL,
  journalMark,
  lateNumbers,
  MODE_SWITCH_ONCE,
  statusLine,
} from '../content/ui-text'
import type { ReplyKind, VeraFile } from '../content/types'
import { recLabel, VERA, VERA_MAIN, VERA_TAKES } from '../content/vera'
import {
  activeLegs,
  aboardPeople,
  airEnd,
  applyPlan,
  canDrain,
  continueAfterFinal,
  canOrderEco,
  chooseEvening,
  courseState,
  deserialize,
  directCalc,
  drain,
  efirStations,
  endingLines,
  type EpilogueItem,
  finalFlight,
  finalFlights,
  type GameState,
  inPlan,
  journalView,
  type JournalItem,
  newGame,
  nextLabel,
  type Notice,
  orderEco,
  planCheck,
  porogDelay,
  receivedSessions,
  replyOptions,
  runEpilogue,
  sendLastWords,
  serialize,
  sendReply,
  signalEnd,
  simulatePlan,
  stationView,
  tugPos,
  type VeraPlay,
} from '../sim/engine'
import {
  clockOf,
  dist,
  DOCK_H,
  DRAIN_H,
  ECO_AIR_H,
  ECO_DOCK_H,
  isFinal,
  type Leg,
  MIN_FLIGHT,
  MODE_IDS,
  MODES,
  type PlaceId,
  placeName,
  SEATS,
  STATION,
  type StationId,
  STATIONS,
  TANK,
} from '../sim/world'
import { api, isElectron } from './api'
import type { App } from './app'
import { audio } from './audio'
import { add, clear, h, speech } from './dom'
import { dur, hours, plural, short, stamp } from './format'

// ——— каркас ———

interface Shell {
  el: HTMLElement
  body: HTMLElement
  foot: HTMLElement
}

function shell(app: App, id: string, title: string, opts: { modal?: boolean; cls?: string; noClose?: boolean; onClose?: () => void } = {}): Shell {
  const body = h('div', { class: 'p-body' })
  const foot = h('div', { class: 'p-foot' })
  const head = h(
    'div',
    { class: 'p-head' },
    h('div', { class: 'px p-title' }, title),
    opts.modal || opts.noClose ? null : h('button', { class: 'btn px p-close', onclick: () => app.closePanel(), title: 'Esc' }, 'ЗАКРЫТЬ'),
  )
  const el = h('section', { class: `p ${opts.cls ?? ''}` }, head, body, foot)
  app.openPanel(el, id, !!opts.modal, opts.onClose)
  return { el, body, foot }
}

function btn(label: string, fn: () => void, cls = '', disabled = false, title?: string): HTMLButtonElement {
  return h('button', { class: `btn px ${cls}`, onclick: fn, disabled, title }, label) as HTMLButtonElement
}

function field(name: string, value: string | HTMLElement, cls = ''): HTMLElement {
  return h('div', { class: `field ${cls}` }, h('span', { class: 'f-name' }, name), typeof value === 'string' ? h('span', { class: 'f-val' }, value) : value)
}

function late(m: number, prefix = ''): HTMLElement {
  if (m < 0) return h('span', { class: 'late' }, `${prefix}опоздание ${hours(m)}`)
  return h('span', null, `${prefix}запас ${hours(m)}`)
}

function scrollEnd(el: HTMLElement): void {
  requestAnimationFrame(() => (el.scrollTop = el.scrollHeight))
}

function veraBlock(text: string): HTMLElement {
  return h('div', { class: 'vera' }, h('div', { class: 'vera-mark' }), speech(text))
}

// ——— меню ———

export function title(app: App): void {
  const box = h('div', { class: 'title-screen' })
  const menu = h('div', { class: 'title-menu' })
  box.append(
    h('div', { class: 'px title-word' }, 'ЗАДЕРЖКА'),
    h('div', { class: 'data title-sub' }, 'Сигналы идут часами. Буксир летит сутками.'),
    menu,
    h('div', { class: 'data title-ver' }, `версия ${__APP_VERSION__}`),
  )
  const fill = (hasRun: boolean, s: GameState | null) => {
    clear(menu)
    if (hasRun && s) {
      menu.append(btn(s.final.stage === 'after' ? 'АРХИВ РЕЙСА' : 'ПРОДОЛЖИТЬ', () => app.resume(s), 'big'))
    }
    add(
      menu,
      btn(
        'НОВЫЙ РЕЙС',
        () => {
          if (hasRun && s && s.final.stage !== 'after') {
            confirm(app, 'Начать новый рейс? Текущий будет потерян.', () => app.newRun())
          } else app.newRun()
        },
        'big',
      ),
      btn('НАСТРОЙКИ', () => settings(app, () => title(app)), 'big'),
      isElectron ? btn('ВЫХОД', () => api.quit(), 'big') : null,
    )
  }
  app.layer.append(box)
  app.panelOpen = 'title'
  fill(false, null)
  void app.loadRun().then((s) => fill(!!s, s))
  void api.checkUpdate().then((upd) => {
    if (!upd) return
    box.append(h('button', { class: 'data title-upd link', onclick: () => api.openExternal(upd.url) }, `Вышла версия ${upd.version}`))
  })
}

function confirm(app: App, text: string, yes: () => void): void {
  const prev = app.layer.firstElementChild
  const box = h(
    'div',
    { class: 'confirm' },
    h('div', { class: 'data' }, text),
    h('div', { class: 'row-btns' }, btn('ДА', () => yes()), btn('НЕТ', () => box.remove())),
  )
  ;(prev ?? app.layer).append(box)
}

export function prologue(app: App, done: () => void): void {
  const { body, foot } = shell(app, 'prologue', 'РЕЙС', { modal: true, cls: 'narrow' })
  const lines = PROLOGUE.map((p) => speech(p))
  body.append(...lines)
  body.append(
    h(
      'div',
      { class: 'data dimtxt help' },
      'Время идёт, только когда ты нажимаешь «Дальше». Думать над курсом можно сколько угодно.',
    ),
  )
  foot.append(
    btn(
      'ДАЛЬШЕ',
      () => {
        app.closePanel(false)
        done()
      },
      'primary',
    ),
  )
}

export function menu(app: App): void {
  const { body } = shell(app, 'menu', 'МЕНЮ', { cls: 'narrow' })
  body.append(
    h(
      'div',
      { class: 'menu-list' },
      btn('ПРОДОЛЖИТЬ', () => app.closePanel(), 'big'),
      btn('КАК ИГРАТЬ', () => help(app), 'big'),
      btn('НАСТРОЙКИ', () => settings(app, () => menu(app)), 'big'),
      btn('ГЛАВНОЕ МЕНЮ', () => app.showTitle(), 'big'),
      isElectron ? btn('ВЫХОД', () => api.quit(), 'big') : null,
    ),
  )
}

export function help(app: App): void {
  const { body } = shell(app, 'help', 'КАК ИГРАТЬ', { cls: 'narrow' })
  const keys = [...HELP.keys]
  keys.splice(3, 0, ['J', 'журнал'])
  body.append(
    speech(HELP.rule),
    h('div', { class: 'px sub' }, 'СЛОВА'),
    h('div', { class: 'data help-words' }, ...HELP.words.map(([w, text]) => h('div', null, h('span', { class: 'kbd' }, w), ` ${text}`))),
    h('div', { class: 'px sub' }, 'КЛАВИШИ'),
    h('div', { class: 'data help-grid' }, ...keys.map(([k, v]) => h('div', null, h('span', { class: 'kbd' }, k), ` ${v}`))),
    h('div', { class: 'data dimtxt help' }, HELP.card),
  )
}

export function settings(app: App, back: () => void): void {
  const { body, foot } = shell(app, 'settings', 'НАСТРОЙКИ', { cls: 'narrow', noClose: true, onClose: back })
  const st = app.settings
  const sound = h('input', { type: 'checkbox' }) as HTMLInputElement
  sound.checked = st.sound
  sound.onchange = () => {
    st.sound = sound.checked
    app.saveSettings()
  }
  const music = h('input', { type: 'checkbox' }) as HTMLInputElement
  music.checked = st.music
  music.onchange = () => {
    st.music = music.checked
    app.saveSettings()
  }
  const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05' }) as HTMLInputElement
  vol.value = String(st.volume)
  vol.oninput = () => {
    st.volume = Number(vol.value)
    app.saveSettings()
  }
  const big = h('input', { type: 'checkbox' }) as HTMLInputElement
  big.checked = st.bigText
  big.onchange = () => {
    st.bigText = big.checked
    app.saveSettings()
  }
  const hints = h('input', { type: 'checkbox' }) as HTMLInputElement
  hints.checked = st.hints
  hints.onchange = () => {
    st.hints = hints.checked
    app.saveSettings()
    app.refresh()
  }
  body.append(
    h('label', { class: 'data opt' }, sound, ' Звуки событий и сигналов'),
    h('label', { class: 'data opt' }, music, ' Фоновая музыка'),
    h('label', { class: 'data opt' }, 'Громкость ', vol),
    h('label', { class: 'data opt' }, big, ' Крупный текст речи'),
    h('label', { class: 'data opt' }, hints, ' Подсказки первого дня в строке состояния'),
    h('div', { class: 'opt' }, btn('ПОЛНЫЙ ЭКРАН', () => api.toggleFullscreen())),
    h('div', { class: 'data dimtxt help' }, 'Если в системе включено «уменьшить движение», космос за окном не движется и не мерцает.'),
  )
  foot.append(btn('НАЗАД', () => app.closePanel(), 'primary'))
}

// ——— карточка сигнала ———

/** День и время словами карточки: «дня 10, 20:00». */
function dayTime(t: number): string {
  const c = clockOf(t)
  return `дня ${c.day}, ${String(c.h).padStart(2, '0')}:${String(c.m).padStart(2, '0')}`
}

/** Текст, в котором «опоздание N ч» красное, а остальное обычное: красный только у числа опоздания. */
function redLate(text: string): HTMLElement {
  const box = h('span')
  for (const part of text.split(/(опоздание [\d,]+ (?:ч|мин))/)) {
    if (/^опоздание /.test(part)) box.append(h('span', { class: 'late' }, part))
    else if (part) box.append(part)
  }
  return box
}

/** «4 сут 17 ч» — продолжительность перелёта на кнопке режима. */
function span(hh: number): string {
  const total = Math.round(hh)
  const d = Math.floor(total / 24)
  const r = total % 24
  return d ? `${d} сут ${r} ч` : `${r} ч`
}

/** Кнопка «Дальше», которую пробел нажимает при открытой панели: только чистое продолжение. */
function mainNext(label: string, fn: () => void): HTMLButtonElement {
  const b = btn(label, fn, 'primary')
  b.setAttribute('data-space', '')
  return b
}

export function card(app: App, id: StationId): void {
  const s = app.s
  if (!s) return
  const def = STATION[id]
  const rt = s.st[id]
  const v = stationView(s, id)
  const { body, foot } = shell(app, 'card', `«${def.name.toUpperCase()}»`, { cls: 'wide' })
  app.selected = id

  // Шесть блоков сверху вниз: кто, воздух, успеваю ли, топливо, переписка, слово и распоряжение.
  const top = h('div', { class: 'card-top data' })
  const right = h('div', { class: 'col-r transcript card-log' })
  body.append(h('div', { class: 'card-col' }, top, right))

  const travel = dur(dist(tugPos(s), def))
  const line = (...kids: (string | HTMLElement | null)[]) => h('div', { class: 'card-line' }, ...kids)

  // 1. Кто это и сколько их.
  top.append(h('div', { class: 'dimtxt about' }, SCRIPTS[id].about), line(`Людей по сигналу: ${def.people}.`))

  // 2. Воздух и возраст сигнала. Световые часы живут только здесь.
  if (rt.rescued) {
    top.append(line(`На борт поднялось: ${rt.boarded}.`))
  } else if (rt.silentHeard !== null || rt.arrived !== null) {
    top.append(line(`До буксира дошла тишина: ${stamp(rt.silentHeard ?? rt.arrived!)}.`))
  } else {
    const age = v.age === null ? 'сигналов ещё не было' : `Сказано ${dur(v.age)} назад.`
    top.append(
      line(`Воздуха до ${dayTime(signalEnd(s, id))}. ${age}`),
      h('div', { class: 'dimtxt card-line' }, `Сигнал идёт ${travel}.`),
    )
  }

  // 3. Успеваю ли: одна строка, по текущему плану или по прямой.
  if (v.status !== 'aboard' && v.status !== 'silent' && rt.arrived === null) {
    if (v.status === 'course') {
      const r = simulatePlan(s, activeLegs(s)).legs.find((l) => l.leg.to === id)
      if (r && v.margin !== null) top.append(line(`По курсу: прибытие ${short(r.arrive)}, `, redLate(v.margin < 0 ? `опоздание ${hours(v.margin)}` : `запас ${hours(v.margin)}`), '.'))
    } else {
      const calc = directCalc(s, id).filter((c) => c.fuelOk)
      const best = calc.sort((a, b) => b.margin - a.margin)[0]
      if (best) top.append(line(`По прямой: ${MODES[best.mode].name}, прибытие ${short(best.arrive)}, `, redLate(best.margin < 0 ? `опоздание ${hours(best.margin)}` : `запас ${hours(best.margin)}`), '.'))
      else top.append(line('По прямой: на перелёт не хватает топлива.'))
    }
  }

  // 4. Топливо станции.
  top.append(line(`Топлива на станции: ${def.stock}${rt.drained ? ' · слито' : ''}.`))

  // 5. Переписка.
  const sessions = receivedSessions(s, id)
  const unreadIds = new Set(sessions.slice(Math.max(0, sessions.length - rt.unread)).map((ss) => ss.id))
  const thread = [
    ...sessions.map((session) => ({ at: session.at, kind: 'station' as const, session })),
    ...(rt.reply ? [{ at: rt.reply.sent, kind: 'player' as const, reply: rt.reply }] : []),
    ...(rt.order ? [{ at: rt.order.sent, kind: 'order' as const, order: rt.order }] : []),
    ...(rt.silentHeard !== null && !rt.rescued ? [{ at: rt.silentHeard, kind: 'silence' as const }] : []),
  ].sort((a, b) => a.at - b.at)
  for (const l of thread) {
    if (l.kind === 'station') {
      const ss = l.session
      right.append(
        h(
          'div',
          { class: `sess${unreadIds.has(ss.id) ? ' new' : ''}` },
          h('div', { class: 'data sess-head' }, `${stamp(ss.at)}${ss.letter ? ' · письмо' : ''}`),
          speech(ss.text),
        ),
      )
    } else if (l.kind === 'player') {
      const rp = l.reply
      right.append(
        h(
          'div',
          { class: 'sess mine' },
          h('div', { class: 'data sess-head' }, `«Тихоход» · ${stamp(rp.sent)} · ${s.t >= rp.arrives ? `дошло ${short(rp.arrives)}` : `дойдёт ${short(rp.arrives)}`}`),
          speech(rp.text),
        ),
      )
    } else if (l.kind === 'order') {
      right.append(
        h(
          'div',
          { class: 'sess mine' },
          h('div', { class: 'data sess-head' }, `«Тихоход» · ${stamp(l.order.sent)} · ${s.t >= l.order.arrives ? `дошло ${short(l.order.arrives)}` : `дойдёт ${short(l.order.arrives)}`}`),
          speech('[распоряжение: экономия]'),
        ),
      )
    } else {
      right.append(h('div', { class: 'data dimtxt sess-end' }, `${stamp(l.at)} · до буксира дошла тишина`))
    }
  }
  rt.unread = 0
  scrollEnd(right)

  // 6. Слово и распоряжение — раздельно, у каждого одна строка о последствии.
  const acts = h('div', { class: 'acts' })
  const opts = replyOptions(s, id)
  if (opts.length) {
    const labels: Record<ReplyKind, string> = { truth: 'ПРАВДА', hold: 'ДЕРЖИТЕСЬ, Я ИДУ', eta: 'ТОЧНОЕ ВРЕМЯ', papa: 'ПОЗОВИ ПАПУ' }
    const burn = directCalc(s, id).find((c) => c.mode === 'burn')!
    const legRes = simulatePlan(s, activeLegs(s)).legs.find((l) => l.leg.to === id)
    const info = { late: `опоздание ${hours(burn.margin)}`, eta: legRes ? stamp(legRes.arrive) : '' }
    let chosen: ReplyKind | null = null
    const preview = h('div', { class: 'reply-preview' })
    const send = btn('ОТПРАВИТЬ СЛОВО', () => {
      if (!chosen) return
      sendReply(s, id, chosen, replyText(chosen, def.name, info))
      app.save()
      app.refresh()
      card(app, id)
    }, 'primary', true)
    const buttons = opts.map((k) => {
      const b = btn(labels[k], () => {
        chosen = k
        for (const x of buttons) x.classList.toggle('on', x === b)
        clear(preview)
        preview.append(speech(replyText(k, def.name, info)))
        send.disabled = false
      })
      return b
    })
    acts.append(
      h(
        'div',
        { class: 'act' },
        h('div', { class: 'px sub' }, 'СЛОВО'),
        h('div', { class: 'row-btns' }, ...buttons),
        preview,
        h('div', { class: 'data dimtxt' }, WORD_EFFECT(travel)),
        send,
      ),
    )
  }
  if (!rt.rescued && rt.silentHeard === null && rt.arrived === null && (canOrderEco(s, id) || rt.order)) {
    const act = h('div', { class: 'act' }, h('div', { class: 'px sub' }, 'РАСПОРЯЖЕНИЕ'))
    if (rt.order) {
      act.append(h('div', { class: 'data' }, `Экономия: отправлено ${short(rt.order.sent)}, ${s.t >= rt.order.arrives ? 'дошло' : 'дойдёт'} ${short(rt.order.arrives)}.`))
    } else {
      const confirm = h('div', { class: 'eco-ask hidden' })
      confirm.append(
        ...ECO_CONSEQUENCES.map((c) => h('div', { class: 'data' }, `· ${c}`)),
        h('div', { class: 'data' }, ECO_NO_UNDO),
        h(
          'div',
          { class: 'row-btns' },
          btn('ОТМЕНА', () => confirm.classList.add('hidden')),
          btn('ОТДАТЬ РАСПОРЯЖЕНИЕ', () => {
            if (!orderEco(s, id)) return
            app.save()
            app.refresh()
            card(app, id)
          }),
        ),
      )
      act.append(
        h('div', { class: 'row-btns' }, btn('ЭКОНОМИЯ', () => confirm.classList.toggle('hidden'))),
        h('div', { class: 'data dimtxt' }, `Дойдёт через ${travel}. Воздуха +${ECO_AIR_H} ч, люди замолчат, стыковка ${DOCK_H + ECO_DOCK_H} ч.`),
        confirm,
      )
    }
    acts.append(act)
  }
  if (!rt.rescued && rt.arrived === null && !inPlan(s, id) && !s.ending) {
    acts.append(
      h(
        'div',
        { class: 'act act-to' },
        btn('В КУРС', () => {
          const legs = app.draft ?? activeLegs(s)
          const fin = legs.findIndex((l) => isFinal(l.to))
          const leg: Leg = { to: id, mode: 'cruise' }
          const next = [...legs]
          if (fin >= 0) next.splice(fin, 0, leg)
          else next.push(leg)
          app.draft = next
          planner(app)
        }),
      ),
    )
  }
  if (acts.children.length) foot.append(acts)
  app.refresh()
  app.save()
}

// ——— планировщик ———

/** Лента времени строки: полоса воздуха по сигналу и риска прибытия на общей шкале всего курса. */
function timeline(t0: number, t1: number, end: number, arrive: number): HTMLElement {
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - t0) / (t1 - t0)) * 100)).toFixed(2)}%`
  return h(
    'div',
    { class: 'tl', title: `воздух по сигналу до ${short(end)} · прибытие ${short(arrive)}` },
    h('div', { class: 'tl-air', style: { width: pct(end) } }),
    h('div', { class: 'tl-at', style: { left: pct(arrive) } }),
  )
}

export function planner(app: App, focus?: PlaceId | 'last'): void {
  const s = app.s
  if (!s) return
  app.hintSeen.planner = true
  if (s.ending) {
    const { body } = shell(app, 'planner', 'КУРС', { cls: 'wide' })
    body.append(h('div', { class: 'data' }, 'Рейс окончен. Буксир больше никуда не летит.'))
    return
  }
  if (!app.draft) app.draft = activeLegs(s).map((l) => ({ ...l }))
  const legs = app.draft
  const { body, foot } = shell(app, 'planner', 'ПЛАНИРОВЩИК КУРСА', { cls: 'wide scroll' })
  const r = simulatePlan(s, legs)
  const err = planCheck(s, legs)
  const flying = s.tug.flight
  const trial = (i: number, patch: Partial<Leg>) => simulatePlan(s, legs.map((l, j) => (j === i ? { ...l, ...patch } : l))).legs[i]!

  // Общая шкала: от сейчас до самого позднего конца воздуха или прибытия.
  let t1 = s.t + 1
  // «Перевал» в шкалу не входит: он уйдёт на трое суток вправо, и запас станций станет несколькими пикселями.
  for (const lr of r.legs) {
    if (isFinal(lr.leg.to)) continue
    t1 = Math.max(t1, lr.arrive, signalEnd(s, lr.leg.to))
  }
  t1 += (t1 - s.t) * 0.02

  if (flying && courseState(s).k === 'late' && !app.onceSeen.modeSwitch) body.append(h('div', { class: 'data dimtxt plan-once' }, MODE_SWITCH_ONCE))

  const table = h('div', { class: 'plan data' })
  table.append(h('div', { class: 'plan-axis dimtxt' }, h('span', null, `шкала времени: ${short(s.t)}`), h('span', null, short(t1))))
  r.legs.forEach((lr, i) => {
    const leg = lr.leg
    const isSt = !isFinal(leg.to)
    const onCourse = i === 0 && !!flying && flying.to === leg.to
    const rtSt = isSt ? s.st[leg.to as StationId] : null
    const modes = h(
      'span',
      { class: 'modes' },
      ...MODE_IDS.map((m) => {
        const tr = trial(i, { mode: m })
        const md = MODES[m]
        const price = onCourse ? (m === flying!.mode ? 0 : Math.abs(md.acc - MODES[flying!.mode].acc)) + md.brk : md.acc + md.brk
        const time = onCourse ? tr.arrive - s.t : tr.arrive - tr.depart
        return h(
          'button',
          {
            class: `mode${leg.mode === m ? ' on' : ''}${tr.fuelOk ? '' : ' dis'}`,
            onclick: () => {
              legs[i] = { ...leg, mode: m }
              planner(app)
            },
            title: `${md.name}: ${md.h} ч на св. ч, разгон ${md.acc} + торможение ${md.brk}${tr.fuelOk ? '' : '. Топлива не хватает'}`,
          },
          `${md.short} · ${price} · ${span(time)}`,
        )
      }),
    )
    const opts = h('span', { class: 'leg-opts' })
    if (isSt && rtSt && !rtSt.drained && STATION[leg.to as StationId].stock > 0) {
      const on = !!leg.drain
      const gain = on ? lr.drained : trial(i, { drain: true }).drained
      opts.append(
        h(
          'button',
          {
            class: `mode drain${on ? ' on' : ''}`,
            onclick: () => {
              const next: Leg = { ...leg, drain: !on }
              if (!next.drain) delete next.drain
              legs[i] = next
              planner(app)
            },
            title: 'Слить топливо станции в бак, когда буксир пристыкуется',
          },
          `слить топливо: +${gain}, +${DRAIN_H} ч`,
        ),
      )
    }
    if (rtSt?.order) opts.append(h('span', { class: 'dimtxt' }, `экономия: +${ECO_AIR_H} ч воздуха, стыковка ${DOCK_H + ECO_DOCK_H} ч`))
    const move = (d: number) => {
      const j = i + d
      if (j < 0 || j >= legs.length) return
      ;[legs[i], legs[j]] = [legs[j]!, legs[i]!]
      planner(app)
    }
    const focused = focus === leg.to || (focus === 'last' && i === r.legs.length - 1)
    table.append(
      h(
        'div',
        { class: `leg${lr.fuelOk ? '' : ' bad'}${focused ? ' focus' : ''}` },
        h(
          'div',
          { class: 'leg-top' },
          h('span', { class: 'dimtxt' }, String(i + 1)),
          h('span', { class: 'plan-to' }, `«${placeName(leg.to)}»`, lr.current || onCourse ? h('span', { class: 'dimtxt' }, ' · в полёте') : null),
          h('span', null, `прибытие ${short(lr.arrive)}`),
          lr.margin === null ? h('span', { class: 'dimtxt' }, '') : late(lr.margin),
          lr.fuelOk ? h('span', null, `в баке останется ${Math.round(lr.fuelAfter)}`) : h('span', { class: 'warn' }, 'топлива не хватает'),
          h(
            'span',
            { class: 'plan-ops' },
            h('button', { class: 'op', onclick: () => move(-1), title: 'выше' }, '↑'),
            h('button', { class: 'op', onclick: () => move(1), title: 'ниже' }, '↓'),
            h(
              'button',
              {
                class: 'op',
                onclick: () => {
                  legs.splice(i, 1)
                  planner(app)
                },
                title: 'убрать',
              },
              '×',
            ),
          ),
        ),
        h('div', { class: 'leg-mid' }, modes, opts),
        lr.switchCost !== null ? h('div', { class: 'data leg-note' }, `${MODES[leg.mode].short} с этой минуты: +${lr.switchCost} сейчас, прибытие ${short(lr.arrive)}`) : null,
        isSt ? timeline(s.t, t1, signalEnd(s, leg.to as StationId), lr.arrive) : null,
      ),
    )
  })
  if (!legs.length) table.append(h('div', { class: 'data dimtxt' }, 'Курс пуст.'))

  // Добавить станцию.
  const sel = h('select', { class: 'data' }) as HTMLSelectElement
  sel.append(h('option', { value: '' }, 'добавить точку…'))
  for (const d of STATIONS) {
    const rt = s.st[d.id]
    if (rt.rescued || rt.arrived !== null || legs.some((l) => l.to === d.id)) continue
    const v = stationView(s, d.id)
    sel.append(h('option', { value: d.id }, `«${d.name}» · ${d.people} чел.${v.status === 'silent' ? ' · молчит' : ''}`))
  }
  if (!legs.some((l) => isFinal(l.to))) {
    sel.append(h('option', { value: 'pereval' }, '«Перевал» · пересадочный узел, конец рейса'))
    sel.append(h('option', { value: 'porog' }, '«Порог» · база'))
  }
  sel.onchange = () => {
    const to = sel.value as PlaceId
    if (!to) return
    const fin = legs.findIndex((l) => isFinal(l.to))
    const leg: Leg = { to, mode: isFinal(to) ? 'eco' : 'cruise' }
    if (!isFinal(to) && fin >= 0) legs.splice(fin, 0, leg)
    else legs.push(leg)
    planner(app)
  }

  // Итог: строка состояния, борт, топливо. Шкала бака с отметкой 12.
  const finalLeg = legs.find((l) => isFinal(l.to))
  const stLegs = r.legs.filter((l) => !isFinal(l.leg.to))
  const beforeFinal = stLegs.length ? stLegs[stLegs.length - 1]!.fuelAfter : s.tug.fuel
  const fuelLine = finalLeg
    ? r.fuelEnd < -0.5
      ? `У «${GEN[finalLeg.to]}» не хватает топлива: ${Math.ceil(-r.fuelEnd)}.`
      : `У «${GEN[finalLeg.to]}» останется: ${Math.round(r.fuelEnd)}.`
    : r.perevalOk
      ? `После курса в баке ${Math.round(r.fuelEnd)}: до «Перевала» хватает.`
      : `После курса в баке ${Math.round(Math.max(0, r.fuelEnd))}: до «Перевала» не хватает ${Math.ceil(MIN_FLIGHT - Math.max(0, r.fuelEnd))}.`
  const pctFuel = (n: number) => `${Math.max(0, Math.min(100, (n / TANK) * 100)).toFixed(2)}%`
  const bar = h(
    'div',
    { class: 'fuelbar', title: `бак ${TANK}; отметка ${MIN_FLIGHT} — экономный перелёт до «Перевала»` },
    h('div', { class: 'fb-fill', style: { width: pctFuel(beforeFinal) } }),
    h('div', { class: 'fb-mark', style: { left: pctFuel(MIN_FLIGHT) } }),
  )
  const summary = h(
    'div',
    { class: 'plan-sum data' },
    h('div', null, redLate(statusLine(courseState(s, legs)))),
    h('div', null, `На борту к концу курса: ${r.saved}. ${fuelLine}`),
    h('div', { class: 'dimtxt' }, `Бак перед финалом: ${Math.round(Math.max(0, beforeFinal))} из ${TANK}. Отметка ${MIN_FLIGHT} — экономный перелёт до «Перевала».`),
    bar,
    err ? h('div', { class: 'warn' }, err) : null,
  )
  body.append(table, h('div', { class: 'plan-add' }, sel), summary)

  const idle = !flying && s.tug.dockUntil === null
  const doApply = () => {
    const res = applyPlan(s, legs)
    if (!res.ok) return
    if (r.legs[0]?.switchCost) app.onceSeen.modeSwitch = true
    app.draft = null
    app.closePanel(false)
    app.afterChange(res.notices as Notice[])
  }
  const approve = () => {
    const q = confirmCourse(courseState(s, legs))
    if (!q) return doApply()
    clear(foot)
    foot.append(
      h('div', { class: 'data ask' }, redLate(q)),
      btn('НАЗАД', () => planner(app)),
      btn('УТВЕРДИТЬ', doApply, 'primary'),
    )
  }
  foot.append(
    btn('СБРОСИТЬ ПРАВКИ', () => {
      app.draft = null
      planner(app)
    }),
    btn(idle && legs.length ? 'УТВЕРДИТЬ И ЛЕТЕТЬ' : 'УТВЕРДИТЬ КУРС', approve, 'primary', !!err || (!!flying && !legs.length)),
  )
  app.refresh()
  if (focus) requestAnimationFrame(() => table.querySelector('.focus')?.scrollIntoView({ block: 'nearest' }))
}

// ——— стоянка ———

/** Запас или опоздание словами: красным только опоздание. */
function marginText(m: number | null): HTMLElement {
  if (m === null) return h('span', { class: 'dimtxt' }, '—')
  return late(m)
}

/** Экран стоянки: кто поднялся, сколько мест занято, когда вылет, слив и сдвиг запаса дальше по курсу. */
export function dock(app: App, id: StationId): void {
  const s = app.s
  if (!s) return
  const def = STATION[id]
  const rt = s.st[id]
  const { body, foot } = shell(app, 'dock', `СТОЯНКА · «${def.name.toUpperCase()}»`, { cls: 'wide scroll' })
  const line = (...kids: (string | HTMLElement | null)[]) => h('div', { class: 'card-line data' }, ...kids)

  // Кто поднялся.
  if (rt.rescued) {
    const names = PEOPLE.filter((p) => p.station === id && s.tug.aboard.includes(p.id)).map((p) => p.name)
    body.append(line(`Поднялось на борт: ${rt.boarded}${rt.boarded < def.saved ? `. Мест не хватило: ждали ${def.saved}` : ''}.`))
    if (names.length) body.append(h('div', { class: 'data dimtxt card-line' }, names.join(', ')))
  } else if (rt.arrived !== null) {
    body.append(line('Станция молчит. Никто не поднялся.'), line(lateNumbers(airEnd(s, id), rt.arrived)))
  }
  body.append(line(`Мест занято: ${s.tug.aboard.length} из ${SEATS}.`))

  // Когда вылет.
  const next = s.plan[0]
  if (s.tug.dockUntil !== null) {
    // К «Перевалу» и «Порогу» буксир сам до прощания не уходит: называем конец стоянки, а не вылет.
    const holds = !!next && isFinal(next.to) && s.final.stage !== 'cont'
    body.append(line(holds ? `Стоянка до ${short(s.tug.dockUntil)}.` : `Вылет: ${short(s.tug.dockUntil)}${next ? ` · «${placeName(next.to)}»` : ''}.`))
    if (holds) body.append(h('div', { class: 'data dimtxt card-line' }, `Следом по курсу «${placeName(next!.to)}». Когда стоянка кончится, откроется планировщик.`))
    if (!next) body.append(h('div', { class: 'data dimtxt card-line' }, 'Следующей цели в курсе нет. Когда стоянка кончится, откроется планировщик.'))
  }

  if (next?.to === 'pereval' && s.final.stage === 'none') body.append(line(FINAL_WAIT))

  // Слив.
  const done = app.drained[id]
  if (rt.drained) {
    body.append(line(done === undefined ? 'Топливо станции слито в бак.' : rt.silentHeard !== null ? drainSilent(id, done) : drainLive(id, done)))
  } else if (canDrain(s)) {
    if (!app.onceSeen.drain) {
      body.append(h('div', { class: 'data dimtxt card-line' }, DRAIN_ONCE))
      app.onceSeen.drain = true
    }
    const gain = Math.max(0, Math.min(TANK, s.tug.fuel + def.stock) - s.tug.fuel)
    body.append(
      h(
        'div',
        { class: 'act' },
        btn(`Слить топливо: +${gain}, вылет на ${DRAIN_H} ч позже`, () => {
          const n = drain(s)
          const got = n.find((x) => x.k === 'drain')
          if (got && got.k === 'drain') app.drained[id] = got.fuel
          app.save()
          app.refresh()
          dock(app, id)
        }),
      ),
    )
    // Как сдвинется запас дальше по курсу: прогон на копии состояния, без вмешательства в движок.
    const copy = deserialize(serialize(s))
    if (copy && s.plan.length) {
      const before = simulatePlan(s, s.plan)
      drain(copy)
      const after = simulatePlan(copy, copy.plan)
      const rows = before.legs.map((lr, i) => ({ lr, al: after.legs[i] })).filter((x) => !isFinal(x.lr.leg.to) && x.lr.margin !== null && x.al)
      if (rows.length) {
        body.append(h('div', { class: 'px sub' }, 'ЗАПАС НА СЛЕДУЮЩИХ СТАНЦИЯХ, ЕСЛИ СЛИТЬ'))
        for (const x of rows)
          body.append(
            h('div', { class: 'data card-line dock-shift' }, h('span', null, `«${placeName(x.lr.leg.to)}»: `), marginText(x.lr.margin), h('span', { class: 'dimtxt' }, ' → '), marginText(x.al!.margin)),
          )
      }
    }
  } else if (def.stock === 0) {
    body.append(line('Топлива на станции нет.'))
  }

  foot.append(
    mainNext(nextLabel(s).toUpperCase(), () => {
      app.closePanel(false)
      app.step('next')
    }),
  )
}

// ——— журнал ———

/** Пометки журнала словами (механика 2.0, раздел 7). */
function marksOf(x: JournalItem): HTMLElement[] {
  return x.marks.map((m) => h('span', { class: 'mark' }, journalMark(m, x)))
}

/** Журнал: всё, что пришло с прошлой остановки. Раздел «По курсу» выше, «Остальные» ниже. */
export function journal(app: App, auto: boolean): void {
  const s = app.s
  if (!s) return
  const v = journalView(s)
  const { body, foot } = shell(app, 'journal', JOURNAL.title.toUpperCase(), { cls: 'wide scroll' })
  const row = (x: JournalItem) => {
    const text = x.id === null ? '' : (receivedSessions(s, x.st).find((q) => q.id === x.id)?.text ?? '')
    return h(
      'button',
      { class: 'jrow', onclick: () => card(app, x.st), title: 'Открыть карточку станции' },
      h('span', { class: 'j-t data' }, short(x.t)),
      h('span', { class: 'j-st data' }, `«${placeName(x.st)}»`),
      h('span', { class: 'j-tx data' }, x.id === null ? 'до буксира дошла тишина' : clip(text.replace(/\s+/g, ' '), 150)),
      h('span', { class: 'j-mk data' }, ...marksOf(x)),
    )
  }
  const section = (name: string, items: JournalItem[]) => {
    if (!items.length) return
    body.append(h('div', { class: 'px sub' }, name), h('div', { class: 'jlist' }, ...items.map(row)))
  }
  section(JOURNAL.onCourse, v.course)
  section(JOURNAL.others, v.others)
  if (!v.course.length && !v.others.length) body.append(h('div', { class: 'data dimtxt' }, JOURNAL.empty))
  if (auto) foot.append(mainNext('ДАЛЬШЕ', () => app.closePanel()))
}

// ——— канал «Порог» ———

function playTitle(s: GameState, p: VeraPlay): string {
  const f = VERA[p.id]
  const day = Math.floor((p.t + 8) / 24) + 1
  if (!s.vera.revealed) return day === 21 ? 'Сводка · день 21' : `Сводка · день ${day}`
  return `${f?.title ?? p.id} · день ${day}`
}

function headers(s: GameState, p: VeraPlay, f: VeraFile): HTMLElement {
  const day = Math.floor((p.t + 8) / 24) + 1
  const box = h('div', { class: 'data file-head' }, `«Порог» → «Тихоход» · сводка, день ${day} · задержка ${dur(p.delay)}`)
  if (s.vera.revealed) {
    box.append(
      h('div', { class: 'svc' }, `записано: ${recLabel(f)} от удара · выдано: ${stamp(p.t)}`),
      h('div', { class: 'svc' }, 'источник: ретранслятор РТ-7, буфер 31 файл · задержка в заголовке подставлена по расстоянию до «Порога»'),
      h('div', { class: 'svc' }, `выбор файла: ${p.why}`),
    )
  }
  return box
}

export function channel(app: App, fileId: string | null, auto: boolean): void {
  const s = app.s
  if (!s) return
  const plays = s.vera.plays.filter((p) => p.id !== s.vera.farewell || s.final.stage !== 'none')
  const { body, foot } = shell(app, 'channel', 'КАНАЛ «ПОРОГ»', { cls: 'wide' })
  const list = h('div', { class: 'col-l files' })
  const view = h('div', { class: 'col-r transcript' })
  body.append(h('div', { class: 'cols' }, list, view))

  const show = (p: VeraPlay) => {
    const f = VERA[p.id]
    if (!f) return
    clear(view)
    p.heard = true
    view.append(headers(s, p, f), veraBlock(f.text))
    for (const b of list.querySelectorAll('.file')) b.classList.toggle('on', (b as HTMLElement).dataset.id === p.id)
    audio.toneOn()
    view.scrollTop = 0
    app.save()
  }

  for (const p of [...plays].reverse()) {
    list.append(
      h(
        'button',
        { class: `file data${p.heard ? '' : ' unheard'}`, 'data-id': p.id, onclick: () => show(p) },
        h('span', { class: 'vera-dot' }),
        playTitle(s, p),
      ),
    )
  }
  // Квитанции вечерних сообщений.
  if (s.evenings.length) {
    list.append(h('div', { class: 'px sub' }, 'ОТВЕТЫ'))
    for (const e of [...s.evenings].reverse()) {
      list.append(
        h(
          'div',
          { class: 'data receipt' },
          h('div', null, `день ${e.day}, 20:00 · ${e.choice ? `«${clip(eveningText(e.choice) ?? '', 46)}»` : 'молчание'}`),
          h('div', { class: 'dimtxt' }, e.delivered ? `квитанция ${short(e.receipt)}: ${s.vera.revealed ? RECEIPT_AFTER : RECEIPT_BEFORE}` : `квитанция ожидается к ${short(e.receipt)}`),
        ),
      )
    }
  }

  const target = fileId ? plays.find((p) => p.id === fileId) : plays.at(-1)
  if (target) show(target)
  else view.append(h('div', { class: 'data dimtxt' }, 'На канале несущая. Новых файлов нет.'))

  if (s.vera.revealed && s.final.stage === 'none') {
    foot.append(
      btn(s.vera.channelOn ? 'ВЫКЛЮЧИТЬ КАНАЛ' : 'ВКЛЮЧИТЬ КАНАЛ', () => {
        s.vera.channelOn = !s.vera.channelOn
        app.save()
        app.refresh()
        channel(app, null, false)
      }),
      btn('АРХИВ', () => archive(app)),
    )
  }
  if (auto) foot.append(mainNext('ДАЛЬШЕ', () => app.closePanel()))
}

function clip(t: string, n: number): string {
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// ——— архив ———

export function archive(app: App, sortBy: 'got' | 'rec' = 'got'): void {
  const s = app.s
  if (!s) return
  const done = s.final.stage === 'after' || s.final.stage === 'screen'
  const revealed = s.vera.revealed || done
  const { body, foot } = shell(app, 'archive', 'АРХИВ ФАЙЛОВ «ПОРОГА»', { cls: 'wide' })
  const list = h('div', { class: 'col-l files' })
  const view = h('div', { class: 'col-r transcript' })
  body.append(h('div', { class: 'cols' }, list, view))

  const played = new Map(s.vera.plays.map((p) => [p.id, p]))
  let files: VeraFile[]
  if (!revealed) files = s.vera.plays.map((p) => VERA[p.id]!).filter(Boolean)
  else if (sortBy === 'got') {
    const got = s.vera.plays.map((p) => VERA[p.id]!).filter(Boolean)
    const rest = VERA_MAIN.filter((f) => !played.has(f.id))
    files = [...got, ...rest]
  } else {
    files = [...VERA_MAIN, ...VERA_TAKES].sort((a, b) => a.rec[0] * 60 + a.rec[1] - (b.rec[0] * 60 + b.rec[1]))
  }

  const open = (f: VeraFile) => {
    clear(view)
    const p = played.get(f.id)
    const unlocked = done || !!p || (f.kind === 'take' && (done || played.has(f.takeOf ?? '')))
    view.append(
      h(
        'div',
        { class: 'data file-head' },
        `${f.title}`,
        revealed ? h('div', { class: 'svc' }, `записано: ${recLabel(f)} от удара${p ? ` · выдано: ${stamp(p.t)}` : f.kind === 'take' ? ' · дубль, в эфир не выдавался' : ' · не выдан'}`) : null,
      ),
    )
    audio.toneOff()
    audio.musicDuck(sortBy === 'rec')
    if (unlocked) {
      view.append(veraBlock(f.text))
      if (p) p.heard = true
      audio.toneOn()
    } else view.append(h('div', { class: 'data dimtxt' }, 'Файл лежит в буфере ретранслятора. Выдача — по расписанию.'))
    for (const b of list.querySelectorAll('.file')) b.classList.toggle('on', (b as HTMLElement).dataset.id === f.id)
    app.save()
  }

  for (const f of files) {
    const p = played.get(f.id)
    const label = !revealed ? playTitle(s, p!) : sortBy === 'rec' ? `${recLabel(f)} · ${f.title}` : `${f.title}${p ? ` · д${Math.floor((p.t + 8) / 24) + 1}` : ''}`
    const locked = revealed && !done && !p && !(f.kind === 'take' && played.has(f.takeOf ?? ''))
    list.append(
      h(
        'button',
        { class: `file data${locked ? ' locked' : ''}${f.kind === 'take' ? ' take' : ''}${p && !p.heard ? ' unheard' : ''}`, 'data-id': f.id, onclick: () => open(f) },
        h('span', { class: 'vera-dot' }),
        label,
      ),
    )
  }
  if (!files.length) view.append(h('div', { class: 'data dimtxt' }, 'Архив пуст.'))
  else view.append(h('div', { class: 'data dimtxt' }, revealed ? 'Выбери файл слева.' : 'Файлы канала в порядке получения. Выбери файл слева.'))

  if (revealed) {
    foot.append(
      btn('ПО ПОЛУЧЕНИЮ', () => archive(app, 'got'), sortBy === 'got' ? 'on' : ''),
      btn('ПО ЗАПИСИ', () => archive(app, 'rec'), sortBy === 'rec' ? 'on' : ''),
    )
    if (sortBy === 'rec') audio.breathOn()
  }
  if (done) foot.append(btn('ИМЕНА', () => names(app)), btn('ГЛАВНОЕ МЕНЮ', () => app.showTitle(), 'primary'))
}

// ——— борт ———

export function board(app: App): void {
  const s = app.s
  if (!s) return
  const { body } = shell(app, 'board', 'БОРТ', { cls: 'wide' })
  const left = h('div', { class: 'col-l' })
  const right = h('div', { class: 'col-r transcript' })
  body.append(h('div', { class: 'cols' }, left, right))
  const people = aboardPeople(s)
  left.append(h('div', { class: 'px sub' }, `ПАССАЖИРЫ · ${people.length} ИЗ 12`))
  if (!people.length) left.append(h('div', { class: 'data dimtxt' }, 'На борту никого.'))
  for (const p of people) {
    const st = personStatus(s, p.id)
    left.append(
      h(
        'div',
        { class: 'person data' },
        h('div', null, p.name),
        h('div', { class: 'dimtxt' }, `«${STATION[p.station].name}» · ${p.note}${st ? ` · ${st}` : ''}`),
      ),
    )
  }
  if (s.board.length) {
    left.append(h('div', { class: 'px sub' }, 'БОРТОВОЙ ЖУРНАЛ'))
    for (const b of [...s.board].reverse()) left.append(h('div', { class: 'data journal' }, b))
  }
  right.append(h('div', { class: 'px sub' }, `ПОЧТА · ${s.letters.length} ${plural(s.letters.length, 'ПИСЬМО', 'ПИСЬМА', 'ПИСЕМ')}`))
  if (!s.letters.length)
    right.append(h('div', { class: 'data dimtxt' }, 'Писем нет. Письма диктуют те, кому сказали правду.'))
  for (const l of s.letters) {
    right.append(h('div', { class: 'sess' }, h('div', { class: 'data sess-head' }, `«${STATION[l.station].name}» · ${stamp(l.t)}`), speech(l.text)))
  }
}

// ——— вечер ———

export function evening(app: App): void {
  const s = app.s
  if (!s || s.eveningDue === null) return
  const day = s.eveningDue
  const { body, foot } = shell(app, 'evening', `20:00 · СООБЩЕНИЕ НА «ПОРОГ»`, { modal: true, cls: 'narrow' })
  const delay = porogDelay(s)
  body.append(h('div', { class: 'data dimtxt' }, `День ${day}. Задержка ${dur(delay)}. Квитанция — через ${dur(delay * 2)}.`))
  const opts = eveningOptions(s, day)
  const list = h('div', { class: 'choices' })
  for (const o of opts) {
    list.append(
      h(
        'button',
        {
          class: 'choice',
          onclick: () => {
            chooseEvening(s, o.id)
            app.closePanel(false)
            app.afterChange([])
          },
        },
        speech(o.text),
      ),
    )
  }
  body.append(list)
  foot.append(
    btn('ПРОМОЛЧАТЬ', () => {
      chooseEvening(s, null)
      app.closePanel(false)
      app.afterChange([])
    }),
  )
}

// ——— сцены ———

function scene(app: App, id: string, ttl: string, text: string, extra?: (foot: HTMLElement) => void): void {
  const { body, foot } = shell(app, id, ttl, { modal: true, cls: 'narrow' })
  body.append(speech(text, 'speech scene'))
  extra?.(foot)
  foot.append(mainNext('ДАЛЬШЕ', () => app.closePanel()))
}

export function arrival(app: App, n: Extract<Notice, { k: 'arrive' }>): void {
  const s = app.s!
  if (n.to === 'pereval') return scene(app, 'arrive', '«ПЕРЕВАЛ»', PEREVAL_EARLY)
  if (n.to === 'porog') return scene(app, 'arrive', '«ПОРОГ»', epilogueArrival('razvorot', 0))
  const sc = SCRIPTS[n.to as StationId]
  const name = STATION[n.to as StationId].name.toUpperCase()
  let text = n.alive ? sc.rescue : sc.dead
  if (n.alive && n.boarded < STATION[n.to as StationId].saved) text += `\nМест не хватает. Поднимается ${n.boarded}.`
  scene(app, 'arrive', `СТЫКОВКА · «${name}»`, text)
  void s
}

export function zoya(app: App): void {
  scene(app, 'zoya', 'РУБКА · ДЕНЬ 16', ZOYA_SCENE, (foot) =>
    foot.append(
      btn('СЛУЖЕБНЫЕ ЗАГОЛОВКИ', () => {
        app.closePanel(false)
        channel(app, null, false)
      }),
    ),
  )
}

export function porogTurn(app: App): void {
  scene(app, 'porog-turn', 'КУРС: «ПОРОГ»', porogTurnScene(app.s!))
}

export function drift(app: App): void {
  scene(app, 'drift', 'ДРЕЙФ', DRIFT_SCENE)
}

// ——— финал ———

let epilogueItems: EpilogueItem[] | null = null

export function finalStage(app: App): void {
  const s = app.s
  if (!s) return
  switch (s.final.stage) {
    case 'farewell':
      return farewell(app)
    case 'efir':
      return efir(app)
    case 'porog':
      return lastWords(app)
    case 'flight':
      return lastFlight(app)
    case 'epilogue':
      return epilogue(app)
    case 'screen':
      return finalScreen(app)
    case 'after':
      app.mode = 'play'
      app.hudEl.classList.add('hidden')
      return archive(app, 'rec')
    default:
      return
  }
}

function go(app: App, stage: GameState['final']['stage']): void {
  app.s!.final.stage = stage
  app.save()
  app.closePanel(false)
  finalStage(app)
}

function farewell(app: App): void {
  const s = app.s!
  const id = s.vera.farewell ?? 'farewellB'
  const play = s.vera.plays.find((p) => p.id === id)
  if (!s.vera.channelOn && !play?.heard) {
    const { body, foot } = shell(app, 'farewell-ask', 'КАНАЛ «ПОРОГ» · ДЕНЬ 21', { modal: true, cls: 'narrow' })
    body.append(h('div', { class: 'data' }, 'Канал выключен. В буфере новый файл: утро двадцать первого дня.'))
    foot.append(
      btn('НЕ ОТКРЫВАТЬ', () => go(app, 'efir')),
      btn('ОТКРЫТЬ', () => {
        s.vera.channelOn = true
        app.refresh()
        farewellShow(app)
      }, 'primary'),
    )
    return
  }
  farewellShow(app)
}

function farewellShow(app: App): void {
  const s = app.s!
  const id = s.vera.farewell ?? 'farewellB'
  const play = s.vera.plays.find((p) => p.id === id)!
  const f = VERA[id]!
  const { body, foot } = shell(app, 'farewell', 'КАНАЛ «ПОРОГ» · ДЕНЬ 21', { modal: true, cls: 'wide' })
  play.heard = true
  body.append(h('div', { class: 'transcript solo' }, headers(s, play, f), veraBlock(f.text)))
  audio.toneOn()
  foot.append(btn('ДАЛЬШЕ', () => go(app, 'efir'), 'primary'))
  app.save()
}

function efir(app: App): void {
  const s = app.s!
  const ids = efirStations(s)
  const { body, foot } = shell(app, 'efir', 'ЭФИР', { modal: true, cls: 'wide' })
  body.append(
    h(
      'div',
      { class: 'data dimtxt' },
      ids.length ? 'Станции, у которых ещё есть воздух. Можно ответить.' : 'В эфире больше никого. Только несущая «Порога».',
    ),
  )
  const labels: Record<ReplyKind, string> = { truth: 'ПРАВДА', hold: 'ДЕРЖИСЬ, Я ИДУ', eta: 'ТОЧНОЕ ВРЕМЯ', papa: 'ПОЗОВИ ПАПУ' }
  for (const id of ids) {
    const def = STATION[id]
    const rt = s.st[id]
    const last = receivedSessions(s, id).at(-1)
    const box = h('div', { class: 'efir-st' })
    add(
      box,
      h('div', { class: 'data efir-head' }, `«${def.name}» · ${def.people} чел. · задержка ${dur(dist(tugPos(s), def))} · воздух до ${dayTime(signalEnd(s, id))}`),
      last ? speech(last.text) : null,
    )
    if (rt.reply) {
      box.append(h('div', { class: 'data dimtxt' }, `Ты уже ответил: «${clip(rt.reply.text, 80)}»`))
    } else {
      const burn = directCalc(s, id).find((c) => c.mode === 'burn')!
      const row = h('div', { class: 'row-btns' })
      for (const k of replyOptions(s, id).filter((k) => k !== 'eta')) {
        row.append(
          btn(labels[k], () => {
            sendReply(s, id, k, replyText(k, def.name, { late: `опоздание ${hours(burn.margin)}` }))
            app.save()
            efir(app)
          }),
        )
      }
      box.append(row)
    }
    body.append(box)
  }
  foot.append(btn('ДАЛЬШЕ', () => go(app, 'porog'), 'primary'))
}

function lastWords(app: App): void {
  const s = app.s!
  const { body, foot } = shell(app, 'porog-last', 'КАНАЛ «ПОРОГ» · ПОСЛЕДНЕЕ СООБЩЕНИЕ', { modal: true, cls: 'narrow' })
  const delay = porogDelay(s)
  body.append(h('div', { class: 'data dimtxt' }, `Оно уйдёт к «Порогу» и через ${dur(delay)} прозвучит в комнате, где на пульте иней.`))
  const send = (text: string | null) => {
    sendLastWords(s, text)
    if (continueAfterFinal(s)) {
      app.save()
      app.closePanel(false)
      app.refresh()
    } else go(app, 'flight')
  }
  const list = h('div', { class: 'choices' })
  for (const o of LAST_WORDS) list.append(h('button', { class: 'choice', onclick: () => send(o.text) }, speech(o.text)))
  const ta = h('textarea', { class: 'free', maxlength: '400', rows: '3', placeholder: 'Своими словами…' }) as HTMLTextAreaElement
  body.append(list, ta)
  foot.append(
    btn('ПРОМОЛЧАТЬ', () => send(null)),
    btn('ОТПРАВИТЬ СВОЁ', () => {
      const t = ta.value.trim()
      if (t) send(t)
      else ta.focus()
    }, 'primary'),
  )
}

function lastFlight(app: App): void {
  const s = app.s!
  if (s.ending) {
    epilogueItems = runEpilogue(s)
    return go(app, 'epilogue')
  }
  const { body, foot } = shell(app, 'last-flight', 'ПОСЛЕДНИЙ ПЕРЕЛЁТ', { modal: true, cls: 'narrow' })
  const f = s.tug.flight
  const opts = finalFlights(s)
  body.append(h('div', { class: 'data' }, LAST_FLIGHT_HINT))
  body.append(h('div', { class: 'data dimtxt' }, `Топливо: ${Math.round(s.tug.fuel)}. На борту: ${s.tug.aboard.length}.`))
  const list = h('div', { class: 'choices' })
  const choose = (to: 'pereval' | 'porog' | null, mode: (typeof MODE_IDS)[number] = 'eco', keep = false) => {
    if (!keep) finalFlight(s, to, mode)
    epilogueItems = runEpilogue(s)
    go(app, 'epilogue')
  }
  if (f && isFinal(f.to)) {
    list.append(
      h('button', { class: 'choice data', onclick: () => choose(null, 'eco', true) }, `Продолжить к «${placeName(f.to)}» · прибытие ${stamp(f.arrive)}`),
    )
  }
  for (const o of opts) {
    if (f && f.to === o.to && f.mode === o.mode) continue
    list.append(
      h(
        'button',
        { class: 'choice data', onclick: () => choose(o.to, o.mode) },
        `«${placeName(o.to)}» · ${MODES[o.mode].name} · прибытие ${stamp(o.arrive)} · топливо после: ${Math.round(o.fuelAfter)}`,
      ),
    )
  }
  if (!list.children.length) {
    list.append(h('div', { class: 'data' }, 'Лететь некуда: топлива меньше, чем на любой перелёт.'))
    foot.append(btn('ДАЛЬШЕ', () => choose(null), 'primary'))
  }
  body.append(list)
}

interface FeedLine {
  t: number
  head?: string
  text?: string
  cls?: string
  vera?: boolean
}

function buildFeed(s: GameState, items: EpilogueItem[]): FeedLine[] {
  const lines: FeedLine[] = []
  const kind = s.ending?.kind ?? 'drift'
  const sent = s.final.lastSent ?? 480
  const delay = s.final.lastDelay ?? 5
  lines.push({ t: sent - 0.01, text: epilogueOpening(kind), cls: 'quiet' })
  lines.push({ t: sent, head: `${short(sent)} · «Тихоход» → «Порог»`, text: s.final.lastWords ?? '[молчание]', cls: 'mine' })
  lines.push({ t: sent + 0.001, head: `доставка через ${dur(delay)}`, cls: 'sys' })
  const at = sent + delay
  lines.push({ t: at, head: `${short(at)} · доставлено · воспроизведено: громкая связь, отсек Д-1`, cls: 'sys amber' })
  for (const e of s.evenings) {
    lines.push({ t: at + 0.001 * e.day, head: `день ${e.day}, 20:00`, text: eveningText(e.choice) ?? '[молчание]', cls: 'mine replay' })
  }
  lines.push({ t: at + 0.05, head: 'день 21', text: s.final.lastWords ?? '[молчание]', cls: 'mine replay' })
  for (const it of items) {
    if (!it.st) continue
    const name = STATION[it.st].name
    if (it.kind === 'session') {
      const ss = receivedSessions(s, it.st).find((x) => x.id === it.id)
      if (ss) lines.push({ t: it.t, head: `${short(it.t)} · «${name}»${ss.letter ? ' · письмо, в «Почту»' : ''}`, text: ss.text })
    } else if (it.kind === 'silence') {
      lines.push({ t: it.t, head: `${short(it.t)} · «${name}» · молчит`, cls: 'sys' })
    }
  }
  lines.sort((a, b) => a.t - b.t)
  lines.push({ t: Infinity, text: epilogueArrival(kind, endingLines(s).saved), cls: 'quiet' })
  return lines
}

function epilogue(app: App): void {
  const s = app.s!
  if (!epilogueItems) {
    // Перезапуск посреди эпилога: состояние уже досчитано, показываем финал.
    return go(app, 'screen')
  }
  const lines = buildFeed(s, epilogueItems)
  const { body, foot } = shell(app, 'epilogue', 'ЭПИЛОГ', { modal: true, cls: 'wide' })
  const feed = h('div', { class: 'transcript solo feed' })
  body.append(feed)
  let i = 0
  let timer = 0
  const skip = btn('ПОКАЗАТЬ ВСЁ', () => {
    clearTimeout(timer)
    while (i < lines.length) add()
    done()
  })
  const add = () => {
    const l = lines[i++]!
    const el = h('div', { class: `sess feed-line ${l.cls ?? ''}` })
    if (l.head) el.append(h('div', { class: 'data sess-head' }, l.head))
    if (l.text) el.append(l.cls?.includes('mine') ? speech(l.text) : speech(l.text))
    feed.append(el)
    requestAnimationFrame(() => el.classList.add('in'))
    scrollEnd(feed)
  }
  const done = () => {
    skip.remove()
    foot.append(btn('ДАЛЬШЕ', () => go(app, 'screen'), 'primary'))
  }
  const tickFeed = () => {
    if (i >= lines.length) return done()
    add()
    const l = lines[i - 1]!
    const wait = Math.min(5200, 1100 + (l.text?.length ?? 20) * 22)
    timer = window.setTimeout(tickFeed, wait)
  }
  foot.append(skip)
  tickFeed()
}

function finalScreen(app: App): void {
  const s = app.s!
  app.closePanel(false)
  app.mode = 'black'
  app.toastEl.classList.remove('visible')
  app.hudEl.classList.add('hidden')
  audio.humOff()
  audio.musicContext(false)
  const e = endingLines(s)
  const kind = s.ending?.kind ?? 'drift'
  const l1 = kind === 'kurs' || kind === 'svoy' ? `Спасено: ${e.saved} из 61. Писем: ${e.letters}.` : 'Спасено: 0 из 61.'
  const l2 = e.delayZero ? 'Канал «Порог». Задержка: 0' : 'Канал «Порог». Задержка: растёт.'
  const box = h('div', { class: 'final' }, h('div', { class: 'data f1' }, l1), h('div', { class: 'data f2' }, l2))
  const more = h(
    'button',
    {
      class: 'data final-more',
      onclick: () => {
        app.mode = 'play'
        go(app, 'after')
      },
    },
    'дальше',
  )
  box.append(more)
  app.layer.append(box)
  app.panelOpen = 'final'
  setTimeout(() => more.classList.add('in'), 6000)
}

export function names(app: App): void {
  const s = app.s!
  const { body, foot } = shell(app, 'names', 'ИМЕНА', { cls: 'wide' })
  const saved = aboardPeople(s)
  const savedIds = new Set(saved.map((p) => p.id))
  const kind = s.ending?.kind
  const reached = kind === 'kurs' || kind === 'svoy'
  const left = h('div', { class: 'col-l' })
  const right = h('div', { class: 'col-r transcript' })
  body.append(h('div', { class: 'cols' }, left, right))
  left.append(h('div', { class: 'px sub' }, reached ? `СПАСЁННЫЕ · ${saved.length}` : 'БЫЛИ НА БОРТУ'))
  for (const p of saved) left.append(h('div', { class: 'person data' }, h('div', null, p.name), h('div', { class: 'dimtxt' }, `«${STATION[p.station].name}» · ${p.note}`)))
  if (!saved.length) left.append(h('div', { class: 'data dimtxt' }, 'Никого.'))
  right.append(h('div', { class: 'px sub' }, 'ТЕ, КОГО ТЫ СЛЫШАЛ'))
  for (const d of STATIONS) {
    if (!s.heard.includes(d.id)) continue
    const ppl = PEOPLE.filter((p) => p.station === d.id && !savedIds.has(p.id))
    if (!ppl.length) continue
    right.append(
      h(
        'div',
        { class: 'sess' },
        h('div', { class: 'data sess-head' }, `«${d.name}»`),
        h('div', { class: 'data names' }, ppl.map((p) => p.name).join(', ')),
      ),
    )
  }
  right.append(
    h('div', { class: 'sess' }, h('div', { class: 'data sess-head' }, '«Порог»'), h('div', { class: 'data names amber-name' }, 'Вера, диспетчер. Сигнал не был отправлен.')),
  )
  foot.append(btn('АРХИВ', () => archive(app, 'rec')), btn('ГЛАВНОЕ МЕНЮ', () => app.showTitle(), 'primary'))
}

export { newGame }
