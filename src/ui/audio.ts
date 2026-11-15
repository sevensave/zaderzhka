// Звук нужен в трёх местах: аварийный тон на фоне записей Веры, её дыхание при сортировке
// «по записи» и тишина на выключенном канале. Плюс еле слышный гул рубки. Всё процедурно.

let ctx: AudioContext | null = null
let master: GainNode | null = null
let effectsBus: GainNode | null = null
let hum: { src: AudioBufferSourceNode; gain: GainNode } | null = null
let toneTimer: number | null = null
let breath: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null
let music: ReturnType<typeof startMusic> | null = null
let musicAllowed = true
let musicDucked = false
let effectsEnabled = true
let volume = 0.7
let musicEnabled = true

// Девять гармоний по 32 секунды: полный оборот — 4 мин 48 с.
// Средний регистр остаётся слышен без басовых динамиков. Это собственная фигура,
// а не мелодия: её порядок меняется вместе с гармонией, без сюжетных привязок.
export const MUSIC_CYCLE = 288
const HARMONICS = [0, 0.56, 0.25, 0.12, 0.07]
const CHORDS = [
  [55, 220, 261.63, 329.63, 440],
  [55, 220, 293.66, 349.23, 440],
  [65.41, 261.63, 329.63, 392, 523.25],
  [65.41, 261.63, 349.23, 440, 523.25],
  [49, 220, 293.66, 392, 587.33],
  [49, 246.94, 293.66, 392, 493.88],
  [73.42, 293.66, 349.23, 440, 587.33],
  [65.41, 261.63, 329.63, 440, 523.25],
  [55, 220, 293.66, 329.63, 440],
]

interface MusicNote {
  at: number
  frequency: number
  level: number
  hold: number
}

function musicNotes(): MusicNote[] {
  const notes: MusicNote[] = []
  CHORDS.forEach((chord, i) => {
    const at = i * 32
    notes.push({ at, frequency: chord[0]!, level: 0.028, hold: 29 })
    notes.push({ at, frequency: chord[1]! / 2, level: 0.016, hold: 29 })
    notes.push({ at, frequency: chord[3]! / 2, level: 0.012, hold: 29 })
    const order = i % 2 ? [0, 2, 1, 3] : [0, 1, 3, 2]
    for (let step = 0; step < 20; step++) {
      const n = order[(step + Math.floor(i / 2)) % 4]!
      notes.push({ at: at + step * 1.6, frequency: chord[n + 1]!, level: 0.046, hold: 0.8 })
    }
  })
  return notes.sort((a, b) => a.at - b.at)
}

/** Один и тот же граф для игры и OfflineAudioContext в tools/render-music.mjs. */
function musicGraph(c: BaseAudioContext, out: AudioNode, origin: number) {
  const bus = c.createGain()
  bus.gain.value = 1
  bus.connect(out)
  const breathing = c.createGain()
  breathing.gain.value = 0.9
  breathing.connect(bus)
  const lfo = c.createOscillator()
  lfo.frequency.value = 1 / 11.2
  const depth = c.createGain()
  depth.gain.value = 0.1
  lfo.connect(depth).connect(breathing.gain)
  lfo.start(origin)
  // Два тихих отражения без обратной связи: хвост ограничен и не накапливается.
  const input = c.createGain()
  input.connect(breathing)
  const echoes: AudioNode[] = []
  for (const [time, level] of [[0.43, 0.12], [0.86, 0.05]]) {
    const delay = c.createDelay(1)
    delay.delayTime.value = time!
    const gain = c.createGain()
    gain.gain.value = level!
    input.connect(delay).connect(gain).connect(breathing)
    echoes.push(delay, gain)
  }
  const wave = c.createPeriodicWave(new Float32Array(HARMONICS.length), new Float32Array(HARMONICS), { disableNormalization: true })
  const voices = new Map<OscillatorNode, GainNode>()
  const note = (n: MusicNote, start: number) => {
    const osc = c.createOscillator()
    osc.setPeriodicWave(wave)
    osc.frequency.value = n.frequency
    const gain = c.createGain()
    const t = start + n.at
    // Мягкая атака 3 с, затем 4 с затухания. Фигуры перекрываются.
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(n.level * 1.1, t + 3)
    gain.gain.setValueAtTime(n.level * 1.1, t + 3 + n.hold)
    gain.gain.linearRampToValueAtTime(0, t + 7 + n.hold)
    osc.connect(gain).connect(input)
    voices.set(osc, gain)
    osc.onended = () => { voices.delete(osc); osc.disconnect(); gain.disconnect() }
    osc.start(t)
    osc.stop(t + 7 + n.hold)
  }
  return {
    bus, note,
    stop() {
      for (const [osc, gain] of voices) { osc.onended = null; osc.stop(); osc.disconnect(); gain.disconnect() }
      voices.clear()
      lfo.stop()
      for (const node of [input, breathing, lfo, depth, ...echoes, bus]) node.disconnect()
    },
  }
}

function startMusic(c: AudioContext, out: AudioNode) {
  const origin = c.currentTime + 0.05
  const graph = musicGraph(c, out, origin)
  const notes = musicNotes()
  let index = 0
  let cycle = 0
  const schedule = () => {
    // Запас больше периода таймера: короткая задержка интерфейса не рвёт музыку.
    while (origin + cycle * MUSIC_CYCLE + notes[index]!.at < c.currentTime + 12) {
      const start = origin + cycle * MUSIC_CYCLE
      if (start + notes[index]!.at >= c.currentTime) graph.note(notes[index]!, start)
      if (++index === notes.length) { index = 0; cycle++ }
    }
  }
  schedule()
  const timer = window.setInterval(schedule, 1000)
  return { ...graph, timer }
}

/** Рендер без отдельной аранжировки и без настроек игрока (номинальный уровень). */
export function previewMusic(c: OfflineAudioContext): void {
  const graph = musicGraph(c, c.destination, 0)
  // У WAV есть конец, у игры — следующий оборот. Завершаем только предпрослушивание.
  const duration = c.length / c.sampleRate
  graph.bus.gain.setValueAtTime(1, Math.max(0, duration - 4))
  graph.bus.gain.linearRampToValueAtTime(0, duration)
  for (let cycle = 0; cycle * MUSIC_CYCLE < c.length / c.sampleRate; cycle++) {
    for (const note of musicNotes()) {
      if (cycle * MUSIC_CYCLE + note.at < c.length / c.sampleRate) graph.note(note, cycle * MUSIC_CYCLE)
    }
  }
}

function ensure(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.gain.value = volume
      master.connect(ctx.destination)
      effectsBus = ctx.createGain()
      effectsBus.gain.value = effectsEnabled ? 1 : 0
      effectsBus.connect(master)
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function noise(c: AudioContext, seconds: number, brown = false): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1
    if (brown) {
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    } else d[i] = w
  }
  return buf
}

export const audio = {
  configure(on: boolean, vol: number, musicOn: boolean) {
    effectsEnabled = on
    volume = vol
    musicEnabled = musicOn
    if (master) master.gain.value = vol
    if (effectsBus) effectsBus.gain.value = on ? 1 : 0
    if (!on) {
      this.humOff()
      this.toneOff()
      this.breathOff()
    }
    if (musicOn) {
      this.musicOn()
    } else {
      this.musicOff()
    }
  },

  /** Канал и финальный экран — отдельный запрет, настройки не могут его снять. */
  musicContext(allowed: boolean) {
    musicAllowed = allowed
    if (allowed) this.musicOn()
    else this.musicOff()
  },

  musicDuck(ducked: boolean) {
    musicDucked = ducked
    if (music && ctx) music.bus.gain.setTargetAtTime(ducked ? 0.25 : 1, ctx.currentTime, 0.15)
  },

  musicOn() {
    if (!musicEnabled || !musicAllowed) return
    const c = ensure()
    if (!c || !master || music) return
    music = startMusic(c, master)
    music.bus.gain.value = musicDucked ? 0.25 : 1
  },

  musicOff() {
    if (!music || !ctx) return
    const state = music
    music = null
    clearInterval(state.timer)
    // Короткое затухание убирает щелчок, затем полная тишина, включая эхо.
    state.bus.gain.cancelScheduledValues(ctx.currentTime)
    state.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.015)
    setTimeout(() => state.stop(), 150)
  },

  humOn() {
    const c = ensure()
    if (!c || !effectsBus || !effectsEnabled || hum) return
    const src = c.createBufferSource()
    src.buffer = noise(c, 4, true)
    src.loop = true
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 140
    const gain = c.createGain()
    gain.gain.value = 0
    gain.gain.linearRampToValueAtTime(0.018, c.currentTime + 2)
    src.connect(lp).connect(gain).connect(effectsBus)
    src.start()
    hum = { src, gain }
  },

  humOff() {
    if (!hum || !ctx) return
    const h = hum
    hum = null
    h.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1)
    setTimeout(() => h.src.stop(), 1200)
  },

  /** Один сигнал аварийного тона: два коротких гудка. */
  beep() {
    const c = ensure()
    if (!c || !effectsBus || !effectsEnabled) return
    const t0 = c.currentTime + 0.05
    for (const [i, f] of [880, 660].entries()) {
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      const g = c.createGain()
      const s = t0 + i * 0.32
      g.gain.setValueAtTime(0, s)
      g.gain.linearRampToValueAtTime(0.045, s + 0.02)
      g.gain.linearRampToValueAtTime(0.0, s + 0.26)
      o.connect(g).connect(effectsBus)
      o.start(s)
      o.stop(s + 0.3)
    }
  },

  /** Короткий, приглушённый сигнал о новом сообщении. */
  notice() {
    const c = ensure()
    if (!c || !effectsBus || !effectsEnabled) return
    const t = c.currentTime + 0.03
    for (const [i, frequency] of [587.33, 784].entries()) {
      const osc = c.createOscillator()
      const gain = c.createGain()
      const start = t + i * 0.16
      osc.type = 'sine'
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.018, start + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28)
      osc.connect(gain).connect(effectsBus)
      osc.start(start)
      osc.stop(start + 0.3)
    }
  },

  /** Тон на фоне записи: сразу через пару секунд и потом раз в полторы минуты. */
  toneOn() {
    this.toneOff()
    this.musicDuck(true)
    if (!effectsEnabled) return
    const first = window.setTimeout(() => this.beep(), 2400)
    toneTimer = window.setInterval(() => this.beep(), 90_000)
    ;(this as { _first?: number })._first = first
  },

  toneOff() {
    if (toneTimer !== null) clearInterval(toneTimer)
    const f = (this as { _first?: number })._first
    if (f !== undefined) clearTimeout(f)
    toneTimer = null
  },

  breathOn() {
    this.musicDuck(true)
    const c = ensure()
    if (!c || !effectsBus || !effectsEnabled || breath) return
    const src = c.createBufferSource()
    src.buffer = noise(c, 3)
    src.loop = true
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 900
    bp.Q.value = 0.7
    const gain = c.createGain()
    gain.gain.value = 0
    const lfo = c.createOscillator()
    lfo.frequency.value = 0.21
    const depth = c.createGain()
    depth.gain.value = 0.012
    lfo.connect(depth).connect(gain.gain)
    src.connect(bp).connect(gain).connect(effectsBus)
    src.start()
    lfo.start()
    breath = { src, gain, lfo }
  },

  breathOff() {
    if (!breath) return
    breath.src.stop()
    breath.lfo.stop()
    breath = null
  },

  tick() {
    const c = ensure()
    if (!c || !effectsBus || !effectsEnabled) return
    const o = c.createOscillator()
    o.type = 'square'
    o.frequency.value = 1800
    const g = c.createGain()
    g.gain.setValueAtTime(0.008, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.03)
    o.connect(g).connect(effectsBus)
    o.start()
    o.stop(c.currentTime + 0.04)
  },
}
