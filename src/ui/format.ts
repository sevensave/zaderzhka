import { hrs } from '../content/ui-text'
import { clockOf } from '../sim/world'

const pad = (n: number) => String(n).padStart(2, '0')

export function clock(t: number): string {
  const c = clockOf(t)
  return `${pad(c.h)}:${pad(c.m)}`
}

/** «день 5, 10:48» */
export function stamp(t: number): string {
  const c = clockOf(t)
  return `день ${c.day}, ${pad(c.h)}:${pad(c.m)}`
}

/** «д5 10:48» */
export function short(t: number): string {
  const c = clockOf(t)
  return `д${c.day} ${pad(c.h)}:${pad(c.m)}`
}

/** «9 ч 01 мин» */
export function dur(h: number): string {
  const total = Math.max(0, Math.round(h * 60))
  const hh = Math.floor(total / 60)
  const mm = total % 60
  if (hh === 0) return `${mm} мин`
  return `${hh} ч ${pad(mm)} мин`
}

/** «12 ч» для запаса и опоздания. */
export function hours(h: number): string {
  return `${hrs(Math.abs(h))} ч`
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}
