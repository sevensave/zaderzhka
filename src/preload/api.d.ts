export interface AppInfo {
  version: string
  platform: string
  launcher: boolean
}

export interface UpdateInfo {
  version: string
  url: string
}

export interface ZaderzhkaApi {
  info(): Promise<AppInfo>
  readSave(slot: string): Promise<string | null>
  writeSave(slot: string, data: string): Promise<boolean>
  checkUpdate(): Promise<UpdateInfo | null>
  toggleFullscreen(): void
  quit(): void
  openExternal(url: string): void
}
