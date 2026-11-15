import { describe, expect, it } from 'vitest'
import { hours } from '../ui/format'
import { eveningOptions } from '../content/evenings'
import { VERA } from '../content/vera'
import { HINTS, NEXT, confirmCourse, journalMark, statusLine } from '../content/ui-text'
import { SCRIPTS } from '../content/stations'
import {
  advance,
  airEnd,
  applyPlan,
  canContinueAfterFinal,
  canDrain,
  chooseEvening,
  continueAfterFinal,
  courseState,
  deserialize,
  depart,
  directCalc,
  drain,
  finalFlight,
  type GameState,
  journalView,
  newGame,
  nextLabel,
  receivedSessions,
  orderEco,
  runEpilogue,
  SAVE_VERSION,
  savedCount,
  sendReply,
  serialize,
  sessionsOf,
  signalEnd,
  simulatePlan,
  stationView,
  step,
} from './engine'
import { at, clockOf, DEVIATIONS, type Leg, type Mode, STATION, STATIONS, type StationId, VERA_COURSE } from './world'

const pad = (n: number) => String(n).padStart(2, '0')
/** «д9 15:44» — как в tools/balance-v2.mjs. */
function fmt(t: number): string {
  const c = clockOf(t)
  return `д${c.day} ${pad(c.h)}:${pad(c.m)}`
}

function runUntil(s: GameState, stop: (s: GameState) => boolean, max = 5000): void {
  for (let i = 0; i < max; i++) {
    if (stop(s)) return
    if (s.eveningDue !== null) {
      chooseEvening(s, null)
      continue
    }
    if (s.final.stage !== 'none') return
    const n = advance(s, 'event')
    if (!n.length && s.eveningDue === null && s.final.stage === 'none') advance(s, '1h')
  }
}

/** Ровно до момента t: шагами не дальше t. */
function runTo(s: GameState, t: number): void {
  for (let i = 0; i < 5000 && s.t < t - 1e-9; i++) {
    if (s.eveningDue !== null) {
      chooseEvening(s, null)
      continue
    }
    step(s, t)
  }
}

/** «Дальше», пока не выполнится условие. Вечером — молчать. */
function runNext(s: GameState, stop: (s: GameState) => boolean, max = 500): void {
  for (let i = 0; i < max; i++) {
    if (stop(s)) return
    if (s.eveningDue !== null) {
      chooseEvening(s, null)
      continue
    }
    if (s.final.stage !== 'none' && s.final.stage !== 'cont') return
    advance(s, 'next')
  }
}

/** Курс от утра дня 7: форсаж к «Ключу» с этой минуты, дальше — как сказано. */
function fromDay7(s: GameState, rest: Leg[], klyuch: Partial<Leg> = {}): void {
  runUntil(s, (x) => x.t >= at(7, '08:00'))
  expect(s.t).toBeCloseTo(at(7, '08:00'), 6)
  const r = applyPlan(s, [{ to: 'klyuch', mode: 'burn', ...klyuch }, ...rest])
  expect(r.ok, r.err).toBe(true)
}

const leg = (to: Leg['to'], mode: Mode, drain = false): Leg => (drain ? { to, mode, drain } : { to, mode })

/** Линия Б механики: форсаж к «Ключу» с утра дня 7 и слив на «Ключе», дальше крейсером. */
function lineB(): GameState {
  const s = newGame()
  applyPlan(s, VERA_COURSE)
  fromDay7(s, [leg('smena', 'cruise'), leg('okolica', 'cruise'), leg('pereval', 'eco')], { drain: true })
  return s
}

function finish(s: GameState): void {
  runUntil(s, (x) => x.final.stage === 'farewell')
  const f = s.tug.flight
  if (!s.ending && !(f && (f.to === 'porog' || f.to === 'pereval'))) {
    const to = s.tug.fuel >= 12 ? 'pereval' : null
    finalFlight(s, to, 'eco')
  }
  runEpilogue(s)
}

describe('числа мира', () => {
  it('запас на форсаже со старта совпадает с таблицей', () => {
    const s = newGame()
    const expected: Partial<Record<StationId, number>> = {
      sinica: 34,
      klyuch: 91,
      smena: 141,
      okolica: 210,
      kolybel: 151,
      zarya: 9,
      mayak: 208,
      polynya: -12,
      vetra: -51,
      kovsh: -27,
      artel: -7,
      matryoshka: -46,
      yar: -97,
      kordon: -7,
    }
    for (const [id, m] of Object.entries(expected)) {
      const burn = directCalc(s, id as StationId).find((c) => c.mode === 'burn')!
      expect(Math.round(burn.margin), id).toBe(m)
    }
  })

  it('на старте 4 на курсе, 3 вне курса, 7 вне досягаемости', () => {
    const s = newGame()
    const count = { course: 0, off: 0, out: 0 } as Record<string, number>
    for (const d of STATIONS) count[stationView(s, d.id).status] = (count[stationView(s, d.id).status] ?? 0) + 1
    expect(count.course).toBe(4)
    expect(count.off).toBe(3)
    expect(count.out).toBe(7)
  })

  it('у «Полыньи» сигналу час с небольшим, и у каждой станции есть сигнал до первой сводки', () => {
    const s = newGame()
    expect(stationView(s, 'polynya').age).toBeCloseTo(1.083, 2)
    for (const d of STATIONS) expect(s.st[d.id].got.length, d.id).toBeGreaterThan(0)
  })

  it('все сеансы по сценарию отправлены до конца воздуха станции — по правде, с отклонениями', () => {
    const s = newGame()
    for (const d of STATIONS) {
      for (const b of SCRIPTS[d.id].base) expect(b.at, `${d.id} ${b.text.slice(0, 20)}`).toBeLessThan(airEnd(s, d.id))
      expect(sessionsOf(s, d.id).every((x) => x.at < airEnd(s, d.id)), d.id).toBe(true)
    }
  })

  it('топливо станций — таблица раздела 5 второй механики', () => {
    const want: Record<StationId, number> = {
      sinica: 4, klyuch: 10, smena: 12, okolica: 10, kolybel: 0, zarya: 6, mayak: 6,
      polynya: 14, vetra: 4, kovsh: 24, artel: 12, matryoshka: 6, yar: 16, kordon: 8,
    }
    for (const d of STATIONS) expect(d.stock, d.id).toBe(want[d.id])
  })

  it('правда: «Тёплый Ключ» до д9 22:00, «Околица» до д19 20:00, остальные — как у Веры', () => {
    const s = newGame()
    expect(fmt(airEnd(s, 'klyuch'))).toBe('д9 22:00')
    expect(fmt(airEnd(s, 'okolica'))).toBe('д19 20:00')
    expect(airEnd(s, 'klyuch', at(6, '20:59'))).toBe(STATION.klyuch.T)
    for (const d of STATIONS) if (d.id !== 'klyuch' && d.id !== 'okolica') expect(airEnd(s, d.id), d.id).toBe(d.T)
  })

  it('курс диспетчера по сигналу первого утра: 11, топливо 12 после «Околицы», запасы меньше полусуток', () => {
    const s = newGame()
    const r = simulatePlan(s, VERA_COURSE)
    expect(r.ok).toBe(true)
    expect(r.saved).toBe(11)
    expect(Math.round(r.legs[3]!.fuelAfter)).toBe(12)
    expect(Math.round(r.legs[4]!.fuelAfter)).toBe(0)
    const margins = r.legs.slice(0, 4).map((l) => l.margin!)
    expect(margins.every((m) => m > 0 && m < 12)).toBe(true)
    expect(courseState(s, VERA_COURSE)).toEqual({ k: 'ok', saved: 11 })
  })
})

describe('рейсы', () => {
  it('курс Веры без правок: 7; «Ключ» опоздание 12 ч, «Околица» 21,5 ч; все маршрутные утра, прощание А', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    runUntil(s, (x) => x.final.stage === 'farewell')
    expect(s.kt).toEqual({ kt1: true, kt2: true, ktk: false, kt3: true, kt4: true })
    expect(s.vera.plays.slice(0, 20).map((p) => p.id)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i + 1}`))
    expect(s.vera.farewell).toBe('farewellA')
    expect(s.st.klyuch.rescued).toBe(false)
    expect(s.st.okolica.rescued).toBe(false)
    expect(s.st.klyuch.arrived! - airEnd(s, 'klyuch')).toBeCloseTo(12, 0)
    expect(Math.round((s.st.okolica.arrived! - airEnd(s, 'okolica')) * 2) / 2).toBe(21.5)
    expect(savedCount(s)).toBe(7)
    expect(s.vera.revealed).toBe(true)
    finalFlight(s, 'pereval', 'eco')
    runEpilogue(s)
    expect(s.ending?.kind).toBe('svoy')
    expect(Math.round(s.tug.fuel)).toBe(0)
  })

  it('тот же курс в мире Веры — 11: числа сходятся с её расчётом, пока не пришли новости', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    runUntil(s, (x) => x.t >= at(6, '20:00'))
    expect(courseState(s)).toEqual({ k: 'ok', saved: 11 })
  })

  it('окно «Колыбели» без экономии закрывается в 11:30 одиннадцатого дня', () => {
    const s = lineB()
    // Скрипт: поворот в 11:30 — запас 0,2 ч. Буксир идёт отчасти навстречу «Колыбели»,
    // запас тает медленнее часа в час: окно закрывается около 11:57.
    runTo(s, at(11, '11:30'))
    expect(stationView(s, 'kolybel').status).toBe('off')
    expect(stationView(s, 'kolybel').margin!).toBeCloseTo(0.2, 1)
    runTo(s, at(11, '12:00'))
    expect(stationView(s, 'kolybel').status).toBe('out')
  })

  it('«Колыбель», пока окно открыто: 8 спасённых и ветка «Колыбель»', () => {
    const s = lineB()
    runTo(s, at(10, '20:00'))
    const legs: Leg[] = [
      { to: 'kolybel', mode: 'burn' },
      { to: 'pereval', mode: 'eco' },
    ]
    const r = applyPlan(s, legs)
    expect(r.ok).toBe(true)
    finish(s)
    expect(s.st.kolybel.rescued).toBe(true)
    expect(savedCount(s)).toBe(8)
    const ids = s.vera.plays.map((p) => p.id)
    expect(ids.slice(11, 14)).toEqual(['k1', 'k2', 'k3'])
    expect(s.vera.farewell).toBe('farewellB')
  })

  it('«Колыбель» с экономией: окно до пяти утра двенадцатого дня, 8 спасённых', () => {
    const s = lineB()
    runTo(s, at(11, '20:00'))
    // Без экономии уже не успеть.
    expect(stationView(s, 'kolybel').status).toBe('out')
    runTo(s, at(12, '05:00'))
    expect(orderEco(s, 'kolybel')).toBe(true)
    expect(stationView(s, 'kolybel').status).toBe('off')
    const r = applyPlan(s, [leg('kolybel', 'burn'), leg('pereval', 'eco')])
    expect(r.ok).toBe(true)
    finish(s)
    expect(s.st.kolybel.rescued).toBe(true)
    expect(savedCount(s)).toBe(8)
  })

  it('«Колыбель» после слов Веры: не успеть и с экономией, 5 спасённых', () => {
    const s = lineB()
    runTo(s, at(12, '08:00'))
    orderEco(s, 'kolybel')
    expect(stationView(s, 'kolybel').status).toBe('out')
    applyPlan(s, [
      { to: 'kolybel', mode: 'burn' },
      { to: 'pereval', mode: 'eco' },
    ])
    runUntil(s, (x) => x.st.kolybel.arrived !== null)
    expect(s.st.kolybel.rescued).toBe(false)
    finish(s)
    expect(savedCount(s)).toBe(5)
    // Вера «угадывает», что пилот дослушал: утро 13 всё ещё маршрутное.
    expect(s.vera.plays.find((p) => p.id === 'm13')).toBeTruthy()
  })

  it('«Заря» в первый день: семеро, и больше никуда', () => {
    const s = newGame()
    applyPlan(s, [
      { to: 'zarya', mode: 'burn' },
      { to: 'pereval', mode: 'eco' },
    ])
    finish(s)
    expect(s.st.zarya.rescued).toBe(true)
    expect(savedCount(s)).toBe(7)
    // Четыре утра Вера говорит о курсе, которым буксир не летит.
    expect(s.vera.plays.slice(0, 5).map((p) => p.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
    expect(s.vera.plays[5]!.id).toBe('g1')
    expect(s.vera.plays.some((p) => p.id === 'neugadala')).toBe(true)
  })

  it('разворот на шестнадцатый день: после торможения у «Порога» 11', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    runUntil(s, (x) => x.t >= at(16, '09:00'))
    expect(Math.round(s.tug.fuel)).toBe(23)
    const r = simulatePlan(s, [{ to: 'porog', mode: 'eco' }])
    expect(Math.round(r.legs[0]!.fuelAfter)).toBe(11)
    applyPlan(s, [{ to: 'porog', mode: 'eco' }])
    expect(s.vera.razvorotDue).toBe(true)
    runUntil(s, (x) => x.t >= at(17, '09:00'))
    expect(s.vera.plays.at(-1)!.id).toBe('razvorot')
    finish(s)
    expect(s.ending?.kind).toBe('razvorot')
  })

  it('форсаж к «Ключу» с утра дня 7: прибытие д9 15:44, топлива после торможения 46', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    fromDay7(s, [leg('smena', 'cruise'), leg('okolica', 'cruise'), leg('pereval', 'eco')])
    // Списана только разница разгонов: 67 − 5.
    expect(s.tug.fuel).toBe(62)
    expect(fmt(s.tug.flight!.arrive)).toBe('д9 15:44')
    runUntil(s, (x) => x.st.klyuch.arrived !== null)
    expect(fmt(s.st.klyuch.arrived!)).toBe('д9 15:44')
    expect(s.tug.fuel).toBe(46)
    expect(s.st.klyuch.rescued).toBe(true)
    expect(airEnd(s, 'klyuch') - s.st.klyuch.arrived!).toBeCloseTo(6.3, 1)
  })

  it('смена режима в планировщике показывает доплату и новое прибытие', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    runUntil(s, (x) => x.t >= at(7, '08:00'))
    const r = simulatePlan(s, [leg('klyuch', 'burn'), leg('smena', 'cruise'), leg('okolica', 'cruise'), leg('pereval', 'eco')])
    expect(r.legs[0]!.switchCost).toBe(5)
    expect(fmt(r.legs[0]!.arrive)).toBe('д9 15:44')
    expect(r.legs[0]!.fuelAfter).toBe(46)
  })

  it('форсаж без возврата топлива: дрейф', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    fromDay7(s, [leg('smena', 'cruise'), leg('okolica', 'cruise'), leg('pereval', 'eco')])
    // До новости об «Околице» курс сходится по времени, но не по топливу.
    runUntil(s, (x) => x.t >= at(14, '08:00'))
    expect(courseState(s)).toEqual({ k: 'fuel', need: 10 })
    finish(s)
    expect(s.ending?.kind).toBe('drift')
  })

  const G: [string, Leg[], Partial<Leg>, [StationId, string, number][], number][] = [
    [
      'Г1',
      [leg('smena', 'cruise'), leg('okolica', 'burn', true), leg('pereval', 'eco')],
      { drain: true },
      [['sinica', 'д5 10:48', 78], ['klyuch', 'д9 15:44', 56], ['smena', 'д15 16:26', 34], ['okolica', 'д19 12:59', 12]],
      12,
    ],
    [
      'Г2',
      [leg('smena', 'cruise', true), leg('okolica', 'burn', true), leg('pereval', 'eco')],
      {},
      [['sinica', 'д5 10:48', 78], ['klyuch', 'д9 15:44', 46], ['smena', 'д14 22:26', 36], ['okolica', 'д19 12:59', 14]],
      14,
    ],
    [
      'Г3',
      [leg('smena', 'cruise'), leg('okolica', 'cruise', true), leg('pereval', 'eco')],
      {},
      [['sinica', 'д5 10:48', 78], ['klyuch', 'д9 15:44', 46], ['smena', 'д14 22:26', 24], ['okolica', 'д19 23:17', 12]],
      12,
    ],
  ]
  for (const [name, rest, kl, stops, fuelEnd] of G) {
    it(`${name}: 11 спасённых, прибытия и топливо — как в скрипте`, () => {
      const s = newGame()
      applyPlan(s, VERA_COURSE)
      // У Г3 экономия «Околице» отдана с утра дня 15, когда пришла новость.
      fromDay7(s, rest, kl)
      const fuelAt: Partial<Record<StationId, number>> = {}
      for (const [id] of stops) {
        if (name === 'Г3' && id === 'okolica') {
          runUntil(s, (x) => x.t >= at(15, '08:00'))
          expect(orderEco(s, 'okolica')).toBe(true)
        }
        runUntil(s, (x) => x.st[id].arrived !== null)
        // Топливо после стыковки: со сливом — после слива.
        fuelAt[id] = s.tug.fuel
      }
      for (const [id, arr, fuel] of stops) {
        expect(fmt(s.st[id].arrived!), `${name} ${id}`).toBe(arr)
        // «Синица» пройдена до правки курса: её топливо проверяет форсаж с утра дня 7 (67 − 5).
        if (id !== 'sinica') expect(fuelAt[id], `${name} ${id} топливо`).toBe(fuel)
        expect(s.st[id].rescued, id).toBe(true)
      }
      expect(s.tug.fuel).toBe(fuelEnd)
      expect(savedCount(s)).toBe(11)
      finish(s)
      expect(s.ending?.kind).toBe('kurs')
    })
  }

  it('«Артель Громова» с экономией в первый час: запас 0,9 ч', () => {
    const s = newGame()
    expect(orderEco(s, 'artel')).toBe(true)
    expect(orderEco(s, 'artel')).toBe(false)
    const r = simulatePlan(s, [leg('artel', 'burn'), leg('pereval', 'eco')])
    expect(r.legs[0]!.margin!).toBeCloseTo(0.9, 1)
    applyPlan(s, [leg('artel', 'burn'), leg('pereval', 'eco')])
    runUntil(s, (x) => x.st.artel.arrived !== null)
    expect(s.st.artel.rescued).toBe(true)
    // Людей выносят: стыковка 12 часов.
    expect(s.tug.dockUntil! - s.st.artel.arrived!).toBeCloseTo(12, 6)
  })

  it('новость о «Ключе» лежит в журнале к 08:00 дня 7, об «Околице» — к 08:00 дня 15', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    runNext(s, (x) => x.t >= at(7, '08:00'))
    expect(s.t).toBeCloseTo(at(7, '08:00'), 6)
    const j7 = journalView(s)
    const k = j7.course.find((x) => x.st === 'klyuch' && x.marks.includes('air'))
    expect(k).toBeTruthy()
    expect(fmt(k!.airWas!)).toBe('д10 20:00')
    expect(fmt(k!.airNow!)).toBe('д9 22:00')
    expect(fmt(signalEnd(s, 'klyuch'))).toBe('д9 22:00')
    expect(courseState(s)).toMatchObject({ k: 'late', st: 'klyuch' })
    expect(Math.round((courseState(s) as { h: number }).h)).toBe(12)
    runNext(s, (x) => x.t >= at(15, '08:00'))
    expect(s.t).toBeCloseTo(at(15, '08:00'), 6)
    const o = journalView(s).course.find((x) => x.st === 'okolica' && x.marks.includes('air'))
    expect(o).toBeTruthy()
    expect(fmt(o!.airNow!)).toBe('д19 20:00')
  })

  it('курс стал хуже после новости — уведомление; ночью «Дальше» не останавливается', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    runNext(s, (x) => x.t >= at(6, '20:00'))
    chooseEvening(s, null)
    const n = advance(s, 'next')
    expect(s.t).toBeCloseTo(at(7, '08:00'), 6)
    const c = n.find((x) => x.k === 'course')
    expect(c).toMatchObject({ k: 'course', state: { k: 'late', st: 'klyuch' } })
    expect(s.course.k).toBe('late')
  })

  it('станция под экономией сообщает об отклонении строкой автомата, базовые сеансы молчат', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    orderEco(s, 'klyuch')
    const order = s.st.klyuch.order!
    runUntil(s, (x) => x.t >= at(7, '08:00'))
    const got = s.st.klyuch.got
    const dev = got.find((id) => id.startsWith('klyuch:dev'))
    expect(dev).toBeTruthy()
    const text = s.journal.find((x) => x.id === dev)
    expect(text).toBeTruthy()
    const sess = receivedSessions(s, 'klyuch')
    expect(sess.find((x) => x.id === dev)!.text).toBe('[автомат] СТАНЦИЯ «ТЁПЛЫЙ КЛЮЧ» · ЛЮДЕЙ: 2 · ВОЗДУХ: ДО Д10 06:00')
    expect(sess.some((x) => x.id.startsWith('klyuch:a'))).toBe(true)
    expect(sess.filter((x) => x.branch === 'base' && x.id.includes(':b')).every((x) => x.at < order.arrives)).toBe(true)
    // Правда: −22 и +8.
    expect(fmt(airEnd(s, 'klyuch'))).toBe('д10 06:00')
  })

  it('сеанс отклонения: голос людей, число в тексте совпадает с движком, под экономией — автомат', () => {
    const want = {
      klyuch: { day: 9, h: 22, words: ['девятых суток', 'двадцати двух'] },
      okolica: { day: 19, h: 20, words: ['девятнадцатых суток', 'восьми вечера'] },
    }
    for (const [id, w] of Object.entries(want) as [StationId, (typeof want)['klyuch']][]) {
      const s = newGame()
      const c = clockOf(airEnd(s, id))
      expect([c.day, c.h, c.m]).toEqual([w.day, w.h, 0])
      const dev = sessionsOf(s, id).find((x) => x.id.startsWith(`${id}:dev`))!
      expect(dev.text.startsWith('[автомат]')).toBe(false)
      for (const word of w.words) expect(dev.text, id).toContain(word)
      // Через час после отклонения.
      expect(dev.at).toBeCloseTo(DEVIATIONS.find((d) => d.station === id)!.t + 1, 6)
      // Станции, которой отправили слово ещё в первый день, новость тоже приходит.
      const s2 = newGame()
      s2.st[id].reply = { kind: 'hold', sent: 4, arrives: 6, text: '' }
      const dev2 = sessionsOf(s2, id).find((x) => x.id.startsWith(`${id}:dev`))
      expect(dev2?.text).toBe(dev.text)
      // Под экономией — строка автомата с тем же числом.
      const s3 = newGame()
      s3.st[id].order = { sent: 5, arrives: 7 }
      const dev3 = sessionsOf(s3, id).find((x) => x.id.startsWith(`${id}:dev`))!
      const e = clockOf(airEnd(s3, id))
      expect(dev3.text).toBe(
        `[автомат] СТАНЦИЯ «${STATION[id].name.toUpperCase()}» · ЛЮДЕЙ: ${STATION[id].people} · ВОЗДУХ: ДО Д${e.day} ${pad(e.h)}:${pad(e.m)}`,
      )
    }
  })

  it('сеансы «Ключа» после дня 6 не обещают «норму» и не звучат позже нового конца воздуха', () => {
    const s = newGame()
    const after = sessionsOf(s, 'klyuch').filter((x) => x.at > at(6, '21:00'))
    expect(after.length).toBeGreaterThan(1)
    for (const x of after) {
      expect(x.text).not.toMatch(/по графику|Норма/)
      expect(x.at).toBeLessThan(airEnd(s, 'klyuch'))
    }
    const afterO = sessionsOf(s, 'okolica').filter((x) => x.at > at(14, '21:00'))
    for (const x of afterO) expect(x.at).toBeLessThan(airEnd(s, 'okolica'))
  })

  it('экономия: у каждой станции одно подтверждение, после него базовые сеансы молчат', () => {
    for (const d of STATIONS) {
      const s = newGame()
      s.st[d.id].order = { sent: at(1, '08:00'), arrives: at(1, '10:00') }
      const eco = sessionsOf(s, d.id).filter((x) => x.id === `${d.id}:eco`)
      expect(eco, d.id).toHaveLength(1)
      expect(eco[0]!.at).toBeGreaterThan(at(1, '10:00'))
      expect(sessionsOf(s, d.id).filter((x) => x.id.includes(':b') && x.at > at(1, '10:00')), d.id).toHaveLength(0)
    }
  })

  it('«Колыбель» под экономией: «Я выключаюсь» звучит ровно один раз, приборы после неё не читаются', () => {
    const kinds = [null, 'hold', 'eta', 'papa'] as const
    for (const kind of kinds) {
      for (const eco of [at(3, '12:00'), at(9, '12:00')]) {
        const s = newGame()
        if (kind) s.st.kolybel.reply = { kind, sent: at(1, '08:00'), arrives: at(1, '10:00'), text: '' }
        s.st.kolybel.order = { sent: eco - 2, arrives: eco }
        const list = sessionsOf(s, 'kolybel')
        const off = list.filter((x) => x.text.includes('Я выключаюсь'))
        expect(off, `${kind} ${eco}`).toHaveLength(1)
        expect(list.filter((x) => x.text.includes('Давление —') && x.at > eco), `${kind} ${eco}`).toHaveLength(0)
      }
    }
    // Распоряжение пришло, когда Тася уже выключилась сама: подтверждения нет, фраза тоже одна.
    const s = newGame()
    s.st.kolybel.order = { sent: at(14, '20:00'), arrives: at(14, '22:00') }
    const list = sessionsOf(s, 'kolybel')
    expect(list.some((x) => x.id === 'kolybel:eco')).toBe(false)
    expect(list.filter((x) => x.text.includes('Я выключаюсь'))).toHaveLength(1)
  })

  it('строки интерфейса: подписи «Дальше», строка состояния, подсказки, пометки журнала', () => {
    expect(NEXT.arriveStation('smena')).toBe('Дальше: до стыковки со «Второй сменой»')
    expect(NEXT.arriveStation('klyuch')).toBe('Дальше: до стыковки с «Тёплым Ключом»')
    expect(NEXT.arriveFinal('pereval')).toBe('Дальше: до «Перевала»')
    expect(NEXT.departFinal('porog')).toBe('Дальше: до вылета на «Порог»')
    expect(statusLine({ k: 'ok', saved: 11 })).toBe('Курс сходится. На борту к концу: 11.')
    expect(statusLine({ k: 'late', st: 'klyuch', h: 12 })).toBe('Курс не сходится: «Тёплый Ключ», опоздание 12 ч.')
    expect(statusLine({ k: 'late', st: 'okolica', h: 21.5 })).toBe('Курс не сходится: «Околица», опоздание 21,5 ч.')
    expect(statusLine({ k: 'fuel', need: 10 })).toBe('До «Перевала» не хватает 10 топлива.')
    expect(hours(21.5)).toBe('21,5 ч')
    expect(hours(-21.54)).toBe('21,5 ч')
    expect(HINTS).toHaveLength(4)
    expect(journalMark('air', { airWas: STATION.klyuch.T, airNow: airEnd(newGame(), 'klyuch') })).toBe(
      'воздух: было до д10 20:00, стало до д9 22:00',
    )
    expect(journalMark('silent', {})).toBe('замолчала')
    expect(confirmCourse({ k: 'ok', saved: 11 })).toBeNull()
  })

  it('«Дальше»: подпись, ночью новости не будят, остановки на 08:00 и 20:00', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    expect(nextLabel(s)).toBe('Дальше: до вечера')
    advance(s, 'next')
    expect(s.t).toBeCloseTo(at(1, '20:00'), 6)
    chooseEvening(s, null)
    advance(s, 'next')
    expect(s.t).toBeCloseTo(at(2, '08:00'), 6)
    runNext(s, (x) => x.t >= at(5, '08:00'))
    expect(nextLabel(s)).toBe('Дальше: до стыковки с «Синицей»')
    advance(s, 'next')
    expect(fmt(s.t)).toBe('д5 10:48')
    const before = s.t
    advance(s, '1h')
    expect(s.t).toBeCloseTo(before + 1, 6)
  })

  it('«Дальше» днём останавливается на новости по станции курса: тишина «Зари»', () => {
    const s = newGame()
    applyPlan(s, [...VERA_COURSE.slice(0, 4), leg('zarya', 'eco'), leg('pereval', 'eco')])
    runNext(s, (x) => x.t >= at(7, '08:00'))
    advance(s, 'next')
    expect(s.t).toBeLessThan(at(7, '20:00'))
    expect(s.st.zarya.silentHeard).toBeCloseTo(s.t, 6)
    expect(journalView(s).course.some((x) => x.st === 'zarya' && x.marks.includes('silent'))).toBe(true)
  })

  it('после прощания «Дальше» встаёт в 08:00 и 20:00, подпись совпадает с остановкой', () => {
    const s = newGame()
    applyPlan(s, [leg('sinica', 'cruise'), leg('mayak', 'cruise'), leg('pereval', 'eco')])
    runUntil(s, (x) => x.final.stage === 'farewell')
    continueAfterFinal(s)
    for (let i = 0; i < 4; i++) {
      const from = s.t
      const label = nextLabel(s)
      advance(s, 'next')
      expect(s.t - from).toBeLessThanOrEqual(12 + 1e-6)
      if (label === 'Дальше: до вечера') expect(fmt(s.t).endsWith('20:00')).toBe(true)
      if (label === 'Дальше: до утра') expect(fmt(s.t).endsWith('08:00')).toBe(true)
      if (s.tug.flight?.to === 'pereval') break
    }
    expect(s.tug.flight?.to).toBe('pereval')
  })

  it('слив на стоянке: один раз, топливо сразу, стоянка на 18 часов длиннее', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    runUntil(s, (x) => x.st.sinica.arrived !== null)
    const fuel = s.tug.fuel
    const until = s.tug.dockUntil!
    expect(canDrain(s)).toBe(true)
    drain(s)
    expect(s.tug.fuel).toBe(fuel + 4)
    expect(s.tug.dockUntil).toBeCloseTo(until + 18, 6)
    expect(canDrain(s)).toBe(false)
  })

  it('день 21: в плане ещё станция — рейс продолжается, эпилог с уходом к «Перевалу»', () => {
    const s = newGame()
    // «Маяк-3» крейсером от «Синицы»: прибытие д22, после прощания.
    applyPlan(s, [leg('sinica', 'cruise'), leg('mayak', 'cruise'), leg('pereval', 'eco')])
    runUntil(s, (x) => x.final.stage === 'farewell')
    expect(s.tug.flight?.to).toBe('mayak')
    expect(canContinueAfterFinal(s)).toBe(true)
    continueAfterFinal(s)
    runNext(s, (x) => !!x.tug.flight && x.tug.flight.to === 'pereval')
    expect(s.st.mayak.rescued).toBe(true)
    expect(s.tug.flight?.to).toBe('pereval')
  })

  it('Г1: вылет к «Перевалу» на д20 не утверждается, до прощания буксир стоит', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    fromDay7(s, [leg('smena', 'cruise'), leg('okolica', 'burn', true), leg('pereval', 'eco')], { drain: true })
    runUntil(s, (x) => x.st.okolica.arrived !== null && x.tug.dockUntil === null)
    expect(fmt(s.t)).toBe('д20 12:59')
    const r = applyPlan(s, [leg('pereval', 'eco')])
    expect(r.ok).toBe(false)
    expect(r.err).toBe('Вылет после сводки дня 21.')
    expect(s.tug.flight).toBeNull()
    runUntil(s, (x) => x.final.stage === 'farewell')
    expect(s.final.stage).toBe('farewell')
  })

  it('слепой рейс: вечерние слова о «Ключе» и одиннадцати не предлагаются', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    runUntil(s, (x) => x.eveningDue === 10)
    expect(eveningOptions(s, 10).map((o) => o.id)).not.toContain('e10a')
    runUntil(s, (x) => x.eveningDue === 20)
    expect(eveningOptions(s, 20).map((o) => o.id)).not.toContain('e20a')
    expect(eveningOptions(s, 20).map((o) => o.id)).toContain('e20d')
    s.st.klyuch.rescued = true
    expect(eveningOptions(s, 10).map((o) => o.id)).toContain('e10a')
    s.tug.aboard = Array(11).fill('zoya')
    expect(eveningOptions(s, 20).map((o) => o.id)).toContain('e20a')
    expect(eveningOptions(s, 20).map((o) => o.id)).not.toContain('e20d')
  })

  it('«Маяк-3» после дня 21: 10 на борту и прибытие к «Перевалу»', () => {
    const s = newGame()
    applyPlan(s, [leg('sinica', 'cruise'), leg('klyuch', 'burn', true), leg('smena', 'cruise', true), leg('mayak', 'burn'), leg('pereval', 'eco')])
    runNext(s, (x) => x.final.stage === 'farewell')
    expect(s.t).toBe(at(21, '08:00'))
    expect(s.tug.flight?.to).toBe('mayak')
    expect(savedCount(s)).toBe(9)
    expect(continueAfterFinal(s)).toBe(true)
    const back = deserialize(serialize(s))!
    runNext(back, (x) => x.tug.flight?.to === 'pereval')
    expect(back.st.mayak.rescued).toBe(true)
    expect(fmt(back.st.mayak.arrived!)).toBe('д23 23:13')
    runEpilogue(back)
    expect(back.tug.at).toBe('pereval')
    expect(savedCount(back)).toBe(10)
    expect(back.ending?.kind).toBe('svoy')
  })

  it('ожидание после стыковки: слив доступен, вылет напрямую до прощания запрещён', () => {
    const s = newGame()
    applyPlan(s, [leg('zarya', 'burn'), leg('pereval', 'eco')])
    runUntil(s, (x) => x.st.zarya.arrived !== null && x.tug.dockUntil === null)
    const before = s.tug.fuel
    expect(canDrain(s)).toBe(true)
    drain(s)
    expect(s.tug.fuel).toBe(before + 6)
    expect(s.tug.dockUntil).toBe(s.t + 18)
    expect(canDrain(s)).toBe(false)
    runUntil(s, (x) => x.tug.dockUntil === null)
    depart(s)
    expect(s.tug.flight).toBeNull()
  })

  it('нет топлива по прямой — нет запаса рядом со статусом «не успеть»', () => {
    const s = newGame()
    s.tug.fuel = 0
    expect(stationView(s, 'mayak')).toMatchObject({ status: 'out', margin: null })
  })

  it('сохранение: новая версия читается, старая — нет', () => {
    const s = newGame()
    orderEco(s, 'zarya')
    const back = deserialize(serialize(s))!
    expect(back.v).toBe(SAVE_VERSION)
    expect(back.st.zarya.order).toEqual(s.st.zarya.order)
    expect(deserialize(JSON.stringify({ ...s, v: 3 }))).toBeNull()
  })

  it('тишина доходит со скоростью света', () => {
    const s = newGame()
    applyPlan(s, VERA_COURSE)
    runUntil(s, (x) => x.st.polynya.silentHeard !== null)
    expect(s.st.polynya.silentHeard!).toBeGreaterThan(at(3, '04:00'))
    expect(s.st.polynya.silentHeard!).toBeLessThan(at(3, '06:00'))
  })

  it('ответ правдой даёт письмо, если дошёл до конца воздуха', () => {
    const s = newGame()
    s.st.mayak.reply = null
    applyPlan(s, VERA_COURSE)
    // Ответ «Маяку» в первый день.
    sendReply(s, 'mayak', 'truth', 'тест')
    runUntil(s, (x) => x.letters.some((l) => l.station === 'mayak'), 20000)
    expect(s.letters.some((l) => l.station === 'mayak')).toBe(true)
  })

  it('у каждого файла Веры, который может прозвучать, есть текст', () => {
    const ids = [
      ...Array.from({ length: 20 }, (_, i) => `m${i + 1}`),
      'k1',
      'k2',
      'k3',
      ...Array.from({ length: 6 }, (_, i) => `g${i + 1}`),
      'neugadala',
      'razvorot',
      'farewellA',
      'farewellB',
    ]
    for (const id of ids) expect(VERA[id], id).toBeTruthy()
  })
})
