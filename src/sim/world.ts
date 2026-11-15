// Неизменные числа мира. Источник — zaderzhka-mehanika.md, разделы 2–6, и zaderzhka-mehanika-2.md, разделы 4–5.
// Числа второй версии сверяет tools/balance-v2.mjs.

export type Mode = 'eco' | 'cruise' | 'burn'

export interface ModeDef {
  id: Mode
  name: string
  short: string
  /** Часов на 1 св. ч пути. */
  h: number
  acc: number
  brk: number
}

export const MODES: Record<Mode, ModeDef> = {
  eco: { id: 'eco', name: 'экономный', short: 'эконом', h: 92, acc: 6, brk: 6 },
  cruise: { id: 'cruise', name: 'крейсерский', short: 'крейсер', h: 69, acc: 11, brk: 11 },
  burn: { id: 'burn', name: 'форсаж', short: 'форсаж', h: 52, acc: 16, brk: 16 },
}
export const MODE_IDS: Mode[] = ['eco', 'cruise', 'burn']

export const TANK = 100
export const SEATS = 12
export const DOCK_H = 6
/** Стоимость экономного перелёта: столько нужно, чтобы вообще куда-то лететь. */
export const MIN_FLIGHT = MODES.eco.acc + MODES.eco.brk
/** Утро 21-го дня: прощание. */
export const FINAL_T = 480
export const TOTAL_PEOPLE = 61

export type StationId =
  | 'sinica'
  | 'klyuch'
  | 'smena'
  | 'okolica'
  | 'kolybel'
  | 'zarya'
  | 'mayak'
  | 'polynya'
  | 'vetra'
  | 'kovsh'
  | 'artel'
  | 'matryoshka'
  | 'yar'
  | 'kordon'

export type FinalId = 'porog' | 'pereval'
export type PlaceId = StationId | FinalId

export interface Point {
  x: number
  y: number
}

export interface StationDef extends Point {
  id: StationId
  name: string
  /** Людей по сигналу. */
  people: number
  /** Сколько поднимется на борт, если успеть. */
  saved: number
  /** Час, когда кончается воздух, по расчёту Веры (данные 31-го часа). Правда — `airEnd` в движке. */
  T: number
  /** Топливо, которое можно слить на станции (механика 2.0, раздел 5). */
  stock: number
}

/** Слив топлива: на столько часов дольше стоянка (механика 2.0, раздел 4). */
export const DRAIN_H = 18
/** Распоряжение «экономия»: столько часов воздуха прибавляется станции. */
export const ECO_AIR_H = 8
/** И на столько дольше стыковка: людей выносят. */
export const ECO_DOCK_H = 6

export interface Deviation {
  station: StationId
  /** Когда случилось. */
  t: number
  /** Сдвиг конца воздуха, часов. */
  dh: number
}

/** t от первой сводки: сводка дня N в 08:00 — это 24 × (N − 1). */
export function at(day: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return 24 * (day - 1) + ((h ?? 0) - 8) + (m ?? 0) / 60
}

export function dayOf(t: number): number {
  return Math.floor((t + 8) / 24) + 1
}

export function clockOf(t: number): { day: number; h: number; m: number } {
  const total = Math.round((t + 8) * 60)
  const day = Math.floor(total / 1440) + 1
  const rest = total - (day - 1) * 1440
  return { day, h: Math.floor(rest / 60), m: rest % 60 }
}

/** Порядок строк не меняется всю игру: так игрок запоминает, где кто был. */
export const STATIONS: StationDef[] = [
  { id: 'sinica', name: 'Синица', people: 6, saved: 3, x: 1.3, y: 0.6, T: at(5, '20:00'), stock: 4 },
  { id: 'klyuch', name: 'Тёплый Ключ', people: 2, saved: 2, x: 2.6, y: -0.4, T: at(10, '20:00'), stock: 10 },
  { id: 'smena', name: 'Вторая смена', people: 4, saved: 4, x: 4.1, y: 0.5, T: at(16, '04:00'), stock: 12 },
  { id: 'okolica', name: 'Околица', people: 2, saved: 2, x: 5.0, y: -0.9, T: at(21, '02:00'), stock: 10 },
  { id: 'kolybel', name: 'Колыбель', people: 3, saved: 3, x: 3.6, y: 1.9, T: at(16, '10:18'), stock: 0 },
  { id: 'zarya', name: 'Заря', people: 7, saved: 7, x: -2.2, y: -1.6, T: at(7, '14:00'), stock: 6 },
  { id: 'mayak', name: 'Маяк-3', people: 1, saved: 1, x: 6.4, y: -2.2, T: at(24, '16:00'), stock: 6 },
  { id: 'polynya', name: 'Полынья', people: 4, saved: 4, x: -0.6, y: 0.9, T: at(3, '04:00'), stock: 14 },
  { id: 'vetra', name: 'Семь Ветров', people: 4, saved: 4, x: -1.5, y: 2.4, T: at(5, '08:00'), stock: 4 },
  { id: 'kovsh', name: 'Ковш', people: 5, saved: 5, x: 1.9, y: 2.6, T: at(7, '04:00'), stock: 24 },
  { id: 'artel', name: 'Артель Громова', people: 6, saved: 6, x: 2.2, y: -2.6, T: at(8, '10:00'), stock: 12 },
  { id: 'matryoshka', name: 'Матрёшка', people: 6, saved: 6, x: 4.8, y: -3.4, T: at(12, '04:00'), stock: 6 },
  { id: 'yar', name: 'Белый Яр', people: 9, saved: 9, x: 6.5, y: 4.0, T: at(13, '20:00'), stock: 16 },
  { id: 'kordon', name: 'Дальний Кордон', people: 2, saved: 2, x: 10.4, y: -1.6, T: at(23, '20:00'), stock: 8 },
]

export const STATION: Record<StationId, StationDef> = Object.fromEntries(STATIONS.map((s) => [s.id, s])) as Record<
  StationId,
  StationDef
>

export const FINALS: Record<FinalId, Point & { id: FinalId; name: string }> = {
  porog: { id: 'porog', name: 'Порог', x: 8.6, y: 2.7 },
  pereval: { id: 'pereval', name: 'Перевал', x: 3.4, y: -3.6 },
}

export function isFinal(p: PlaceId): p is FinalId {
  return p === 'porog' || p === 'pereval'
}

export function place(p: PlaceId): Point {
  return isFinal(p) ? FINALS[p] : STATION[p]
}

export function placeName(p: PlaceId): string {
  return isFinal(p) ? FINALS[p].name : STATION[p].name
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export interface Leg {
  to: PlaceId
  mode: Mode
  /** Слить топливо станции при прибытии (механика 2.0, раздел 4). */
  drain?: boolean
}

/** Отклонения мира от расчёта Веры (механика 2.0, раздел 5). */
export const DEVIATIONS: Deviation[] = [
  { station: 'artel', t: at(5, '21:00'), dh: 144 },
  { station: 'klyuch', t: at(6, '21:00'), dh: -22 },
  { station: 'okolica', t: at(14, '21:00'), dh: -30 },
  { station: 'mayak', t: at(16, '12:00'), dh: -24 },
  // Механика 3, раздел 4: решение в дни 13–15, пока буксир идёт ко «Второй смене».
  { station: 'smena', t: at(12, '21:00'), dh: -12 },
]

/** Курс диспетчера: загружен в планировщик в первое утро. */
export const VERA_COURSE: Leg[] = [
  { to: 'sinica', mode: 'cruise' },
  { to: 'klyuch', mode: 'cruise' },
  { to: 'smena', mode: 'cruise' },
  { to: 'okolica', mode: 'cruise' },
  { to: 'pereval', mode: 'eco' },
]

/** Контрольные точки ретранслятора (раздел 8). */
export const CHECKPOINTS = [
  { id: 'kt1', t: at(5, '20:00'), station: 'sinica' as StationId },
  { id: 'kt2', t: at(10, '20:00'), station: 'klyuch' as StationId },
  { id: 'ktk', t: at(11, '11:30'), station: 'kolybel' as StationId },
  { id: 'kt3', t: at(16, '04:00'), station: 'smena' as StationId },
  { id: 'kt4', t: at(21, '02:00'), station: 'okolica' as StationId },
] as const
export type CheckpointId = (typeof CHECKPOINTS)[number]['id']
