// Вечерние сообщения Вере, 20:00. Среди них бывают прямые вопросы: Вера ни на один не ответит.
// Все выбранные реплики в конце прозвучат по громкой связи в пустом модуле.
//
// Реплики пилота не врут о его положении: каждая показывается, только если правдива по тому,
// что знает пилот, — кто на борту, куда летит буксир, чья тишина уже дошла, какое утро прозвучало.
// Вера может ошибаться (она считала один курс), пилот — нет. Условия берут только знание пилота,
// никогда не правду мира (`airEnd`): иначе реплика выдала бы то, чего на экране нет.

import { activeLegs, type GameState, receivedSessions, simulatePlan, stationView, tugPos } from '../sim/engine'
import { dayOf, dist, isFinal, STATION, type StationId, VERA_COURSE } from '../sim/world'

export type EveningWhen = (s: GameState, day: number) => boolean

export interface EveningLine {
  id: string
  text: string
  /** Когда реплика правдива. Без условия — всегда. */
  when?: EveningWhen
}

// ——— что знает пилот ———

/** Люди станции на борту. */
const aboard = (id: StationId) => (s: GameState) => s.st[id].rescued
/** Человек на борту. */
const person = (pid: string) => (s: GameState) => s.tug.aboard.includes(pid)
/** Буксир летит к станции или она ещё впереди в курсе. Уже поднятые — не «лечу». */
function heading(s: GameState, id: StationId): boolean {
  if (s.st[id].rescued || s.st[id].arrived !== null) return false
  return activeLegs(s).some((l) => l.to === id)
}
/** Тишина станции дошла до буксира. */
const silent = (id: StationId) => (s: GameState) => !s.st[id].rescued && s.st[id].silentHeard !== null && s.st[id].silentHeard! <= s.t + 1e-6
/** Буксир в полёте к станции и тормозит у неё завтра. */
function tomorrow(s: GameState, id: StationId, day: number): boolean {
  const f = s.tug.flight
  return !!f && f.to === id && dayOf(f.arrive) === day + 1
}
/** Утро прозвучало на включённом канале. */
const played = (file: string) => (s: GameState) => s.vera.plays.some((p) => p.id === file && p.heard)
/** Сегодня утром Вера что-то сказала, и пилот это слышал. */
const morningToday = (s: GameState, day: number) => s.vera.plays.some((p) => p.heard && dayOf(p.t) === day)
/** Пилот слышал от станции фразу. */
const heardSaid = (id: StationId, part: string) => (s: GameState) => receivedSessions(s, id).some((x) => x.text.includes(part))
/** Курс пилота — тот, что загрузила Вера: те же станции, в том же порядке и тем же режимом. */
function veraCourse(s: GameState): boolean {
  const left = VERA_COURSE.filter((l) => isFinal(l.to) || s.st[l.to].arrived === null)
  const mine = activeLegs(s)
  if (s.vera.mode !== 'route') return false
  // Режимы тоже: курс Веры, пройденный форсажем, — уже не её расход.
  return left.length === mine.length && left.every((l, i) => mine[i]!.to === l.to && mine[i]!.mode === l.mode)
}
/** Опоздание к станции по плану — то, что пилот видит в планировщике. */
function lateTo(s: GameState, id: StationId): boolean {
  const v = stationView(s, id)
  return v.status === 'course' && v.margin !== null && v.margin < 0
}
const projected = (s: GameState) => simulatePlan(s, activeLegs(s)).saved
const anyAboard = (s: GameState) => s.tug.aboard.length > 0
const flying = (s: GameState) => !!s.tug.flight
const not = (f: EveningWhen): EveningWhen => (s, d) => !f(s, d)
const all = (...fs: EveningWhen[]): EveningWhen => (s, d) => fs.every((f) => f(s, d))
const revealed: EveningWhen = (s) => s.vera.revealed
const hidden: EveningWhen = (s) => !s.vera.revealed
const toKolybel: EveningWhen = (s) => heading(s, 'kolybel')
const kolybelAboard = aboard('kolybel')
const kolybelFar: EveningWhen = (s) => !heading(s, 'kolybel') && !s.st.kolybel.rescued

export const EVENINGS: Record<number, EveningLine[]> = {
  1: [
    { id: 'e1a', text: '«Порог», я «Тихоход». Курс принял. Пересчитал трижды. Ты права, как всегда.', when: veraCourse },
    { id: 'e1d', text: '«Порог», я «Тихоход». Курс поменял. Пересчитал трижды. Не ругайся.', when: not(veraCourse) },
    { id: 'e1b', text: 'Вера, «Полынья» звала весь день. Я не ответил. Скажи, что так правильно.', when: (s) => !heading(s, 'polynya') && !s.st.polynya.reply },
    { id: 'e1c', text: 'Нормально. Лечу. Как антенна?' },
  ],
  2: [
    { id: 'e2a', text: 'Спал четыре часа. Остальное — у приёмника. Не ругайся.' },
    { id: 'e2b', text: 'Ты сама ела? Только не отвечай «потом».' },
    { id: 'e2c', text: '«Полынья» перестала кричать. Теперь просто говорит. Это хуже.', when: not(silent('polynya')) },
  ],
  3: [
    { id: 'e3a', text: '«Полынья» замолчала. Я слышал. Ты знала, что так будет, да?', when: silent('polynya') },
    { id: 'e3b', text: 'В окне сегодня хвост Шквала. Красиво. Очень красиво, Вера. Мне от этого плохо.' },
    { id: 'e3c', text: 'Всё по графику. Расход как ты считала.', when: veraCourse },
    { id: 'e3d', text: 'Расход не как ты считала. Я знаю. Я так решил.', when: not(veraCourse) },
  ],
  4: [
    { id: 'e4a', text: 'Завтра «Синица». Автомат говорит «шесть». Я готовлю шесть мест.', when: (s, d) => tomorrow(s, 'sinica', d) },
    { id: 'e4b', text: 'Вера, почему «Синица» не выходит голосом? Ты что-то знаешь?', when: not(aboard('sinica')) },
    { id: 'e4c', text: 'Нормально.' },
    { id: 'e4d', text: 'Считал сегодня места. Двенадцать. Каждый раз двенадцать.' },
  ],
  5: [
    { id: 'e5a', text: 'Их было шестеро. Трое вышли в шлюз. Ты назвала «одиннадцать» в первое утро. Ты знала?', when: aboard('sinica') },
    { id: 'e5b', text: 'Подняли троих. Зоя без сознания. Нина держится. Костя носит записку в кармане.', when: all(person('zoya'), person('nina'), person('kostya')) },
    { id: 'e5d', text: 'Я не на «Синице». Автомат там всё говорит «шесть». Я слушаю.', when: not(aboard('sinica')) },
    { id: 'e5c', text: '«Порог», я «Тихоход». …Приём.' },
  ],
  6: [
    { id: 'e6a', text: 'Я на тебя не злюсь. Я злюсь на арифметику.' },
    { id: 'e6b', text: 'Перечитал записку Лунёва. Он считал как ты. Где вас таких учат?', when: person('kostya') },
    { id: 'e6c', text: 'Зоя открыла глаза. Смотрит в потолок. Не говорит.', when: person('zoya') },
    { id: 'e6d', text: 'Сплю по восемь часов, как ты велела. Не получается.' },
  ],
  7: [
    { id: 'e7a', text: 'Ладно. Не отвечай. Я всё равно буду спрашивать.' },
    { id: 'e7b', text: '«Заря» замолчала. Они пели. Я слышал. Ты была права, я бы не успел.', when: silent('zarya') },
    { id: 'e7d', text: 'Семеро с «Зари» на борту. Вечером поют. Я не мешаю.', when: aboard('zarya') },
    { id: 'e7c', text: 'Вера, у тебя на фоне тон. Это аварийный? Что у вас на самом деле случилось?' },
  ],
  8: [
    { id: 'e8a', text: 'Савелий с «Маяка» записывает всех, кто замолчал. Я тоже начал.' },
    { id: 'e8b', text: 'Расскажи, какой у тебя вид из окна. Шесть лет хотел спросить.' },
    { id: 'e8c', text: 'Расход в норме. Ты знаешь его лучше меня.', when: (s) => s.course.k !== 'fuel' },
    { id: 'e8d', text: 'Вера, «Артель» не замолчала. Ты сказала: в двенадцать тридцать шесть. Они говорят.', when: all(played('m8'), heardSaid('artel', 'регенеративных патронов'), not(silent('artel')), not(aboard('artel'))) },
  ],
  9: [
    { id: 'e9a', text: 'Ты смеялась. Я записал время в журнал. Как Савелий.', when: played('m9') },
    { id: 'e9b', text: 'Карие. Глаза, говорю, карие. Ты за шесть лет так и не спросила, так что говорю сам.' },
    { id: 'e9c', text: 'Я пел тогда не сорок минут, а двадцать. Остальное — помехи. Не верь им.', when: played('m9') },
    { id: 'e9d', text: 'Сегодня час не считал. Потом опять считал.', when: not(played('m9')) },
  ],
  10: [
    { id: 'e10a', text: '«Тёплый Ключ» на борту. Олег привёз часы с боем, бьют каждый час. Тебе бы понравилось.', when: aboard('klyuch') },
    { id: 'e10d', text: 'Вера, я всё смотрю на часы. От этого ничего не меняется.', when: not(aboard('klyuch')) },
    { id: 'e10b', text: 'Пятеро на борту, семь мест пустых. Я смотрю на пустые. Ты говорила не смотреть.', when: (s) => s.tug.aboard.length === 5 },
    { id: 'e10c', text: 'Вера, «Колыбель» рядом. Тася читает цифры каждые четыре часа. Что скажешь?', when: all(not(kolybelAboard), not(silent('kolybel')), (s) => dist(tugPos(s), STATION.kolybel) <= 3) },
    { id: 'e10f', text: 'Десятые сутки. Половина. Я тоже считаю.' },
    { id: 'e10e', text: 'Тася на борту. Читает мне приборы. Каждые четыре часа, по привычке.', when: kolybelAboard },
  ],
  11: [
    { id: 'e11a', text: 'Спасибо за утро. Не знаю почему, но спасибо.', when: morningToday },
    { id: 'e11b', text: 'Ты сегодня говорила о другом. Ты так делаешь, когда что-то не так.', when: played('m11') },
    { id: 'e11c', text: 'Тася сегодня спросила, большой ли у нас буксир. Я не ответил.', when: all(kolybelFar, heardSaid('kolybel', 'буксир большой'), (s) => !s.st.kolybel.reply) },
    { id: 'e11d', text: 'Я лечу к «Колыбели». Ты, наверно, уже знаешь.', when: toKolybel },
    { id: 'e11e', text: 'Тася спит на моей койке. Я в кресле. Мне так лучше.', when: kolybelAboard },
    { id: 'e11f', text: 'Ем горячее. Почти.' },
  ],
  12: [
    { id: 'e12a', text: 'Ты дождалась, пока решит физика. Я понимаю зачем. Больше так не делай.', when: all(played('m12'), kolybelFar) },
    { id: 'e12b', text: 'Я слушаю Тасю. Каждые четыре часа. До конца.', when: all(kolybelFar, not(silent('kolybel'))) },
    { id: 'e12c', text: 'Лечу к «Колыбели». Знаю, что опоздаю. Всё равно лечу.', when: all(toKolybel, (s) => lateTo(s, 'kolybel')) },
    { id: 'e12f', text: 'Лечу к «Колыбели». Успеваю. Пересчитал трижды.', when: all(toKolybel, (s) => !lateTo(s, 'kolybel')) },
    { id: 'e12d', text: 'Восемь вместо одиннадцати. Я посчитал. Я всё равно лечу.', when: all(toKolybel, (s) => projected(s) === 8) },
    { id: 'e12g', text: 'Сомовы на борту. Андрей не отходит от Лиды. Тася — от приборов.', when: kolybelAboard },
    { id: 'e12e', text: 'Матрёшка замолчала утром. Я не заметил. Ты была права.', when: all(silent('matryoshka'), played('m12')) },
    { id: 'e12h', text: 'Сегодня ел горячее. Не спрашивай что.' },
  ],
  13: [
    { id: 'e13a', text: 'Да. Дослушал.', when: played('m13') },
    { id: 'e13b', text: 'Как ты угадала?', when: morningToday },
    { id: 'e13c', text: 'Ты не угадала. Я лечу.', when: all(toKolybel, played('m13')) },
    { id: 'e13d', text: 'Тася отдала мне тетрадку с показаниями. Я её не открываю. Пусть лежит.', when: kolybelAboard },
    { id: 'e13e', text: 'Сегодня тихо. Считаю, кто ещё говорит.' },
    { id: 'e13f', text: 'Пересчитал бак. Ты бы сказала: не трогай. Не трогаю.' },
  ],
  14: [
    { id: 'e14a', text: 'Тася выключилась. «Мы ждём». Я записал в журнал.', when: all(kolybelFar, heardSaid('kolybel', 'Я выключаюсь')) },
    { id: 'e14b', text: 'Вера, я устал. Это можно говорить диспетчеру?' },
    { id: 'e14c', text: 'Завтра «Вторая смена». Четверо. Готовлю места.', when: all((s, d) => tomorrow(s, 'smena', d), not(silent('smena'))) },
    { id: 'e14d', text: 'Тася знает, что я лечу. Отец ей сказал. Она читает громче.', when: toKolybel },
    { id: 'e14e', text: 'Тася спит. Лида не спит, ей больно. Сижу с ней.', when: person('lida') },
    { id: 'e14f', text: 'Сегодня никуда не смотрел. Только на приборы.' },
  ],
  15: [
    { id: 'e15a', text: 'Девять на борту. Федя стоял у двери в забой. Я не торопил.', when: all(person('fedya'), (s) => s.tug.aboard.length === 9) },
    { id: 'e15d', text: 'Четверо со «Второй смены» на борту. Федя стоял у двери в забой. Я не торопил.', when: all(person('fedya'), (s) => s.tug.aboard.length !== 9) },
    { id: 'e15b', text: 'Расскажи мне про «Перевал». Что там, кроме транспорта?' },
    { id: 'e15c', text: 'Ахмед молится за меня. Я не против.', when: person('ahmed') },
    { id: 'e15f', text: 'В окне опять Шквал. Уже не красиво. Просто есть.' },
    { id: 'e15e', text: 'Пассажиры спрашивают, сколько ещё. Я говорю число. Они его повторяют.', when: all(anyAboard, not(person('ahmed'))) },
  ],
  16: [
    { id: 'e16a', text: 'Вера. Я знаю.', when: revealed },
    { id: 'e16b', text: 'Я посмотрел заголовки. Тридцать один час. Ты всё посчитала за тридцать один час.', when: revealed },
    { id: 'e16c', text: '«Порог», я «Тихоход». Приём. Приём. Приём.', when: revealed },
    { id: 'e16d', text: '«Колыбель» замолчала. Я слышал.', when: all(hidden, silent('kolybel')) },
    { id: 'e16e', text: 'Нормально. Номер семь.', when: hidden },
    { id: 'e16f', text: 'Сплю мало. Ты и так знаешь.', when: hidden },
  ],
  17: [
    { id: 'e17a', text: 'Доброе утро, Вера. Я тоже желаю тебе доброго утра. Вечером, да. Неважно.', when: revealed },
    { id: 'e17b', text: 'Я выключал канал. Прости. Я не мог. Я включу.', when: (s) => s.vera.revealed && !s.vera.channelOn },
    { id: 'e17c', text: 'Зоя спрашивает, можно ли ей тоже тебе что-нибудь сказать. Можно. Она сейчас скажет.', when: all(revealed, person('zoya')) },
    { id: 'e17g', text: 'Я слушаю дальше. Каждое утро. Ты записала — я слушаю.', when: (s) => s.vera.revealed && s.vera.channelOn },
    { id: 'e17d', text: 'Нормально. Лечу.', when: all(hidden, flying) },
    { id: 'e17f', text: 'Нормально. Стою. Жду.', when: all(hidden, not(flying)) },
    { id: 'e17h', text: 'Нормально. Номер восемь. Не спрашивай, какой это.', when: hidden },
    { id: 'e17e', text: 'Пассажиры спрашивают про тебя. Я говорю: хороший диспетчер.', when: all(hidden, anyAboard) },
  ],
  18: [
    { id: 'e18a', text: 'Я перебью. Обещаю. Я прилечу и перебью.', when: played('m18') },
    { id: 'e18b', text: 'Двадцать три дня. Я тоже считал.', when: played('m18') },
    { id: 'e18c', text: 'Пассажиры спят. В рубке только я и твой голос.', when: all(anyAboard, (s) => s.vera.channelOn) },
    { id: 'e18d', text: 'Пересчитал бак. Потом ещё раз. Цифра та же.' },
    { id: 'e18e', text: 'Ты бы сейчас сказала: ешь горячее. Ем.' },
  ],
  19: [
    { id: 'e19a', text: 'Савелий звал сегодня три раза. Я не ответил. Не знаю, что ему сказать.', when: (s) => !heading(s, 'mayak') && !s.st.mayak.rescued && !s.st.mayak.reply },
    { id: 'e19d', text: 'Лечу к Савелию. Он ещё не знает. Пусть пишет журнал.', when: (s) => heading(s, 'mayak') },
    { id: 'e19b', text: 'Скажи, что ты подумала, когда я первый раз вышел на твою частоту.' },
    { id: 'e19c', text: 'Знаешь, я теперь тоже угадываю. Ты сейчас скажешь: «Спи, Тихоход».' },
  ],
  20: [
    { id: 'e20a', text: '«Околица». Двое. Одиннадцать. Ты посчитала всех.', when: (s) => s.st.okolica.rescued && s.tug.aboard.length === 11 },
    { id: 'e20d', text: 'Пересчитал людей на борту. Потом места. Пустые тоже посчитал.', when: (s) => !(s.st.okolica.rescued && s.tug.aboard.length === 11) },
    { id: 'e20b', text: 'Завтра длинная запись. Я дослушаю. Обещаю.', when: played('m20') },
    { id: 'e20c', text: 'Вера. Спасибо за курс.', when: veraCourse },
    { id: 'e20e', text: 'Завтра двадцать первое. Я не сплю.' },
  ],
}

export function eveningOptions(s: GameState, day: number): EveningLine[] {
  return (EVENINGS[day] ?? []).filter((o) => !o.when || o.when(s, day)).slice(0, 4)
}

export function eveningText(id: string | null): string | null {
  if (!id) return null
  for (const day of Object.values(EVENINGS)) {
    const o = day.find((x) => x.id === id)
    if (o) return o.text
  }
  return null
}

/** Последнее сообщение, 21-й день. */
export const LAST_WORDS: EveningLine[] = [
  { id: 'l1', text: 'Перебиваю.' },
  {
    id: 'l2',
    text: 'Вера. Я слышал все двадцать одно утро. Все до одного.',
    // Правда, только если канал ни разу не молчал на утре.
    when: (s) => s.vera.plays.length > 0 && s.vera.plays.every((p) => p.heard || p.id === s.vera.farewell),
  },
  { id: 'l3', text: 'Карие. На всякий случай. Вдруг ты тогда не расслышала.', when: (s) => s.evenings.some((e) => e.choice === 'e9b') },
  { id: 'l5', text: 'Вера. Я слышал твои утра. Не все. Но слышал.', when: (s) => !s.vera.plays.every((p) => p.heard || p.id === s.vera.farewell) },
  { id: 'l4', text: 'Ты не угадала только одно. Я бы развернулся. Я бы прилетел.' },
]

export function lastWordsOptions(s: GameState): EveningLine[] {
  return LAST_WORDS.filter((o) => !o.when || o.when(s, 21))
}
