import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { KnownTrackStamp, ScanProgress, ScanResponse } from '@shared/music'

/**
 * API mínima e tipada exposta ao renderer. Zero Node.js vazando para a UI:
 * só IPC serializável via contextBridge.
 */
const api = {
  platform: process.platform,

  async selectFolder(): Promise<string | null> {
    return (await ipcRenderer.invoke('dialog:select-folder')) as string | null
  },

  async scan(dir: string, known: KnownTrackStamp[]): Promise<ScanResponse> {
    return (await ipcRenderer.invoke('library:scan', { dir, known })) as ScanResponse
  },

  cancelScan(): void {
    void ipcRenderer.invoke('library:cancel-scan')
  },

  onScanProgress(callback: (progress: ScanProgress) => void): () => void {
    const listener = (_event: IpcRendererEvent, progress: ScanProgress): void => callback(progress)
    ipcRenderer.on('scan:progress', listener)
    return () => {
      ipcRenderer.removeListener('scan:progress', listener)
    }
  },

  async revealInFolder(filePath: string): Promise<void> {
    await ipcRenderer.invoke('app:reveal-in-folder', filePath)
  },

  async getAppVersion(): Promise<string> {
    return (await ipcRenderer.invoke('app:get-version')) as string
  }
}

export type OndaApi = typeof api

contextBridge.exposeInMainWorld('onda', api)
