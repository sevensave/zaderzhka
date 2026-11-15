// Симуляция рейса. Чистые функции над сериализуемым состоянием, без DOM.
// Шаг времени — раздел 13 механики: ближайшее событие, буксир, сеансы, тишина, статусы,
// контрольные точки, утро и вечер, прибытие. Версия 2.0 — zaderzhka-mehanika-2.md: отклонения,
// воздух по сигналу, экономия, слив, смена режима в полёте, состояние курса, журнал, «Дальше».

import { boardFor } from '../content/board'
import { PEOPLE } from '../content/people'
import { SCRIPTS } from '../content/stations'
import { FINAL_WAIT, NEXT } from '../content/ui-text'
import type { BranchLine, ReplyKind } from '../content/types'
import {
  CHECKPOINTS,
  type CheckpointId,
  clockOf,
  DEVIATIONS,
  DOCK_H,
  DRAIN_H,
  ECO_AIR_H,
  ECO_DOCK_H,
  dayOf,
  dist,
  FINAL_T,
  FINALS,
  isFinal,
  type Leg,
  MIN_FLIGHT,
  type Mode,
  MODE_IDS,
  MODES,
  place,
  type PlaceId,
  type Point,
  SEATS,
  STATION,
  type StationId,
  STATIONS,
  TANK,
  VERA_COURSE,
} from './world'

export const SAVE_VERSION = 5
const EPS = 1e-7

export interface Flight {
  fx: number
  fy: number
  to: PlaceId
  mode: Mode
  /** Момент вылета или последней смены режима: (fx, fy) — точка в этот момент. */
  depart: number
  arrive: number
  /** Слить топливо при прибытии. */
  drain?: boolean
}

export interface Tug {
  x: number
  y: number
  fuel: number
  flight: Flight | null
  /** Где стоим (после торможения). */
  at: PlaceId | null
  /** Конец стыковки. */
  dockUntil: number | null
  started: boolean
  aboard: string[]
}

export interface Reply {
  kind: ReplyKind
  sent: number
  arrives: number
  text: string
}

export interface StationRt {
  got: string[]
  unread: number
  reply: Reply | null
  /** Когда буксир затормозил у станции. */
  arrived: number | null
  rescued: boolean
  boarded: number
  silentHeard: number | null
  /** Время отправки последнего принятого сеанса. */
  lastSent: number | null
  /** Распоряжение «экономия»: когда отправлено и когда дошло. Одно на станцию, отменить нельзя. */
  order: Order | null
  /** Топливо станции уже слито. */
  drained: boolean
}

export interface Order {
  sent: number
  arrives: number
}

export interface VeraPlay {
  id: string
  t: number
  delay: number
  heard: boolean
  /** Чем ретранслятор объяснил выбор: для служебных заголовков. */
  why: string
}

export type VeraMode = 'route' | 'kolybel' | 'generic'

export interface VeraRt {
  mode: VeraMode
  kolybelIdx: number
  genericIdx: number
  neugadala: boolean
  razvorotDue: boolean
  razvorotDone: boolean
  plays: VeraPlay[]
  channelOn: boolean
  revealed: boolean
  /** Каким прощанием кончится канал. */
  farewell: 'farewellA' | 'farewellB' | null
}

export interface Evening {
  day: number
  choice: string | null
  sent: number
  receipt: number
  delivered: boolean
}

export interface Letter {
  station: StationId
  text: string
  t: number
}

export type EndingKind = 'kurs' | 'svoy' | 'razvorot' | 'drift'

export interface FinalRt {
  /** 'cont' — после прощания рейс продолжается: в плане или в полёте ещё есть станция. */
  stage: 'none' | 'farewell' | 'efir' | 'porog' | 'flight' | 'cont' | 'epilogue' | 'screen' | 'after'
  lastWords: string | null
  lastSent: number | null
  lastDelay: number | null
}

export interface GameState {
  v: number
  t: number
  tug: Tug
  plan: Leg[]
  st: Record<StationId, StationRt>
  vera: VeraRt
  evenings: Evening[]
  eveningDue: number | null
  letters: Letter[]
  kt: Partial<Record<CheckpointId, boolean>>
  board: string[]
  ending: { kind: EndingKind; t: number } | null
  final: FinalRt
  /** Какие станции звучали за рейс: для списка имён. */
  heard: StationId[]
  /** Последнее известное игроку состояние курса: с ним сравнивается новое после доставки сеансов. */
  course: CourseState
  /** Всё, что пришло за рейс, по порядку прихода. */
  journal: JournalItem[]
  /** Две последние остановки «Дальше»: журнал показывает то, что пришло между ними (stopPrev, stopLast]. */
  stopPrev: number
  stopLast: number
}

export type CourseState =
  | { k: 'ok'; saved: number }
  | { k: 'late'; st: StationId; h: number }
  | { k: 'fuel'; need: number }

export type JournalMark = 'air' | 'silent' | 'letter'

export interface JournalItem {
  /** Когда пришло к буксиру. */
  t: number
  st: StationId
  /** Сеанс; для тишины — null. */
  id: string | null
  /** Когда отправлено. */
  sent: number
  marks: JournalMark[]
  /** Для пометки «воздух»: было и стало по сигналу. */
  airWas?: number
  airNow?: number
}

export type Notice =
  | { k: 'session'; st: StationId; id: string }
  | { k: 'silence'; st: StationId }
  | { k: 'letter'; st: StationId }
  | { k: 'morning'; file: string | null }
  | { k: 'evening'; day: number }
  | { k: 'receipt'; day: number }
  | { k: 'arrive'; to: PlaceId; alive: boolean; boarded: number }
  | { k: 'depart'; to: PlaceId }
  | { k: 'porogTurn' }
  | { k: 'zoya' }
  | { k: 'final' }
  | { k: 'ending'; kind: EndingKind }
  /** Состояние курса стало хуже после доставки сеансов. */
  | { k: 'course'; state: CourseState }
  | { k: 'drain'; st: StationId; fuel: number }
  /** Стоянка кончилась, а следующей цели нет. */
  | { k: 'idle' }

/** Уведомления, на которых время останавливается и открывается экран. */
export function isStop(n: Notice, s: GameState): boolean {
  switch (n.k) {
    case 'morning':
      return n.file !== null && s.vera.channelOn
    case 'evening':
    case 'zoya':
    case 'final':
    case 'porogTurn':
      return true
    case 'arrive':
      return true
    default:
      return false
  }
}

// ——— создание ———

export function newGame(): GameState {
  const st = {} as Record<StationId, StationRt>
  for (const d of STATIONS) {
    st[d.id] = {
      got: [],
      unread: 0,
      reply: null,
      arrived: null,
      rescued: false,
      boarded: 0,
      silentHeard: null,
      lastSent: null,
      order: null,
      drained: false,
    }
  }
  const s: GameState = {
    v: SAVE_VERSION,
    t: 0,
    tug: { x: 0, y: 0, fuel: TANK, flight: null, at: null, dockUntil: null, started: false, aboard: [] },
    plan: VERA_COURSE.map((l) => ({ ...l })),
    st,
    vera: {
      mode: 'route',
      kolybelIdx: 0,
      genericIdx: 0,
      neugadala: false,
      razvorotDue: false,
      razvorotDone: false,
      plays: [],
      channelOn: true,
      revealed: false,
      farewell: null,
    },
    evenings: [],
    eveningDue: null,
    letters: [],
    kt: {},
    board: [],
    ending: null,
    final: { stage: 'none', lastWords: null, lastSent: null, lastDelay: null },
    heard: [],
    course: { k: 'ok', saved: 0 },
    journal: [],
    stopPrev: -1,
    stopLast: 0,
  }
  // Всё, что пришло до первой сводки, уже лежит в журнале.
  deliver(s, 0, [])
  for (const id of Object.keys(s.st) as StationId[]) s.st[id].unread = 0
  playMorning(s, 1, [])
  s.course = courseState(s)
  return s
}

// ——— геометрия ———

export function posAt(s: GameState, time: number): Point {
  const f = s.tug.flight
  if (!f) return { x: s.tug.x, y: s.tug.y }
  const to = place(f.to)
  if (time >= f.arrive) return { x: to.x, y: to.y }
  const k = Math.max(0, (time - f.depart) / (f.arrive - f.depart))
  return { x: f.fx + (to.x - f.fx) * k, y: f.fy + (to.y - f.fy) * k }
}

export function tugPos(s: GameState): Point {
  return posAt(s, s.t)
}

/** Задержка канала «Порог»: честное расстояние до базы. */
export function porogDelay(s: GameState, time = s.t): number {
  return dist(posAt(s, time), FINALS.porog)
}

/** Наименьший t' ≥ lo, где g(t') ≥ 0. g неубывает. */
function firstAt(lo: number, g: (t: number) => number, span = 2000): number {
  if (g(lo) >= -EPS) return lo
  let hi = lo + span
  if (g(hi) < 0) return Infinity
  let a = lo
  for (let i = 0; i < 60; i++) {
    const m = (a + hi) / 2
    if (g(m) >= 0) hi = m
    else a = m
  }
  return hi
}

// ——— воздух ———

/**
 * Конец воздуха станции к моменту `time`: расчёт Веры, плюс случившиеся к этому моменту отклонения,
 * плюс 8 часов, если экономия дошла, пока воздух не кончился. Без `time` — правда на весь рейс.
 */
export function airEnd(s: GameState, id: StationId, time = Infinity): number {
  const evs: { t: number; dh: number }[] = DEVIATIONS.filter((d) => d.station === id).map((d) => ({ t: d.t, dh: d.dh }))
  const o = s.st[id].order
  if (o) evs.push({ t: o.arrives, dh: ECO_AIR_H })
  evs.sort((a, b) => a.t - b.t)
  let end = STATION[id].T
  for (const e of evs) {
    if (e.t > time + EPS) break
    // Воздух уже кончился: дальше ничего не меняется.
    if (e.t >= end) break
    end = Math.max(e.t, end + e.dh)
  }
  return end
}

/** Конец воздуха, который станция знала о себе в момент `sent`: отклонения до него, без экономии. */
function knownEnd(id: StationId, sent: number): number {
  let end = STATION[id].T
  for (const d of DEVIATIONS) if (d.station === id && d.t <= sent + EPS && d.t < end) end = Math.max(d.t, end + d.dh)
  return end
}

/**
 * «Воздух по сигналу»: конец воздуха на момент отправки последнего принятого сеанса.
 * Если экономия отправлена и по этому числу успевает — плюс 8. От него считаются запас и опоздание.
 */
export function signalEnd(s: GameState, id: StationId): number {
  const rt = s.st[id]
  const end = knownEnd(id, rt.lastSent ?? -Infinity)
  if (rt.order && rt.order.arrives < end) return end + ECO_AIR_H
  return end
}

/** Экономия дошла до станции к моменту `time`. */
function ecoActive(s: GameState, id: StationId, time = s.t): boolean {
  const o = s.st[id].order
  return !!o && o.arrives <= time + EPS && o.arrives < airEnd(s, id, o.arrives)
}

// ——— сеансы ———

export interface Session {
  id: string
  at: number
  text: string
  letter: boolean
  branch: 'base' | ReplyKind
}

function branchAt(line: BranchLine, ta: number, T: number): number {
  if (line.at !== undefined) return line.at > ta ? line.at : -Infinity
  const a = line.dt !== undefined ? ta + line.dt : ta + (line.p ?? 0.5) * (T - ta)
  return line.minAt !== undefined ? Math.max(a, line.minAt) : a
}

/** Все сеансы станции с учётом ответа и стыковки. Мемо по ключу состояния. */
const sessionCache = new Map<string, Session[]>()
export function sessionsOf(s: GameState, id: StationId): Session[] {
  const rt = s.st[id]
  const key = `${id}|${rt.reply?.kind ?? '-'}|${rt.reply?.arrives ?? '-'}|${rt.arrived ?? '-'}|${rt.order?.arrives ?? '-'}`
  const hit = sessionCache.get(key)
  if (hit) return hit
  const def = STATION[id]
  const sc = SCRIPTS[id]
  const cut = rt.arrived ?? Infinity
  const end = airEnd(s, id)
  const ta = rt.reply && rt.reply.arrives < end ? rt.reply.arrives : Infinity
  // После прихода экономии люди молчат: базовые сеансы не звучат, раз в сутки — строка автомата.
  const te = ecoActive(s, id, Infinity) ? rt.order!.arrives : Infinity
  const out: Session[] = []
  sc.base.forEach((b, i) => {
    if (b.at < ta && b.at < te && b.at < cut && b.at < end) out.push({ id: `${id}:b${i}`, at: b.at, text: b.text, letter: false, branch: 'base' })
  })
  if (te < Infinity) {
    for (let k = 1; te + 24 * k < Math.min(end, cut); k++) {
      const a = te + 24 * k
      out.push({ id: `${id}:a${k}`, at: a, text: automatonLine(s, id, a), letter: false, branch: 'base' })
    }
  }
  // Об отклонении станция сообщает через час после него. Люди — своим голосом, под экономией — автомат.
  DEVIATIONS.forEach((d, i) => {
    if (d.station !== id) return
    const a = d.t + 1
    if (a < end && a < cut) {
      const human = sc.dev !== undefined && a < te
      out.push({ id: `${id}:dev${i}`, at: a, text: human ? sc.dev! : automatonLine(s, id, a), letter: false, branch: 'base' })
    }
  })
  // Люди подтверждают распоряжение и замолкают.
  if (te < Infinity && (sc.eco.before === undefined || te < sc.eco.before)) {
    const a = te + (sc.eco.dt ?? 0.3)
    if (a < end && a < cut) out.push({ id: `${id}:eco`, at: a, text: sc.eco.text, letter: false, branch: 'base' })
  }
  if (ta < Infinity && rt.reply) {
    const lines = sc[rt.reply.kind] ?? []
    lines.forEach((l, i) => {
      const a = branchAt(l, ta, end)
      if (a > -Infinity && a < end - 0.01 && a < cut && !(l.quiet && a >= te)) {
        out.push({ id: `${id}:${rt.reply!.kind}${i}`, at: a, text: l.text, letter: !!l.letter, branch: rt.reply!.kind })
      }
    })
  }
  out.sort((a, b) => a.at - b.at)
  sessionCache.set(key, out)
  return out
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** «[автомат] СТАНЦИЯ «…» · ЛЮДЕЙ: N · ВОЗДУХ: ДО ДN ЧЧ:ММ» — как у «Синицы». */
export function automatonLine(s: GameState, id: StationId, sent: number): string {
  const def = STATION[id]
  const c = clockOf(airEnd(s, id, sent))
  return `[автомат] СТАНЦИЯ «${def.name.toUpperCase()}» · ЛЮДЕЙ: ${def.people} · ВОЗДУХ: ДО Д${c.day} ${pad2(c.h)}:${pad2(c.m)}`
}

export function receivedSessions(s: GameState, id: StationId): Session[] {
  const got = new Set(s.st[id].got)
  return sessionsOf(s, id).filter((x) => got.has(x.id))
}

/** Сеанс приходит, когда t − отправка ≥ расстояние от станции до буксира в момент t. */
function deliveryTime(s: GameState, from: Point, sent: number): number {
  return firstAt(Math.max(s.t, sent), (t) => t - sent - dist(from, posAt(s, t)))
}

// ——— расчёты ———

/** Когда буксир сможет начать новый перелёт. */
function departureAt(s: GameState, time = s.t): number {
  if (s.tug.dockUntil !== null && !s.tug.flight) return Math.max(time, s.tug.dockUntil)
  return time
}

export interface ModeCalc {
  mode: Mode
  arrive: number
  /** От воздуха по сигналу. */
  margin: number
  fuelOk: boolean
}

/** Перелёт к станции по прямой из текущего положения в каждом режиме. */
export function directCalc(s: GameState, id: StationId, time = s.t): ModeCalc[] {
  const def = STATION[id]
  const p = posAt(s, time)
  const d = dist(p, def)
  const dep = departureAt(s, time)
  const end = signalEnd(s, id)
  const f = s.tug.flight
  return MODE_IDS.map((m) => {
    const md = MODES[m]
    const arrive = dep + d * md.h
    // В полёте к этой же станции разгон уже оплачен: доплачивается разница.
    const acc = f && f.to === id ? Math.abs(md.acc - MODES[f.mode].acc) : md.acc
    return { mode: m, arrive, margin: end - arrive, fuelOk: s.tug.fuel + EPS >= acc + md.brk }
  })
}

function bestDirectMargin(s: GameState, id: StationId, time = s.t): number {
  let best = -Infinity
  for (const c of directCalc(s, id, time)) if (c.fuelOk) best = Math.max(best, c.margin)
  return best
}

function reachable(s: GameState, id: StationId, time = s.t): boolean {
  return directCalc(s, id, time).some((c) => c.fuelOk && c.margin >= 0)
}

export interface PlanLegResult {
  leg: Leg
  /** Это текущий перелёт: продолжаем без нового разгона. */
  current: boolean
  /** Текущий перелёт в другом режиме: доплата разницы разгонов сейчас (иначе null). */
  switchCost: number | null
  depart: number
  arrive: number
  /** Запас (+) или опоздание (−) от воздуха по сигналу. */
  margin: number | null
  /** Сколько поднимется на борт по сигналу. */
  boarded: number
  /** Стыковка с учётом экономии и слива, часов. */
  dock: number
  /** Сколько топлива даст слив (0 — слива нет). */
  drained: number
  fuelAfter: number
  fuelOk: boolean
}

export interface PlanResult {
  legs: PlanLegResult[]
  ok: boolean
  /** После курса хватит на экономный перелёт до «Перевала». */
  perevalOk: boolean
  endsFinal: boolean
  saved: number
  /** Топливо после последней строки. */
  fuelEnd: number
}

/** Ноги, которые видит планировщик: текущий перелёт и остаток плана. */
export function activeLegs(s: GameState): Leg[] {
  const f = s.tug.flight
  if (!f) return [...s.plan]
  const cur: Leg = { to: f.to, mode: f.mode }
  if (f.drain) cur.drain = true
  return [cur, ...s.plan]
}

/** Сколько даст слив на станции: не больше, чем влезет в бак. */
function drainGain(s: GameState, id: StationId, fuel: number, done: Set<StationId>): number {
  if (s.st[id].drained || done.has(id)) return 0
  return Math.max(0, Math.min(TANK, fuel + STATION[id].stock) - Math.max(0, fuel))
}

/**
 * Прогон плана по тому, что знает игрок: запас и опоздание — от воздуха по сигналу.
 * Учитывает смену режима текущего перелёта, экономию (стыковка 12 ч) и слив (+18 ч, топливо станции).
 */
export function simulatePlan(s: GameState, legs: Leg[]): PlanResult {
  let t = departureAt(s)
  let pos = tugPos(s)
  let fuel = s.tug.fuel
  let ok = true
  let seats = s.tug.aboard.length
  let saved = seats
  const drainedSet = new Set<StationId>()
  const out: PlanLegResult[] = []
  const f = s.tug.flight
  legs.forEach((leg, i) => {
    const md = MODES[leg.mode]
    const dest = place(leg.to)
    const onCourse = i === 0 && !!f && f.to === leg.to
    const current = onCourse && f!.mode === leg.mode
    let depart = t
    let arrive: number
    let fuelOk: boolean
    let switchCost: number | null = null
    if (current && f) {
      depart = f.depart
      arrive = f.arrive
      fuel -= md.brk
      fuelOk = fuel >= -EPS
    } else if (onCourse && f) {
      // Смена режима на том же курсе: разница разгонов сейчас, торможение по новому режиму.
      switchCost = Math.abs(md.acc - MODES[f.mode].acc)
      fuelOk = fuel + EPS >= switchCost + md.brk
      fuel -= switchCost + md.brk
      depart = s.t
      arrive = s.t + dist(pos, dest) * md.h
    } else {
      fuelOk = fuel + EPS >= md.acc + md.brk
      fuel -= md.acc + md.brk
      arrive = t + dist(pos, dest) * md.h
    }
    if (!fuelOk) ok = false
    let margin: number | null = null
    let boarded = 0
    let dock = 0
    let drained = 0
    if (!isFinal(leg.to)) {
      const id = leg.to
      const def = STATION[id]
      const rt = s.st[id]
      margin = signalEnd(s, id) - arrive
      if (margin >= 0 && !rt.rescued && rt.arrived === null && rt.silentHeard === null && ok) {
        boarded = Math.min(def.saved, SEATS - seats)
        seats += boarded
        saved += boarded
      }
      dock = DOCK_H
      if (boarded > 0 && rt.order && rt.order.arrives <= arrive + EPS) dock += ECO_DOCK_H
      if (leg.drain) {
        drained = drainGain(s, id, fuel, drainedSet)
        fuel += drained
        drainedSet.add(id)
        dock += DRAIN_H
      }
    }
    out.push({ leg, current, switchCost, depart, arrive, margin, boarded, dock, drained, fuelAfter: fuel, fuelOk })
    pos = dest
    t = arrive + dock
  })
  const last = legs[legs.length - 1]
  const endsFinal = !!last && isFinal(last.to)
  return {
    legs: out,
    ok,
    perevalOk: endsFinal ? last!.to === 'pereval' && ok : ok && fuel + EPS >= MIN_FLIGHT,
    endsFinal,
    saved,
    fuelEnd: fuel,
  }
}

export function planCheck(s: GameState, legs: Leg[]): string | null {
  if (legs[0]?.to === 'pereval' && s.final.stage === 'none') return FINAL_WAIT
  for (let i = 0; i < legs.length; i++) {
    if (isFinal(legs[i]!.to) && i !== legs.length - 1) return '«Перевал» и «Порог» — только последней строкой.'
  }
  // Курс, который не сходится или кончается дрейфом, утвердить можно (механика 2.0, раздел 8):
  // нельзя только первую строку, на которую топлива нет сейчас.
  const r = simulatePlan(s, legs.slice(0, 1))
  const bad = r.legs.find((l) => !l.fuelOk)
  if (bad) return `Не хватает топлива на перелёт к «${placeNameOf(bad.leg.to)}».`
  return null
}

/**
 * Состояние курса одной строкой: сходится; не сходится (первая станция с опозданием); не хватает топлива до «Перевала».
 * Считается по тому, что знает игрок.
 */
export function courseState(s: GameState, legs: Leg[] = activeLegs(s)): CourseState {
  const r = simulatePlan(s, legs)
  for (const l of r.legs) {
    if (isFinal(l.leg.to) || l.margin === null) continue
    const rt = s.st[l.leg.to]
    if (rt.rescued || rt.arrived !== null) continue
    if (l.margin < -EPS) return { k: 'late', st: l.leg.to, h: -l.margin }
  }
  // Сколько не хватает: самый глубокий провал по топливу, а если курс не кончается финалом — до экономного перелёта.
  let minFuel = Infinity
  for (const l of r.legs) minFuel = Math.min(minFuel, l.fuelAfter)
  let need = minFuel < -EPS ? -minFuel : 0
  if (!r.endsFinal) need = Math.max(need, MIN_FLIGHT - r.fuelEnd)
  else if (r.legs.at(-1)!.leg.to !== 'pereval') need = 0
  if (need > EPS) return { k: 'fuel', need }
  return { k: 'ok', saved: r.saved }
}

function courseRank(c: CourseState): number {
  return c.k === 'ok' ? 0 : c.k === 'fuel' ? 1 : 2
}

/** Новое состояние хуже старого: тяжелее вид, другая опоздавшая станция или больше часов и топлива. */
function courseWorse(a: CourseState, b: CourseState): boolean {
  if (courseRank(b) !== courseRank(a)) return courseRank(b) > courseRank(a)
  if (a.k === 'late' && b.k === 'late') return a.st !== b.st || b.h > a.h + 0.05
  if (a.k === 'fuel' && b.k === 'fuel') return b.need > a.need + EPS
  if (a.k === 'ok' && b.k === 'ok') return b.saved < a.saved
  return false
}

function placeNameOf(p: PlaceId): string {
  return isFinal(p) ? FINALS[p].name : STATION[p].name
}


// ——— статусы ———

export type Status = 'course' | 'off' | 'out' | 'silent' | 'aboard'

export interface StationView {
  status: Status
  /** Запас (+) или опоздание (−), часов. Для «на курсе» — по плану, иначе лучший по прямой. */
  margin: number | null
  age: number | null
  lastSent: number | null
}

export function inPlan(s: GameState, id: StationId): boolean {
  return activeLegs(s).some((l) => l.to === id)
}

export function stationView(s: GameState, id: StationId, plan?: PlanResult): StationView {
  const rt = s.st[id]
  const age = rt.lastSent === null ? null : s.t - rt.lastSent
  const base = { age, lastSent: rt.lastSent }
  if (rt.rescued) return { status: 'aboard', margin: null, ...base }
  if (rt.silentHeard !== null) return { status: 'silent', margin: null, ...base }
  if (rt.arrived !== null) return { status: 'silent', margin: null, ...base }
  if (inPlan(s, id)) {
    const r = plan ?? simulatePlan(s, activeLegs(s))
    const leg = r.legs.find((l) => l.leg.to === id)
    return { status: 'course', margin: leg?.margin ?? null, ...base }
  }
  const margin = bestDirectMargin(s, id)
  return { status: reachable(s, id) ? 'off' : 'out', margin: Number.isFinite(margin) ? margin : null, ...base }
}

// ——— ответы станциям ———

export function replyOptions(s: GameState, id: StationId): ReplyKind[] {
  const rt = s.st[id]
  if (rt.reply || rt.rescued || rt.silentHeard !== null || rt.arrived !== null || rt.got.length === 0) return []
  const v = stationView(s, id)
  const onTime = v.status === 'course' && (v.margin ?? -1) >= 0
  const out: ReplyKind[] = []
  if (onTime) out.push('eta')
  else out.push('truth')
  out.push('hold')
  if (id === 'kolybel') out.push('papa')
  return out
}

export function sendReply(s: GameState, id: StationId, kind: ReplyKind, text: string): void {
  if (!replyOptions(s, id).includes(kind)) return
  const d = dist(tugPos(s), STATION[id])
  s.st[id].reply = { kind, sent: s.t, arrives: s.t + d, text }
}

// ——— распоряжение «экономия» ———

/** Можно ли отдать станции распоряжение: одно на станцию, пока она не молчит и не на борту. */
export function canOrderEco(s: GameState, id: StationId): boolean {
  const rt = s.st[id]
  return !rt.order && !rt.rescued && rt.silentHeard === null && rt.arrived === null && rt.got.length > 0
}

/** Отправить «экономию». Идёт со скоростью света, отменить нельзя. */
export function orderEco(s: GameState, id: StationId): boolean {
  if (!canOrderEco(s, id)) return false
  const d = dist(tugPos(s), STATION[id])
  s.st[id].order = { sent: s.t, arrives: s.t + d }
  s.course = courseState(s)
  return true
}

// ——— слив ———

/** Можно ли слить топливо: буксир стоит у станции, слива на ней ещё не было. */
export function canDrain(s: GameState): boolean {
  const at = s.tug.at
  if (!at || isFinal(at) || s.tug.flight || s.ending) return false
  return !s.st[at].drained && STATION[at].stock > 0
}

/** Слив на стоянке: топливо сразу, не больше бака; стоянка на 18 часов длиннее. */
export function drain(s: GameState, out: Notice[] = []): Notice[] {
  if (!canDrain(s)) return out
  const id = s.tug.at as StationId
  const before = s.tug.fuel
  s.tug.fuel = Math.min(TANK, s.tug.fuel + STATION[id].stock)
  s.st[id].drained = true
  s.tug.dockUntil = Math.max(s.tug.dockUntil ?? s.t, s.t) + DRAIN_H
  out.push({ k: 'drain', st: id, fuel: s.tug.fuel - before })
  s.course = courseState(s)
  return out
}

// ——— вечер ———

export function chooseEvening(s: GameState, choice: string | null): void {
  const day = s.eveningDue
  if (day === null) return
  const d = porogDelay(s)
  s.evenings.push({ day, choice, sent: s.t, receipt: s.t + 2 * d, delivered: false })
  s.eveningDue = null
}

// ——— курс ———

function startFlight(s: GameState, leg: Leg, out: Notice[]): void {
  const md = MODES[leg.mode]
  const p = tugPos(s)
  const d = dist(p, place(leg.to))
  s.tug.fuel -= md.acc
  s.tug.flight = { fx: p.x, fy: p.y, to: leg.to, mode: leg.mode, depart: s.t, arrive: s.t + d * md.h }
  if (leg.drain && !isFinal(leg.to)) s.tug.flight.drain = true
  s.tug.x = p.x
  s.tug.y = p.y
  s.tug.at = null
  s.tug.dockUntil = null
  s.tug.started = true
  out.push({ k: 'depart', to: leg.to })
  if (leg.to === 'porog') turnToPorog(s, out)
}

function turnToPorog(s: GameState, out: Notice[]): void {
  if (!s.vera.razvorotDone) s.vera.razvorotDue = true
  // Постоянная контрольная точка: цель — «Порог». Маршрутные файлы кончаются.
  if (s.vera.mode !== 'generic') s.vera.mode = 'generic'
  out.push({ k: 'porogTurn' })
}

export function isIdle(s: GameState): boolean {
  return !s.tug.flight && s.tug.dockUntil === null && !s.ending
}

/** Утвердить курс. Если буксир свободен, он сразу вылетает по первой строке. */
export function applyPlan(s: GameState, legs: Leg[]): { ok: boolean; err?: string; notices: Notice[] } {
  const err = planCheck(s, legs)
  if (err) return { ok: false, err, notices: [] }
  if (s.ending) return { ok: false, err: 'Рейс окончен.', notices: [] }
  const out: Notice[] = []
  const f = s.tug.flight
  if (f) {
    const first = legs[0]
    if (!first) return { ok: false, err: 'В полёте курс не может быть пустым.', notices: [] }
    if (first.to === f.to && first.mode === f.mode) {
      s.plan = legs.slice(1).map((l) => ({ ...l }))
      f.drain = !!first.drain && !isFinal(first.to)
    } else if (first.to === f.to) {
      // Смена режима на том же курсе: списать разницу разгонов, лететь дальше из текущей точки.
      const p = tugPos(s)
      s.tug.fuel -= Math.abs(MODES[first.mode].acc - MODES[f.mode].acc)
      s.tug.x = p.x
      s.tug.y = p.y
      f.fx = p.x
      f.fy = p.y
      f.depart = s.t
      f.arrive = s.t + dist(p, place(f.to)) * MODES[first.mode].h
      f.mode = first.mode
      f.drain = !!first.drain && !isFinal(first.to)
      s.plan = legs.slice(1).map((l) => ({ ...l }))
    } else {
      // Смена курса в полёте: торможение старого не списывается, разгон нового — сразу.
      s.tug.x = tugPos(s).x
      s.tug.y = tugPos(s).y
      s.tug.flight = null
      s.plan = legs.slice(1).map((l) => ({ ...l }))
      startFlight(s, first, out)
    }
  } else {
    s.plan = legs.map((l) => ({ ...l }))
    if (isIdle(s) && s.plan.length) depart(s, out)
  }
  s.course = courseState(s)
  return { ok: true, notices: out }
}

/** Вылет по первой строке плана со стоянки. */
export function depart(s: GameState, out: Notice[] = []): Notice[] {
  if (!isIdle(s)) return out
  const leg = s.plan[0]
  if (!leg || (leg.to === 'pereval' && s.final.stage === 'none')) return out
  const md = MODES[leg.mode]
  if (s.tug.fuel + EPS < md.acc + md.brk) return out
  s.plan.shift()
  startFlight(s, leg, out)
  return out
}

// ——— шаг ———

interface Candidate {
  t: number
}

function nextEventTime(s: GameState): number {
  const now = s.t
  let best = Infinity
  const take = (c: number) => {
    if (c > now + 1e-6 && c < best) best = c
  }
  // Утро и вечер.
  const day = dayOf(now)
  for (const d of [day, day + 1]) {
    take(24 * (d - 1))
    take(24 * (d - 1) + 12)
  }
  // Буксир.
  if (s.tug.flight) take(s.tug.flight.arrive)
  if (s.tug.dockUntil !== null) take(s.tug.dockUntil)
  // Контрольные точки.
  for (const c of CHECKPOINTS) take(c.t)
  take(FINAL_T)
  // Квитанции.
  for (const e of s.evenings) if (!e.delivered) take(e.receipt)
  // Сеансы и тишина.
  for (const def of STATIONS) {
    const rt = s.st[def.id]
    const got = new Set(rt.got)
    for (const ss of sessionsOf(s, def.id)) {
      if (got.has(ss.id)) continue
      take(deliveryTime(s, def, ss.at))
    }
    if (!rt.rescued && rt.silentHeard === null) take(deliveryTime(s, def, airEnd(s, def.id)))
    // Строка сереет, когда «вне курса» становится «вне досягаемости».
    if (!rt.rescued && rt.silentHeard === null && rt.arrived === null && !inPlan(s, def.id) && reachable(s, def.id)) {
      take(firstAt(now, (t) => (reachable(s, def.id, t) ? -1 : 1), 600))
    }
  }
  return best
}

function deliver(s: GameState, time: number, out: Notice[]): void {
  const p = posAt(s, time)
  for (const def of STATIONS) {
    const rt = s.st[def.id]
    const got = new Set(rt.got)
    for (const ss of sessionsOf(s, def.id)) {
      if (got.has(ss.id)) continue
      if (time - ss.at + EPS >= dist(def, p)) {
        const was = signalEnd(s, def.id)
        rt.got.push(ss.id)
        rt.unread++
        rt.lastSent = Math.max(rt.lastSent ?? -Infinity, ss.at)
        if (!s.heard.includes(def.id)) s.heard.push(def.id)
        out.push({ k: 'session', st: def.id, id: ss.id })
        const now = signalEnd(s, def.id)
        const item: JournalItem = { t: time, st: def.id, id: ss.id, sent: ss.at, marks: [] }
        if (Math.abs(now - was) > EPS && rt.got.length > 1) {
          item.marks.push('air')
          item.airWas = was
          item.airNow = now
        }
        if (ss.letter) {
          s.letters.push({ station: def.id, text: ss.text, t: time })
          out.push({ k: 'letter', st: def.id })
          item.marks.push('letter')
        }
        s.journal.push(item)
      }
    }
    const end = airEnd(s, def.id)
    if (!rt.rescued && rt.silentHeard === null && time - end + EPS >= dist(def, p)) {
      rt.silentHeard = time
      out.push({ k: 'silence', st: def.id })
      s.journal.push({ t: time, st: def.id, id: null, sent: end, marks: ['silent'] })
    }
  }
}

export interface JournalView {
  /** По курсу: станции в плане или в полёте. */
  course: JournalItem[]
  others: JournalItem[]
}

/** Журнал: всё, что пришло между двумя последними остановками «Дальше». */
export function journalView(s: GameState, from = s.stopPrev, to = s.stopLast): JournalView {
  const items = s.journal.filter((x) => x.t > from + EPS && x.t <= to + EPS)
  const course = items.filter((x) => inPlan(s, x.st))
  return { course, others: items.filter((x) => !inPlan(s, x.st)) }
}

const KT_LABEL: Record<CheckpointId, string> = { kt1: 'КТ-1', kt2: 'КТ-2', ktk: 'КТ-К', kt3: 'КТ-3', kt4: 'КТ-4' }

function veraWhy(s: GameState): string {
  const passed = CHECKPOINTS.filter((c) => s.kt[c.id] !== undefined)
  const last = passed[passed.length - 1]
  if (s.vera.mode === 'route') return last ? `маршрут · ${KT_LABEL[last.id]} ${s.kt[last.id] ? 'пройдена' : 'не пройдена, ветка не менялась'}` : 'маршрут · по расписанию'
  if (s.vera.mode === 'kolybel') return 'ветка «Колыбель» · КТ-К: цель «Колыбель»'
  return 'общая · контрольная точка провалена'
}

function playMorning(s: GameState, day: number, out: Notice[]): void {
  const v = s.vera
  let file: string | null = null
  let why = veraWhy(s)
  if (v.razvorotDue) {
    file = 'razvorot'
    v.razvorotDue = false
    v.razvorotDone = true
    why = 'постоянная точка · цель «Порог»'
  } else if (v.mode === 'route') {
    file = `m${day}`
  } else if (v.mode === 'kolybel') {
    v.kolybelIdx++
    file = `k${v.kolybelIdx}`
    if (v.kolybelIdx >= 3) v.mode = 'generic'
  } else if (v.genericIdx < 6) {
    v.genericIdx++
    file = `g${v.genericIdx}`
  } else if (!v.neugadala) {
    v.neugadala = true
    file = 'neugadala'
    why = 'общие утра исчерпаны'
  }
  if (file) {
    v.plays.push({ id: file, t: s.t, delay: porogDelay(s), heard: v.channelOn, why })
    if (file === 'razvorot') v.revealed = true
  }
  out.push({ k: 'morning', file })
}

function checkpoint(s: GameState, id: CheckpointId, station: StationId): void {
  let pass: boolean
  if (id === 'ktk') {
    pass = s.tug.flight?.to === 'kolybel' || s.tug.at === 'kolybel'
  } else {
    const a = s.st[station].arrived
    pass = a !== null && a <= s.t + EPS
  }
  s.kt[id] = pass
  if (s.vera.mode !== 'route') return
  if (id === 'ktk') {
    if (pass) s.vera.mode = 'kolybel'
  } else if (!pass) {
    s.vera.mode = 'generic'
  }
}

function boardPeople(s: GameState, id: StationId): number {
  const def = STATION[id]
  const free = SEATS - s.tug.aboard.length
  const n = Math.min(def.saved, free)
  const people = PEOPLE.filter((p) => p.station === id && p.aboard !== false).slice(0, n)
  for (const p of people) s.tug.aboard.push(p.id)
  return n
}

export function savedCount(s: GameState): number {
  return s.tug.aboard.length
}

function routeHeld(s: GameState): boolean {
  return (['sinica', 'klyuch', 'smena', 'okolica'] as StationId[]).every((id) => s.st[id].rescued) && !s.st.kolybel.rescued
}

function arrive(s: GameState, out: Notice[]): void {
  const f = s.tug.flight!
  const md = MODES[f.mode]
  const to = place(f.to)
  s.tug.fuel -= md.brk
  s.tug.x = to.x
  s.tug.y = to.y
  s.tug.flight = null
  s.tug.at = f.to
  if (f.to === 'pereval') {
    s.ending = { kind: routeHeld(s) && savedCount(s) === 11 ? 'kurs' : 'svoy', t: s.t }
    out.push({ k: 'arrive', to: f.to, alive: true, boarded: 0 })
    out.push({ k: 'ending', kind: s.ending.kind })
    return
  }
  if (f.to === 'porog') {
    s.ending = { kind: 'razvorot', t: s.t }
    out.push({ k: 'arrive', to: f.to, alive: false, boarded: 0 })
    out.push({ k: 'ending', kind: 'razvorot' })
    return
  }
  const id = f.to
  const rt = s.st[id]
  rt.arrived = s.t
  s.tug.dockUntil = s.t + DOCK_H
  // Исход стыковки — от правды, а не от сигнала.
  const alive = s.t <= airEnd(s, id, s.t) + EPS && rt.silentHeard === null
  let boarded = 0
  if (alive) {
    boarded = boardPeople(s, id)
    rt.rescued = boarded > 0
    rt.boarded = boarded
    rt.unread = 0
    // После экономии людей выносят: стыковка 12 часов.
    if (boarded > 0 && ecoActive(s, id)) s.tug.dockUntil += ECO_DOCK_H
  }
  out.push({ k: 'arrive', to: id, alive, boarded })
  // Строка плана со сливом сливает при прибытии сама.
  if (f.drain) drain(s, out)
}

function checkDrift(s: GameState, out: Notice[]): void {
  if (s.ending || s.tug.flight || s.tug.dockUntil !== null) return
  if (s.tug.at === 'pereval') return
  if (s.tug.fuel + EPS < MIN_FLIGHT) {
    s.ending = { kind: 'drift', t: s.t }
    out.push({ k: 'ending', kind: 'drift' })
  }
}

/** Один шаг: до ближайшего события, но не дальше limit. */
export function step(s: GameState, limit = Infinity): Notice[] {
  const out: Notice[] = []
  if (s.eveningDue !== null) return out
  const next = Math.min(nextEventTime(s), limit)
  if (!Number.isFinite(next)) return out
  const prev = s.t
  s.t = next
  const p = posAt(s, next)
  // 3–4. Сеансы, ответы, тишина.
  deliver(s, next, out)
  // 6. Контрольные точки.
  for (const c of CHECKPOINTS) {
    if (c.t > prev + EPS && c.t <= next + EPS && s.kt[c.id] === undefined) checkpoint(s, c.id, c.station)
  }
  // 8. Прибытие и конец стыковки (до утра: стоянка видна в сводке).
  if (s.tug.flight && next + EPS >= s.tug.flight.arrive) arrive(s, out)
  else if (s.tug.flight) {
    s.tug.x = p.x
    s.tug.y = p.y
  }
  if (s.tug.dockUntil !== null && next + EPS >= s.tug.dockUntil) {
    s.tug.dockUntil = null
    const leg = s.plan[0]
    // До прощания к «Перевалу» и «Порогу» буксир сам не уходит; после него — уходит, и начинается эпилог.
    if (leg && (!isFinal(leg.to) || s.final.stage === 'cont') && !s.ending) depart(s, out)
    if (!s.tug.flight && !s.ending) out.push({ k: 'idle' })
  }
  checkDrift(s, out)
  // Квитанции «Порога».
  for (const e of s.evenings) {
    if (!e.delivered && e.receipt <= next + EPS) {
      e.delivered = true
      out.push({ k: 'receipt', day: e.day })
    }
  }
  // Состояние курса после доставки сеансов: стало хуже — уведомление для журнала и строки состояния.
  if (out.some((x) => x.k === 'session' || x.k === 'silence' || x.k === 'arrive' || x.k === 'drain')) {
    const c = courseState(s)
    if (out.some((x) => x.k === 'session' || x.k === 'silence') && courseWorse(s.course, c)) out.push({ k: 'course', state: c })
    s.course = c
  }
  // 7. Утро и вечер.
  const hourOfDay = (((next + 8) % 24) + 24) % 24
  const day = dayOf(next)
  if (Math.abs(hourOfDay - 8) < 1e-6) {
    if (Math.abs(next - FINAL_T) < 1e-6) {
      startFinal(s, out)
    } else if (day <= 20 && s.final.stage === 'none') {
      playMorning(s, day, out)
      s.board.push(...boardFor(s, day))
      if (day === 16 && s.st.sinica.rescued && s.tug.aboard.includes('zoya')) {
        s.vera.revealed = true
        out.push({ k: 'zoya' })
      }
    }
  } else if (Math.abs(hourOfDay - 20) < 1e-6 && day <= 20 && s.final.stage === 'none') {
    s.eveningDue = day
    out.push({ k: 'evening', day })
  }
  return out
}

function startFinal(s: GameState, out: Notice[]): void {
  if (s.final.stage !== 'none') return
  s.vera.farewell = s.kt.kt4 ? 'farewellA' : 'farewellB'
  s.vera.plays.push({
    id: s.vera.farewell,
    t: s.t,
    delay: porogDelay(s),
    heard: false,
    why: s.kt.kt4 ? 'прощание · КТ-4 пройдена' : 'прощание · место буксира неизвестно',
  })
  s.vera.revealed = true
  s.final.stage = 'farewell'
  out.push({ k: 'final' })
}

/** 'next' и '1h' — время второй версии; 'event', '4h', 'morning' остались для старого пульта. */
export type AdvanceMode = 'next' | '1h' | 'event' | '4h' | 'morning'

function hourOf(t: number): number {
  return (((t + 8) % 24) + 24) % 24
}

/** Ночью, с 20:00 до 08:00, новости не останавливают «Дальше». */
function isNight(t: number): boolean {
  const h = hourOf(t)
  return h >= 20 - 1e-6 || h < 8 - 1e-6
}

/** Остановки «Дальше» (механика 2.0, раздел 7) сверх тех, что нельзя пропустить. */
function isNextStop(n: Notice, s: GameState): boolean {
  switch (n.k) {
    case 'morning':
    case 'evening':
    case 'arrive':
    case 'idle':
    case 'zoya':
    case 'final':
    case 'porogTurn':
    case 'ending':
      return true
    case 'depart':
      // После прощания уход к «Перевалу» или «Порогу» начинает эпилог.
      return isFinal(n.to) && s.final.stage === 'cont'
    case 'course':
      return !isNight(s.t)
    case 'session':
    case 'silence': {
      if (isNight(s.t) || !inPlan(s, n.st)) return false
      const id = n.k === 'session' ? n.id : null
      return s.journal.some(
        (x) => x.st === n.st && x.id === id && x.t >= s.t - EPS && (x.marks.includes('air') || x.marks.includes('silent')),
      )
    }
    default:
      return false
  }
}

/** Время идёт? Нет, пока ждёт вечернее сообщение или идут экраны финала. */
export function canAdvance(s: GameState): boolean {
  if (s.eveningDue !== null) return false
  return s.final.stage === 'none' || s.final.stage === 'flight' || s.final.stage === 'cont'
}

/** Кнопки времени. Останавливаемся на экранах, которые нельзя пропустить. */
export function advance(s: GameState, mode: AdvanceMode): Notice[] {
  const all: Notice[] = []
  if (!canAdvance(s)) return all
  const start = s.t
  let limit = Infinity
  if (mode === '1h') limit = start + 1
  if (mode === '4h') limit = start + 4
  if (mode === 'morning') {
    const day = dayOf(start)
    limit = 24 * (day - 1)
    if (limit <= start + 1e-6) limit += 24
  }
  let stopped = false
  for (let guard = 0; guard < 2000; guard++) {
    const n = step(s, limit)
    all.push(...n)
    if (mode === 'next') {
      // 08:00 и 20:00 — остановки по часам и тогда, когда сводок и вечеров уже нет (после прощания).
      const h = hourOf(s.t)
      const clock = Math.abs(h - 8) < 1e-6 || Math.abs(h - 20) < 1e-6
      if (clock || n.some((x) => isNextStop(x, s))) {
        stopped = true
        break
      }
      if (s.eveningDue !== null || s.ending) break
      if (!Number.isFinite(nextEventTime(s))) break
      continue
    }
    if (mode === 'event' && n.length) break
    if (n.some((x) => isStop(x, s))) break
    if (s.t >= limit - 1e-9) break
    if (s.eveningDue !== null) break
    if (n.length === 0 && mode === 'event') break
  }
  if (mode === 'next' || stopped) {
    s.stopPrev = s.stopLast
    s.stopLast = s.t
  }
  return all
}

export type NextStop =
  | { k: 'morning'; t: number }
  | { k: 'evening'; t: number }
  | { k: 'arrive'; t: number; to: PlaceId }
  | { k: 'dockEnd'; t: number }
  /** После прощания: конец стоянки, уход к «Перевалу» или «Порогу» — начало эпилога. */
  | { k: 'departFinal'; t: number; to: PlaceId }

/** Куда приведёт «Дальше», если по пути не придёт новость. */
export function nextStop(s: GameState): NextStop {
  const now = s.t
  const day = dayOf(now)
  let morning = 24 * (day - 1)
  if (morning <= now + 1e-6) morning += 24
  let best: NextStop = { k: 'morning', t: morning }
  const evening = 24 * (day - 1) + 12
  if (evening > now + 1e-6 && evening < best.t) best = { k: 'evening', t: evening }
  const f = s.tug.flight
  if (f && f.arrive < best.t) best = { k: 'arrive', t: f.arrive, to: f.to }
  if (!f && s.tug.dockUntil !== null && s.tug.dockUntil < best.t) {
    const leg = s.plan[0]
    if (leg && isFinal(leg.to) && s.final.stage === 'cont') best = { k: 'departFinal', t: s.tug.dockUntil, to: leg.to }
    else if (!leg || isFinal(leg.to)) best = { k: 'dockEnd', t: s.tug.dockUntil }
  }
  return best
}

/** Подпись для кнопки «Дальше». */
export function nextLabel(s: GameState): string {
  const n = nextStop(s)
  switch (n.k) {
    case 'morning':
      return NEXT.morning
    case 'evening':
      return NEXT.evening
    case 'dockEnd':
      return NEXT.dockEnd
    case 'departFinal':
      return NEXT.departFinal(n.to as 'porog' | 'pereval')
    case 'arrive':
      return isFinal(n.to) ? NEXT.arriveFinal(n.to) : NEXT.arriveStation(n.to)
  }
}

/**
 * День 21: после прощания, «Эфира» и последнего сообщения рейс продолжается,
 * если в плане или в полёте ещё есть станция. Эпилог — когда буксир уходит к «Перевалу» или «Порогу».
 */
export function canContinueAfterFinal(s: GameState): boolean {
  if (s.ending) return false
  return activeLegs(s).some((l) => !isFinal(l.to))
}

export function continueAfterFinal(s: GameState): boolean {
  if (!canContinueAfterFinal(s)) return false
  s.final.stage = 'cont'
  return true
}

// ——— финал ———

const PEOPLE_BY_ID = new Map(PEOPLE.map((p) => [p.id, p]))

export function aboardPeople(s: GameState) {
  return s.tug.aboard.map((id) => PEOPLE_BY_ID.get(id)!).filter(Boolean)
}

/** Станции, у которых в момент прощания ещё есть воздух и чей голос ещё доходит. */
export function efirStations(s: GameState): StationId[] {
  return STATIONS.filter((d) => {
    const rt = s.st[d.id]
    return !rt.rescued && rt.silentHeard === null && rt.arrived === null && rt.got.length > 0 && airEnd(s, d.id) > s.t
  }).map((d) => d.id)
}

export function finalFlights(s: GameState): { to: 'pereval' | 'porog'; mode: Mode; arrive: number; fuelAfter: number }[] {
  if (s.ending) return []
  const out: { to: 'pereval' | 'porog'; mode: Mode; arrive: number; fuelAfter: number }[] = []
  for (const to of ['pereval', 'porog'] as const) {
    for (const m of MODE_IDS) {
      const r = simulatePlan(s, [{ to, mode: m }])
      const leg = r.legs[0]!
      if (leg.fuelOk) out.push({ to, mode: m, arrive: leg.arrive, fuelAfter: leg.fuelAfter })
    }
  }
  return out
}

export function sendLastWords(s: GameState, text: string | null): void {
  s.final.lastWords = text
  s.final.lastSent = s.t
  s.final.lastDelay = porogDelay(s)
}

/** Последний перелёт. Без перелёта — дрейф. */
export function finalFlight(s: GameState, to: 'pereval' | 'porog' | null, mode: Mode = 'eco'): void {
  if (s.ending) return
  if (!to) {
    s.ending = { kind: 'drift', t: s.t }
    return
  }
  const out: Notice[] = []
  if (s.tug.flight) {
    s.tug.x = tugPos(s).x
    s.tug.y = tugPos(s).y
    s.tug.flight = null
  }
  s.tug.dockUntil = null
  s.plan = []
  startFlight(s, { to, mode }, out)
}

export interface EpilogueItem {
  t: number
  kind: 'session' | 'silence' | 'arrive' | 'delivered' | 'letter'
  st?: StationId
  id?: string
}

/** Эпилог без управления: всё, что дойдёт до конца рейса. */
export function runEpilogue(s: GameState): EpilogueItem[] {
  const items: EpilogueItem[] = []
  s.final.stage = 'epilogue'
  const horizon = Math.max(s.t + 24, ...STATIONS.map((d) => airEnd(s, d.id) + 16))
  for (let guard = 0; guard < 5000; guard++) {
    if (!s.tug.flight && s.t >= horizon - 1e-6) break
    const n = step(s, s.tug.flight ? Infinity : horizon)
    s.eveningDue = null
    for (const x of n) {
      if (x.k === 'session') items.push({ t: s.t, kind: 'session', st: x.st, id: x.id })
      if (x.k === 'silence') items.push({ t: s.t, kind: 'silence', st: x.st })
      if (x.k === 'letter') items.push({ t: s.t, kind: 'letter', st: x.st })
      if (x.k === 'arrive') items.push({ t: s.t, kind: 'arrive' })
    }
  }
  if (!s.ending) s.ending = { kind: 'drift', t: s.t }
  return items
}

export function endingLines(s: GameState): { saved: number; letters: number; delayZero: boolean } {
  const kind = s.ending?.kind ?? 'drift'
  const saved = kind === 'kurs' || kind === 'svoy' ? savedCount(s) : 0
  return { saved, letters: s.letters.length, delayZero: kind === 'razvorot' }
}


export function serialize(s: GameState): string {
  return JSON.stringify(s)
}

export function deserialize(raw: string): GameState | null {
  try {
    const s = JSON.parse(raw) as GameState
    if (s.v !== SAVE_VERSION) return null
    return s
  } catch {
    return null
  }
}
