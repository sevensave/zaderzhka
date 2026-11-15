type Child = Node | string | null | undefined | false

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'class') el.className = String(v)
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener)
      else if (k === 'html') el.innerHTML = String(v)
      else el.setAttribute(k, v === true ? '' : String(v))
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    el.append(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return el
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]!)
}

/**
 * Речь: абзацы по переводам строк, ремарки [в скобках] — курсивом и тусклым.
 * Строки, начинающиеся с тире, — реплики в сценах.
 */
export function speech(text: string, cls = 'speech'): HTMLElement {
  const box = h('div', { class: cls })
  for (const para of text.split('\n')) {
    const p = h('p')
    p.innerHTML = esc(para).replace(/\[([^\]]+)\]/g, '<i class="remark">[$1]</i>')
    box.append(p)
  }
  return box
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.firstChild.remove()
}

/** append, который пропускает пустые значения. */
export function add(el: HTMLElement, ...kids: Child[]): void {
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k)
}
