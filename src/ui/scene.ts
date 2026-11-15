// Пиксельный слой: вид из рубки и корпус пульта. Логическое разрешение 480×270, растягивается
// только целым множителем. Окно никогда не комментирует события: оно знает только скорость,
// курс и то, у чего буксир стоит.

import { C } from './palette'

export const W = 480
export const H = 270
export const WIN_H = 164

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
const dither = (x: number, y: number, v: number) => v > BAYER[(y & 3) * 4 + (x & 3)]!

function smoothNoise(seed: number) {
  const r = rng(seed)
  const g: number[] = []
  for (let i = 0; i < 64 * 64; i++) g.push(r())
  const at = (x: number, y: number) => g[((y & 63) << 6) | (x & 63)]!
  return (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = x - xi
    const fy = y - yi
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx
    return a + (b - a) * sy
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d')!
  x.imageSmoothingEnabled = false
  return [c, x]
}

/** Сдвиг вида: по горизонтали вид может уйти на ±SHIFT пикселей. */
const SHIFT = 70
const SKY_W = W + SHIFT * 2

interface Star {
  x: number
  y: number
  c: string
  big: boolean
  tw: number
}

interface Debris {
  x: number
  y: number
  c: string
  s: number
  v: number
  ph: number
}

export interface Silhouette {
  seed: number
  lights: number
  /** Узел «Перевал» больше и светлее. */
  hub?: boolean
}

export interface WindowState {
  /** 0 — стоим, 1 — эконом, 1.6 — крейсер, 2.6 — форсаж. */
  speed: number
  /** Целевой сдвиг вида, −1..1. */
  heading: number
  silhouette: Silhouette | null
  reduced: boolean
}

export class Sky {
  private back: HTMLCanvasElement
  private ice: HTMLCanvasElement
  private stars: Star[] = []
  private debris: Debris[] = []
  private ox = 0
  private iceX = 0
  private silCache = new Map<string, HTMLCanvasElement>()
  private frame = 0

  constructor() {
    this.back = this.makeBack()
    this.ice = this.makeIce()
    const r = rng(7)
    for (let i = 0; i < 190; i++) {
      const v = r()
      this.stars.push({
        x: Math.floor(r() * SKY_W),
        y: Math.floor(r() * (WIN_H - 30)),
        c: v < 0.62 ? C.cold : v < 0.9 ? C.ice : C.glint,
        big: v > 0.975,
        tw: r(),
      })
    }
    for (let i = 0; i < 16; i++) {
      this.debris.push({
        x: r() * W,
        y: 20 + r() * (WIN_H - 30),
        c: r() < 0.7 ? C.ice : C.glint,
        s: r() < 0.8 ? 1 : 2,
        v: 0.6 + r() * 1.4,
        ph: r() * 100,
      })
    }
  }

  /** Фон: глубина, дымка, туманность, хвост Шквала. Статичен, сдвигается медленно. */
  private makeBack(): HTMLCanvasElement {
    const [c, x] = canvas(SKY_W, WIN_H)
    x.fillStyle = C.deep
    x.fillRect(0, 0, SKY_W, WIN_H)
    const n1 = smoothNoise(11)
    const n2 = smoothNoise(23)
    for (let y = 0; y < WIN_H; y++) {
      for (let px = 0; px < SKY_W; px++) {
        // Дымка пояса снизу.
        const low = Math.max(0, (y - 70) / 94)
        const haze = low * 0.8 + (n2(px / 22, y / 10) - 0.5) * 0.35
        // Туманность: два облака.
        const neb =
          n1(px / 34, y / 26) * Math.exp(-(((px - 170) / 150) ** 2) - ((y - 46) / 46) ** 2) * 1.5 +
          n1(px / 28 + 9, y / 22 + 4) * Math.exp(-(((px - 470) / 120) ** 2) - ((y - 70) / 40) ** 2) * 1.3
        let col: string | null = null
        if (dither(px, y, haze)) col = C.indigo
        if (dither(px, y, haze - 0.55)) col = C.blue
        if (dither(px, y, neb - 0.45)) col = C.violet
        if (dither(px, y, neb - 0.85)) col = C.lilac
        if (col) {
          x.fillStyle = col
          x.fillRect(px, y, 1, 1)
        }
      }
    }
    // Хвост Шквала: дуга из обломков к солнцу, густая у головы.
    const r = rng(5)
    for (let i = 0; i < 1150; i++) {
      const k = r()
      const px = 40 + k * 430
      const py = 112 - k * 78 + Math.sin(k * 3.1) * 18 + (r() - 0.5) * (8 + k * 22)
      const dense = 1 - k * 0.7
      if (r() > dense) continue
      x.fillStyle = r() < 0.15 + k * 0.25 ? C.glint : r() < 0.6 ? C.ice : C.cold
      x.fillRect(Math.round(px), Math.round(py), 1, 1)
    }
    return c
  }

  /** Ледяные поля: широкая лента, которая медленно ползёт. */
  private makeIce(): HTMLCanvasElement {
    const IW = 960
    const [c, x] = canvas(IW, 60)
    const r = rng(31)
    const n = smoothNoise(41)
    for (let px = 0; px < IW; px++) {
      const h = Math.floor(10 + n(px / 18, 0.5) * 26 + n(px / 5, 3) * 6)
      for (let y = 60 - h; y < 60; y++) {
        const depth = (y - (60 - h)) / h
        x.fillStyle = depth < 0.08 ? C.ice : depth < 0.3 ? C.cold : depth < 0.7 ? C.blue : C.indigo
        if (depth > 0.3 && dither(px, y, n(px / 3, y / 3) * 0.5)) x.fillStyle = C.cold
        x.fillRect(px, y, 1, 1)
      }
      if (r() < 0.05) {
        x.fillStyle = C.glint
        x.fillRect(px, 60 - h, 1, 1)
      }
    }
    // Шов, чтобы лента стыковалась без скачка.
    const seam = x.getImageData(0, 0, 40, 60)
    x.putImageData(seam, IW - 40, 0)
    return c
  }

  private silhouette(sil: Silhouette): HTMLCanvasElement {
    const key = `${sil.seed}:${sil.lights}:${sil.hub ? 1 : 0}`
    const hit = this.silCache.get(key)
    if (hit) return hit
    const r = rng(sil.seed * 97 + 3)
    const w = sil.hub ? 90 : 40 + Math.floor(r() * 30)
    const [c, x] = canvas(w + 8, 60)
    const fill = (a: number, b: number, cw: number, ch: number) => {
      x.fillStyle = C.void
      x.fillRect(a, b, cw, ch)
      x.fillStyle = C.body
      x.fillRect(a, b, cw, 1)
      x.fillRect(a + cw - 1, b, 1, ch)
    }
    const cy = 30
    // Корпус.
    const coreH = 8 + Math.floor(r() * 8)
    fill(4, cy - coreH / 2, w, coreH)
    // Модули.
    const mods = 2 + Math.floor(r() * (sil.hub ? 6 : 3))
    const windows: [number, number][] = []
    for (let i = 0; i < mods; i++) {
      const mw = 6 + Math.floor(r() * 12)
      const mh = 6 + Math.floor(r() * 12)
      const mx = 4 + Math.floor(r() * (w - mw))
      const up = r() < 0.5
      const my = up ? cy - coreH / 2 - mh + 1 : cy + coreH / 2 - 1
      fill(mx, my, mw, mh)
      windows.push([mx + 2 + Math.floor(r() * Math.max(1, mw - 4)), my + 2 + Math.floor(r() * Math.max(1, mh - 4))])
    }
    // Мачта и панель.
    const ax = 4 + Math.floor(r() * w)
    x.fillStyle = C.body
    x.fillRect(ax, cy - coreH / 2 - 16, 1, 16)
    x.fillStyle = C.void
    x.fillRect(ax - 4, cy - coreH / 2 - 18, 9, 2)
    if (r() < 0.7) {
      x.fillStyle = C.indigo
      x.fillRect(w - 6, cy - 1, 10, 3)
    }
    windows.push([6 + Math.floor(r() * (w - 8)), Math.floor(cy)])
    // Огни: у живой станции два-три, у мёртвой ни одного.
    x.fillStyle = C.ice
    for (let i = 0; i < Math.min(sil.lights, windows.length); i++) {
      const [lx, ly] = windows[i]!
      x.fillRect(lx, ly, sil.hub ? 1 : 2, 1)
    }
    if (sil.hub) {
      for (let i = 0; i < 9; i++) x.fillRect(6 + Math.floor(r() * w), cy - 4 + Math.floor(r() * 8), 1, 1)
    }
    this.silCache.set(key, c)
    return c
  }

  draw(x: CanvasRenderingContext2D, st: WindowState, dt: number, now: number): void {
    const motion = st.reduced ? 0 : 1
    // Плавный сдвиг вида при смене курса: 3–4 секунды.
    const target = st.heading * SHIFT
    const k = Math.min(1, dt / 1.1)
    this.ox += (target - this.ox) * k * (st.reduced ? 1 : 1)
    if (st.reduced) this.ox = target
    const ox = this.ox

    x.save()
    x.beginPath()
    x.rect(0, 0, W, WIN_H)
    x.clip()
    x.drawImage(this.back, Math.round(-SHIFT - ox * 0.25), 0)

    // Звёзды: дальний слой, неподвижны, редкое мерцание (8 кадров в секунду).
    const tick = Math.floor(now * 8)
    if (tick !== this.frame) this.frame = tick
    for (const s of this.stars) {
      const sx = Math.round(s.x - SHIFT - ox * 0.15)
      if (sx < 0 || sx >= W) continue
      let col = s.c
      if (motion && ((tick + Math.floor(s.tw * 997)) % 211) < 2) col = s.c === C.glint ? C.ice : C.indigo
      x.fillStyle = col
      x.fillRect(sx, s.y, 1, 1)
      if (s.big) {
        x.fillStyle = C.cold
        x.fillRect(sx - 1, s.y, 1, 1)
        x.fillRect(sx + 1, s.y, 1, 1)
        x.fillRect(sx, s.y - 1, 1, 1)
        x.fillRect(sx, s.y + 1, 1, 1)
      }
    }

    // Солнце: 4 пикселя и бледный ореол.
    const sunX = Math.round(404 - ox * 0.2)
    const sunY = 30
    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -12; dx <= 12; dx++) {
        const d = Math.hypot(dx, dy)
        if (d < 2.6 || d > 12) continue
        if (dither(sunX + dx, sunY + dy, ((12 - d) / 12) ** 2 * 0.55)) {
          x.fillStyle = d < 5 ? C.sun : C.indigo
          if (d >= 5 && d < 8) x.fillStyle = C.blue
          x.fillRect(sunX + dx, sunY + dy, 1, 1)
        }
      }
    }
    x.fillStyle = C.sun
    x.fillRect(sunX - 1, sunY - 2, 3, 5)
    x.fillRect(sunX - 2, sunY - 1, 5, 3)

    // Силуэт станции на стоянке.
    if (st.silhouette) {
      const img = this.silhouette(st.silhouette)
      x.drawImage(img, Math.round(300 - img.width / 2 - ox * 0.5), 46)
    }

    // Ледяные поля: медленно; на форсаже заметно быстрее, на стоянке замирают.
    this.iceX = (this.iceX + dt * 0.9 * st.speed * motion) % this.ice.width
    const ix = Math.round(-this.iceX - ox * 0.6) % this.ice.width
    x.drawImage(this.ice, ix - this.ice.width, WIN_H - 60)
    x.drawImage(this.ice, ix, WIN_H - 60)
    x.drawImage(this.ice, ix + this.ice.width, WIN_H - 60)

    // Ближние обломки: редкие блики.
    for (const d of this.debris) {
      d.x -= dt * d.v * 3.2 * st.speed * motion
      if (d.x < -4) d.x += W + 8
      const gx = Math.round(d.x - ox * 1.0 + SHIFT) % (W + 8)
      const glint = motion && Math.sin(now * 2 + d.ph) > 0.93
      x.fillStyle = glint ? C.glint : d.c === C.glint ? C.ice : C.cold
      x.fillRect(gx, Math.round(d.y), d.s, d.s)
      if (glint) {
        x.fillStyle = C.ice
        x.fillRect(gx - 1, Math.round(d.y), 1, 1)
        x.fillRect(gx + d.s, Math.round(d.y), 1, 1)
      }
    }
    x.restore()
  }
}

// ——— пульт ———

export const PANEL = {
  left: { x: 3, y: 171, w: 150, h: 96 },
  center: { x: 159, y: 171, w: 162, h: 96 },
  right: { x: 327, y: 171, w: 150, h: 96 },
}

export function drawConsole(x: CanvasRenderingContext2D): void {
  // Переплёт под окном.
  x.fillStyle = C.body
  x.fillRect(0, WIN_H, W, 4)
  x.fillStyle = C.edge
  x.fillRect(0, WIN_H, W, 1)
  // Корпус.
  x.fillStyle = C.body
  x.fillRect(0, WIN_H + 4, W, H - WIN_H - 4)
  x.fillStyle = C.panel
  x.fillRect(156, WIN_H + 4, 1, H - WIN_H - 4)
  x.fillRect(323, WIN_H + 4, 1, H - WIN_H - 4)
  for (const p of Object.values(PANEL)) {
    x.fillStyle = C.edge
    x.fillRect(p.x - 1, p.y - 1, p.w + 2, p.h + 2)
    x.fillStyle = C.panel
    x.fillRect(p.x, p.y, p.w, p.h)
  }
  // Заклёпки.
  x.fillStyle = C.edge
  for (const rx of [1, 154, 157, 322, 325, 478]) {
    x.fillRect(rx, 169, 1, 1)
    x.fillRect(rx, 268, 1, 1)
  }
}

export function fillRect(x: CanvasRenderingContext2D, col: string, a: number, b: number, w: number, h: number): void {
  x.fillStyle = col
  x.fillRect(a, b, w, h)
}

/** Окружность в 1 пиксель (алгоритм средней точки), с обрезкой по прямоугольнику. */
export function ring(
  x: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  col: string,
  clip: { x: number; y: number; w: number; h: number },
  density = 1,
): void {
  if (r < 0.5) return
  x.fillStyle = col
  const R = Math.round(r)
  let px = R
  let py = 0
  let err = 1 - R
  const icx = Math.round(cx)
  const icy = Math.round(cy)
  let n = 0
  const plot = (a: number, b: number) => {
    if (a < clip.x || b < clip.y || a >= clip.x + clip.w || b >= clip.y + clip.h) return
    x.fillRect(a, b, 1, 1)
  }
  while (px >= py) {
    n++
    // Бледнеет с расстоянием: прореживаем точки.
    if (density >= 1 || dither(px + py, n, density)) {
      plot(icx + px, icy + py)
      plot(icx + py, icy + px)
      plot(icx - py, icy + px)
      plot(icx - px, icy + py)
      plot(icx - px, icy - py)
      plot(icx - py, icy - px)
      plot(icx + py, icy - px)
      plot(icx + px, icy - py)
    }
    py++
    if (err < 0) err += 2 * py + 1
    else {
      px--
      err += 2 * (py - px) + 1
    }
  }
}
