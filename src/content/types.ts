import type { StationId } from '../sim/world'

/** Сеанс по сценарию: абсолютный час отправки. */
export interface BaseLine {
  at: number
  text: string
}

/**
 * Сеанс после ответа игрока. Время отправки считается от момента, когда ответ дошёл до станции:
 * `dt` — часов после, `p` — доля оставшегося воздуха (0..1). Всё, что позже конца воздуха, не звучит.
 */
export interface BranchLine {
  dt?: number
  p?: number
  /** Абсолютный час: звучит, только если ответ дошёл раньше. */
  at?: number
  /** Не раньше этого часа. */
  minAt?: number
  text: string
  /** Письмо домой: попадает в «Почту». */
  letter?: boolean
  /** Звучит, только пока станция не под экономией: после прихода распоряжения люди эфир не занимают. */
  quiet?: boolean
}

export type ReplyKind = 'truth' | 'hold' | 'eta' | 'papa'

export interface StationScript {
  id: StationId
  /** Строка в карточке: кто это и откуда. */
  about: string
  base: BaseLine[]
  truth: BranchLine[]
  hold: BranchLine[]
  eta: BranchLine[]
  papa?: BranchLine[]
  /** Сеанс об отклонении (механика 2.0, раздел 5): голос людей, через час после того, как случилось. Под экономией вместо него строка автомата. */
  dev?: string
  /** Подтверждение распоряжения «экономия»: звучит один раз, через `dt` часов после того, как оно дошло. */
  eco: { text: string; dt?: number; /** Не звучит, если распоряжение дошло не раньше этого часа: станция уже замолчала сама. */ before?: number }
  /** Что пилот видит при стыковке, если успел. */
  rescue: string
  /** Если опоздал. */
  dead: string
}

export type VeraKind =
  | 'route'
  | 'farewellA'
  | 'farewellB'
  | 'kolybel'
  | 'razvorot'
  | 'generic'
  | 'neugadala'
  | 'take'

export interface VeraFile {
  id: string
  kind: VeraKind
  /** Для маршрутных утр — день сводки. Для веток — порядковый номер. */
  n?: number
  /** Час и минута записи от удара Шквала. */
  rec: [number, number]
  /** Подпись в архиве. */
  title: string
  text: string
  /** Для дублей: какой файл и какой по счёту. */
  takeOf?: string
  takeN?: number
}

export interface EveningOption {
  id: string
  text: string
}

export interface Person {
  id: string
  name: string
  station: StationId
  note: string
  /** false — не дожил до буксира, хотя был в сигнале. */
  aboard?: boolean
}
