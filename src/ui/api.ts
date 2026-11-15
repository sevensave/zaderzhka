import type { ZaderzhkaApi } from '../preload/api'

declare global {
  interface Window {
    zaderzhka?: ZaderzhkaApi
  }
}

/** В браузере (npm run web) — localStorage вместо файлов. */
const webApi: ZaderzhkaApi = {
  info: async () => ({ version: __APP_VERSION__, platform: 'web', launcher: false }),
  readSave: async (slot) => {
    try {
      return localStorage.getItem(`zaderzhka:${slot}`)
    } catch {
      return null
    }
  },
  writeSave: async (slot, data) => {
    try {
      localStorage.setItem(`zaderzhka:${slot}`, data)
      return true
    } catch {
      return false
    }
  },
  checkUpdate: async () => null,
  toggleFullscreen: () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => {})
  },
  quit: () => window.close(),
  openExternal: (url) => window.open(url, '_blank'),
}

export const api: ZaderzhkaApi = window.zaderzhka ?? webApi
export const isElectron = !!window.zaderzhka

declare global {
  const __APP_VERSION__: string
  const __DEV__: boolean
}
