// Проверка баланса механики 2.0 полным перебором.
// Запуск: node tools/balance-v2.mjs
// Числа и правила — из zaderzhka-mehanika-2.md. Поменял число в документе — поменяй здесь и прогони.
// Скрипт ничего не знает о движке игры: это независимая проверка таблиц документа.
// Код выхода 1, если хоть одно утверждение не сошлось.

export const MODES = {
  eco: { h: 92, acc: 6, brk: 6 },
  cruise: { h: 69, acc: 11, brk: 11 },
  burn: { h: 52, acc: 16, brk: 16 },
}
const MODE_IDS = ['eco', 'cruise', 'burn']
const MODE_RU = { eco: 'эконом', cruise: 'крейсер', burn: 'форсаж' }

/** t от первой сводки: сводка дня N в 08:00 — это 24 × (N − 1). */
export const at = (day, h, m = 0) => 24 * (day - 1) + (h - 8) + m / 60
export const fmt = (t) => {
  const total = Math.round((t + 8) * 60)
  const day = Math.floor(total / 1440) + 1
  const rest = total - (day - 1) * 1440
  return `д${day} ${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`
}

// T — конец воздуха по расчёту Веры (данные 31-го часа). Правда = T + dev.
// stock — топливо, которое можно слить на станции.
export const STATIONS = [
  { id: 'sinica', name: 'Синица', saved: 3, x: 1.3, y: 0.6, T: at(5, 20), stock: 4 },
  { id: 'klyuch', name: 'Тёплый Ключ', saved: 2, x: 2.6, y: -0.4, T: at(10, 20), stock: 10 },
  { id: 'smena', name: 'Вторая смена', saved: 4, x: 4.1, y: 0.5, T: at(16, 4), stock: 12 },
  { id: 'okolica', name: 'Околица', saved: 2, x: 5.0, y: -0.9, T: at(21, 2), stock: 10 },
  { id: 'kolybel', name: 'Колыбель', saved: 3, x: 3.6, y: 1.9, T: at(16, 10, 18), stock: 0 },
  { id: 'zarya', name: 'Заря', saved: 7, x: -2.2, y: -1.6, T: at(7, 14), stock: 6 },
  { id: 'mayak', name: 'Маяк-3', saved: 1, x: 6.4, y: -2.2, T: at(24, 16), stock: 6 },
  { id: 'polynya', name: 'Полынья', saved: 4, x: -0.6, y: 0.9, T: at(3, 4), stock: 14 },
  { id: 'vetra', name: 'Семь Ветров', saved: 4, x: -1.5, y: 2.4, T: at(5, 8), stock: 4 },
  { id: 'kovsh', name: 'Ковш', saved: 5, x: 1.9, y: 2.6, T: at(7, 4), stock: 24 },
  { id: 'artel', name: 'Артель Громова', saved: 6, x: 2.2, y: -2.6, T: at(8, 10), stock: 12 },
  { id: 'matryoshka', name: 'Матрёшка', saved: 6, x: 4.8, y: -3.4, T: at(12, 4), stock: 6 },
  { id: 'yar', name: 'Белый Яр', saved: 9, x: 6.5, y: 4.0, T: at(13, 20), stock: 16 },
  { id: 'kordon', name: 'Дальний Кордон', saved: 2, x: 10.4, y: -1.6, T: at(23, 20), stock: 8 },
]
export const ST = Object.fromEntries(STATIONS.map((s) => [s.id, s]))
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** Параметры механики 2.0. */
export const PARAMS = {
  tank: 100,
  seats: 12,
  dockH: 6,
  /** Слив топлива: на столько дольше стоянка. */
  drainH: 18,
  /** Распоряжение «экономия»: столько часов воздуха прибавляется станции. */
  eco: 8,
  /** И на столько дольше стыковка: людей выносят. */
  ecoDockH: 6,
  minFlight: 12,
  /** Отклонения мира от расчёта Веры, часов. */
  dev: { klyuch: -22, okolica: -30 },
  /** Когда новость об отклонении уже лежит в журнале пилота. */
  news: { klyuch: at(7, 8), okolica: at(15, 8) },
  stock: Object.fromEntries(STATIONS.map((s) => [s.id, s.stock])),
}

export function trueT(P, id, eco) {
  return ST[id].T + (P.dev[id] ?? 0) + (eco ? P.eco : 0)
}

/**
 * Лучший исход из состояния при полном знании мира.
 * state: { pos, t, fuel, aboard, visited: [], flight: {to, mode} | null, eco: {id: true}, canEco: bool }
 * Если flight задан, разгон уже списан; pos — текущая точка в полёте.
 * opts: must — станции, которые обязаны быть спасены; forbid — куда не летим;
 *       seed + strict — искать только строго лучше seed; maxDepots — заходов только ради топлива.
 */
export function solve(P, state, opts = {}) {
  let best = opts.seed ?? -1
  let routes = []
  const need = opts.must ?? null
  const forbid = new Set(opts.forbid ?? [])
  const cap = opts.keep ?? 4
  const strict = !!opts.strict
  const maxDepots = opts.maxDepots ?? 2

  // Экономия: уже отдана (обязательна), можно отдать сейчас (по выбору) или поздно.
  const ecoState = (id) => {
    if (state.eco?.[id]) return 'on'
    if (state.canEco === false) return 'off'
    return state.t + dist(state.pos, ST[id]) < trueT(P, id, false) ? 'can' : 'off'
  }

  const potential = (t, pos, visited, aboard) => {
    let p = 0
    for (const s of STATIONS) {
      if (visited.has(s.id) || forbid.has(s.id)) continue
      if (t + dist(pos, s) * MODES.burn.h <= trueT(P, s.id, ecoState(s.id) !== 'off')) p += s.saved
    }
    return Math.min(P.seats, aboard + p)
  }

  const record = (aboard, route, fuel) => {
    if (need && !need.every((id) => route.some((r) => r.to === id && r.n > 0))) return
    if (aboard > best) {
      best = aboard
      routes = []
    }
    if (aboard === best && routes.length < cap) routes.push({ route: route.slice(), fuel })
  }

  const visit = (s, arr, fuel, aboard, visited, route, mode) => {
    const es = ecoState(s.id)
    const stock = P.stock[s.id] ?? 0
    const depots = route.reduce((k, r) => k + (r.n === 0 ? 1 : 0), 0)
    const v2 = new Set(visited)
    v2.add(s.id)
    for (const eco of es === 'on' ? [true] : es === 'can' ? [false, true] : [false]) {
      const T = trueT(P, s.id, eco)
      const n = arr <= T + 1e-9 ? Math.min(s.saved, P.seats - aboard) : 0
      if (eco && es === 'can' && n === 0) continue
      const dock = P.dockH + (eco && n > 0 ? P.ecoDockH : 0)
      const base = { to: s.id, mode, arr, margin: T - arr, n, eco }
      if (n > 0) {
        route.push({ ...base, drain: false })
        dfs(s, arr + dock, fuel, aboard + n, v2, route)
        route.pop()
      }
      if (stock > 0 && (n > 0 || depots < maxDepots)) {
        route.push({ ...base, drain: true })
        dfs(s, arr + dock + P.drainH, Math.min(P.tank, fuel + stock), aboard + n, v2, route)
        route.pop()
      }
    }
  }

  function dfs(pos, t, fuel, aboard, visited, route) {
    if (fuel + 1e-9 >= P.minFlight) record(aboard, route, fuel)
    if (need) {
      // Обязательная станция уже недостижима — ветка пустая.
      for (const id of need) {
        if (route.some((r) => r.to === id && r.n > 0)) continue
        if (visited.has(id)) return
        if (t + dist(pos, ST[id]) * MODES.burn.h > trueT(P, id, ecoState(id) !== 'off')) return
      }
    }
    const pot = potential(t, pos, visited, aboard)
    if (pot < best || ((strict || routes.length >= cap) && pot <= best)) return
    for (const s of STATIONS) {
      if (visited.has(s.id) || forbid.has(s.id)) continue
      const d = dist(pos, s)
      for (const m of MODE_IDS) {
        const md = MODES[m]
        if (fuel + 1e-9 < md.acc + md.brk) continue
        visit(s, t + d * md.h, fuel - md.acc - md.brk, aboard, visited, route, m)
      }
    }
  }

  const visited = new Set(state.visited ?? [])
  if (state.flight) {
    // В полёте: продолжить, сменить режим на том же курсе (доплата разницы), сменить цель (новый разгон).
    const cur = MODES[state.flight.mode]
    for (const s of STATIONS) {
      if (visited.has(s.id) || forbid.has(s.id)) continue
      const d = dist(state.pos, s)
      for (const m of MODE_IDS) {
        const md = MODES[m]
        const extra = s.id === state.flight.to ? Math.abs(md.acc - cur.acc) : md.acc
        if (state.fuel + 1e-9 < extra + md.brk) continue
        visit(s, state.t + d * md.h, state.fuel - extra - md.brk, state.aboard, visited, [], m)
      }
    }
    // Уйти к «Перевалу» прямо сейчас.
    if (state.fuel + 1e-9 >= P.minFlight) record(state.aboard, [], state.fuel)
  } else {
    dfs(state.pos, state.t, state.fuel, state.aboard, visited, [])
  }
  return { best, routes }
}

export function describe(r) {
  const stops = r.route.map((x) => {
    const how = [MODE_RU[x.mode], x.eco ? 'экономия' : '', x.drain ? 'слив' : ''].filter(Boolean).join(', ')
    const res = x.n ? `+${x.n}, запас ${x.margin.toFixed(1)} ч` : x.margin >= 0 ? 'только топливо' : `пусто, опоздание ${(-x.margin).toFixed(1)} ч`
    return `${ST[x.to].name} [${how}] ${fmt(x.arr)} (${res})`
  })
  return `${stops.join(' → ')} · топлива ${r.fuel}`
}

/**
 * Проход жёсткого сценария. legs: [{to, mode, drain?, eco?, switchAt?, switchTo?}].
 * switchAt — момент смены режима на том же курсе. tStop — остановиться в этот момент и вернуть состояние.
 */
function walk(P, legs, tStop = Infinity) {
  let pos = { x: 0, y: 0 }
  let t = 0
  let fuel = P.tank
  let aboard = 0
  const eco = Object.fromEntries(legs.filter((l) => l.eco).map((l) => [l.to, true]))
  const visited = []
  const log = []
  for (const leg of legs) {
    const s = ST[leg.to]
    const md = MODES[leg.mode]
    const d = dist(pos, s)
    const sw = leg.switchAt !== undefined && leg.switchAt > t && leg.switchAt < t + d * md.h
    const m2 = sw ? MODES[leg.switchTo] : md
    const done = sw ? (leg.switchAt - t) / md.h : 0
    const arr = sw ? leg.switchAt + (d - done) * m2.h : t + d * md.h
    if (tStop < arr) {
      const before = !sw || tStop < leg.switchAt
      const k = before ? (tStop - t) / md.h / d : (done + (tStop - leg.switchAt) / m2.h) / d
      const p = { x: pos.x + (s.x - pos.x) * k, y: pos.y + (s.y - pos.y) * k }
      const paid = before ? md.acc : md.acc + Math.abs(m2.acc - md.acc)
      return { state: { pos: p, t: tStop, fuel: fuel - paid, aboard, visited, flight: { to: leg.to, mode: before ? leg.mode : leg.switchTo }, eco }, log }
    }
    fuel -= md.acc + Math.abs(m2.acc - md.acc) + m2.brk
    const T = trueT(P, s.id, !!leg.eco)
    const n = arr <= T ? Math.min(s.saved, P.seats - aboard) : 0
    aboard += n
    let dock = P.dockH + (leg.eco && n > 0 ? P.ecoDockH : 0)
    if (leg.drain) {
      dock += P.drainH
      fuel = Math.min(P.tank, fuel + (P.stock[s.id] ?? 0))
    }
    log.push({ to: s.id, arr, margin: T - arr, n, fuel, leave: arr + dock })
    visited.push(s.id)
    pos = s
    t = arr + dock
  }
  return { state: { pos, t: tStop === Infinity ? t : Math.max(t, tStop), fuel, aboard, visited, flight: null, eco }, log }
}

export function run(P, legs) {
  const { state, log } = walk(P, legs)
  const drift = state.fuel + 1e-9 < P.minFlight
  return { aboard: drift ? 0 : state.aboard, drift, fuel: state.fuel, log }
}

export function stateAt(P, legs, tStop) {
  return walk(P, legs, tStop).state
}

export function printRun(title, r) {
  console.log(title)
  for (const l of r.log) {
    const m = l.margin >= 0 ? `запас ${l.margin.toFixed(1)} ч` : `опоздание ${(-l.margin).toFixed(1)} ч`
    console.log(`  ${ST[l.to].name.padEnd(14)} прибытие ${fmt(l.arr)} · ${m.padEnd(18)} · +${l.n} · топлива ${String(l.fuel).padStart(3)} · вылет ${fmt(l.leave)}`)
  }
  console.log(`  итог: ${r.drift ? 'дрейф, 0' : r.aboard} · топлива ${r.fuel}`)
}

// ——— таблицы документа ———

const S = (to, mode, o = {}) => ({ to, mode, ...o })
const START = { pos: { x: 0, y: 0 }, t: 0, fuel: 100, aboard: 0, visited: [] }
/** Курс Веры: загружен в планировщик в первое утро. */
export const VERA = [S('sinica', 'cruise'), S('klyuch', 'cruise'), S('smena', 'cruise'), S('okolica', 'cruise')]

function main() {
  const P = PARAMS
  let failed = 0
  const check = (name, got, want) => {
    const ok = got === want
    if (!ok) failed++
    console.log(`${ok ? 'ок ' : 'НЕТ'} ${name}: ${got}${ok ? '' : ` (ожидалось ${want})`}`)
  }
  const best = (state, opts) => solve(P, state, opts)
  const line = (r) => (r.routes[0] ? describe(r.routes[0]) : '—')

  console.log('== 1. Потолок ==')
  const top = best(START)
  check('максимум', top.best, 11)
  console.log('   ', line(top))
  check('12 невозможно (строгий поиск, до трёх заходов за топливом)', best(START, { seed: 11, strict: true, maxDepots: 3 }).best, 11)
  check('без слива топлива максимум', solve({ ...P, stock: {} }, START).best, 10)
  check('без экономии максимум', best({ ...START, canEco: false }).best, 11)
  for (const id of ['sinica', 'klyuch', 'smena', 'okolica']) check(`без «${ST[id].name}» не больше 10`, best(START, { forbid: [id] }).best <= 10, true)

  console.log('\n== 2. Курс Веры без единой правки ==')
  const blind = run(P, VERA)
  printRun('слепо', blind)
  check('слепо', blind.aboard, 7)
  const veraWorld = run({ ...P, dev: {} }, VERA)
  check('тот же курс в мире, каким его считала Вера', veraWorld.aboard, 11)
  check('топлива у Веры после «Околицы»', veraWorld.fuel, 12)

  console.log('\n== 3. Развилки из сюжета ==')
  for (const [id, want] of [['zarya', 7], ['kolybel', 10], ['mayak', 10], ['artel', 9], ['kordon', 2]]) {
    const r = best(START, { must: [id] })
    check(`лучший рейс с «${ST[id].name}»`, r.best, want)
    console.log('   ', line(r))
  }
  for (const id of ['polynya', 'vetra', 'kovsh', 'matryoshka', 'yar']) check(`«${ST[id].name}» недостижима`, best(START, { must: [id] }).best, -1)

  console.log('\n== 4. Первое отклонение: «Тёплый Ключ», −22 ч, новость утром д7 ==')
  for (const [d, withEco, noEco] of [[7, 11, 11], [8, 11, 11], [9, 11, 9], [10, 9, 9]]) {
    const st = stateAt(P, VERA, at(d, 8))
    const a = best(st)
    check(`взялся чинить утром д${d}`, a.best, withEco)
    console.log('   ', line(a))
    check(`  то же без экономии`, best({ ...st, canEco: false }).best, noEco)
  }

  console.log('\n== 5. Второе отклонение: «Околица», −30 ч, новость утром д15 ==')
  const K = (o = {}) => S('klyuch', 'cruise', { switchAt: P.news.klyuch, switchTo: 'burn', ...o })
  const lines = {
    'А: форсаж к «Ключу», долг по топливу не закрыт': [S('sinica', 'cruise'), K(), S('smena', 'cruise'), S('okolica', 'cruise')],
    'Б: форсаж к «Ключу», слив на «Ключе»': [S('sinica', 'cruise'), K({ drain: true }), S('smena', 'cruise'), S('okolica', 'cruise')],
  }
  for (const [name, legs] of Object.entries(lines)) {
    console.log(name)
    const idle = run(P, legs)
    console.log(`  если дальше ничего не трогать: ${idle.drift ? 'дрейф' : idle.aboard}`)
    for (const d of [15, 16, 17, 18, 19]) {
      const st = stateAt(P, legs, at(d, 8))
      const a = best(st)
      console.log(`  чинит утром д${d} (топлива ${st.fuel}): ${a.best}, без экономии ${best({ ...st, canEco: false }).best}`)
      if (d === 15) console.log('   ', line(a))
    }
  }
  const B = lines['Б: форсаж к «Ключу», слив на «Ключе»']
  check('линия Б, починка утром д15', best(stateAt(P, B, at(15, 8))).best, 11)
  check('линия Б, починка утром д18', best(stateAt(P, B, at(18, 8))).best, 11)
  check('линия Б без починки', run(P, B).aboard, 9)
  check('«Ключ» потерян, «Околица» починена утром д15', best(stateAt(P, VERA, at(15, 8))).best, 9)

  console.log('\n== 6. Образцовые рейсы ==')
  const g1 = [S('sinica', 'cruise'), K({ drain: true }), S('smena', 'cruise'), S('okolica', 'burn', { drain: true })]
  const r1 = run(P, g1)
  printRun('Г1: форсаж к «Ключу» со дня 7, слив на «Ключе», форсаж к «Околице», слив на «Околице»', r1)
  check('Г1', r1.aboard, 11)
  const g2 = [S('sinica', 'cruise'), K(), S('smena', 'cruise', { drain: true }), S('okolica', 'burn', { drain: true })]
  const r2 = run(P, g2)
  printRun('Г2: форсаж к «Ключу», слив на «Второй смене», форсаж к «Околице», слив на «Околице»', r2)
  check('Г2', r2.aboard, 11)
  const g3 = [S('sinica', 'cruise'), K(), S('smena', 'cruise'), S('okolica', 'cruise', { eco: true, drain: true })]
  const r3 = run(P, g3)
  printRun('Г3: форсаж к «Ключу», дальше крейсером, экономия «Околице», слив на «Околице»', r3)
  check('Г3', r3.aboard, 11)

  console.log('\n== 7. «Колыбель» с курса (линия Б) ==')
  for (const [lbl, tt, withEco, noEco] of [
    ['д10 16:00', at(10, 16), 8, 8],
    ['д11 08:00', at(11, 8), 8, 8],
    ['д11 11:30', at(11, 11, 30), 8, 8],
    ['д11 20:00', at(11, 20), 8, -1],
    ['д12 05:00', at(12, 5), 8, -1],
    ['д12 08:00', at(12, 8), -1, -1],
  ]) {
    const st = stateAt(P, B, tt)
    const a = best(st, { must: ['kolybel'] })
    check(`поворот в ${lbl}`, a.best, withEco)
    if (a.routes[0]) console.log('   ', line(a))
    check(`  то же без экономии`, best({ ...st, canEco: false }, { must: ['kolybel'] }).best, noEco)
  }

  console.log(failed ? `\nНе сошлось: ${failed}` : '\nВсё сошлось.')
  process.exit(failed ? 1 : 0)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
