import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  CoverCleanupResult,
  KnownTrackStamp,
  LibraryFileAddedEvent,
  LibraryFileRemovedEvent,
  MainWindowSettings,
  MediaCommand,
  ParsePathsResult,
  PlayerBroadcastState,
  ScanProgress,
  ScanResponse
} from '@shared/music'

/**
 * API mínima e tipada exposta ao renderer. Zero Node.js vazando para a UI:
 * só IPC serializável via contextBridge.
 *
 * Nota (Electron ≥ 32): `File.path` foi removido. Para drag & drop de verdade
 * vindo do Explorer usamos `webUtils.getPathForFile(file)`, que só existe no
 * processo de preload — por isso o listener de `drop` mora aqui e entrega
 * caminhos absolutos já resolvidos para o renderer.
 */

type DroppedPathListener = (paths: string[]) => void
const dropListeners = new Set<DroppedPathListener>()

/** Todos os caminhos válidos de um drop (arquivos e pastas do Explorer). */
function extractDroppedPaths(event: DragEvent): string[] {
  const transfer = event.dataTransfer
  if (!transfer) return []
  const paths: string[] = []
  for (const file of Array.from(transfer.files)) {
    try {
      const path = webUtils.getPathForFile(file)
      if (path && path.length > 0) paths.push(path)
    } catch {
      // arquivo sintético/inexistente — ignora silenciosamente
    }
  }
  return paths
}

// Captura o drop antes de qualquer handler do React: o renderer cuida só do
// estado visual (overlay), a resolução de caminhos é responsabilidade do main.
window.addEventListener(
  'drop',
  (event: DragEvent) => {
    const paths = extractDroppedPaths(event)
    if (paths.length === 0) return
    for (const listener of dropListeners) listener(paths)
  },
  true
)

window.addEventListener(
  'dragover',
  (event: DragEvent) => {
    // Sem isto o Chromium navega para o arquivo e mata o app.
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
  },
  true
)

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

  // ── Auto-watcher ────────────────────────────────────────────────────────

  /** Sincroniza as pastas vigiadas no main (chokidar). Idempotente. */
  async watchFolders(dirs: string[]): Promise<string[]> {
    return (await ipcRenderer.invoke('library:watch-folders', dirs)) as string[]
  },

  onFileAdded(callback: (event: LibraryFileAddedEvent) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: LibraryFileAddedEvent): void => callback(payload)
    ipcRenderer.on('library:file-added', listener)
    return () => {
      ipcRenderer.removeListener('library:file-added', listener)
    }
  },

  onFileRemoved(callback: (event: LibraryFileRemovedEvent) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: LibraryFileRemovedEvent): void => callback(payload)
    ipcRenderer.on('library:file-removed', listener)
    return () => {
      ipcRenderer.removeListener('library:file-removed', listener)
    }
  },

  // ── Drag & drop do Explorer ─────────────────────────────────────────────

  /** Caminhos absolutos resolvidos pelo preload no `drop`. */
  onDroppedPaths(callback: DroppedPathListener): () => void {
    dropListeners.add(callback)
    return () => {
      dropListeners.delete(callback)
    }
  },

  /** Parseia caminhos soltos (áudio) e devolve pastas para importar. */
  async parsePaths(paths: string[]): Promise<ParsePathsResult> {
    return (await ipcRenderer.invoke('library:parse-paths', paths)) as ParsePathsResult
  },

  // ── Manutenção ──────────────────────────────────────────────────────────

  async cleanupCovers(knownCoverPaths: string[]): Promise<CoverCleanupResult> {
    return (await ipcRenderer.invoke('library:cleanup-covers', knownCoverPaths)) as CoverCleanupResult
  },

  async revealInFolder(filePath: string): Promise<void> {
    await ipcRenderer.invoke('app:reveal-in-folder', filePath)
  },

  async getAppVersion(): Promise<string> {
    return (await ipcRenderer.invoke('app:get-version')) as string
  },

  // ── Tray / mini player / atalhos globais ────────────────────────────────

  async syncMainSettings(settings: Partial<MainWindowSettings>): Promise<MainWindowSettings> {
    return (await ipcRenderer.invoke('settings:sync-main', settings)) as MainWindowSettings
  },

  /** Disparado quando a janela é escondida na bandeja em vez de fechada. */
  onHiddenToTray(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on('window:hidden-to-tray', listener)
    return () => {
      ipcRenderer.removeListener('window:hidden-to-tray', listener)
    }
  },

  onTrayPreference(callback: (closeToTray: boolean) => void): () => void {
    const listener = (_event: IpcRendererEvent, value: boolean): void => callback(value)
    ipcRenderer.on('settings:tray-preference', listener)
    return () => {
      ipcRenderer.removeListener('settings:tray-preference', listener)
    }
  },

  /** Publica o estado do player para tray/mini player (throttle no renderer). */
  broadcastPlayerState(state: PlayerBroadcastState): void {
    ipcRenderer.send('player:broadcast', state)
  },

  async requestPlayerState(): Promise<PlayerBroadcastState | null> {
    return (await ipcRenderer.invoke('player:request-state')) as PlayerBroadcastState | null
  },

  onPlayerState(callback: (state: PlayerBroadcastState) => void): () => void {
    const listener = (_event: IpcRendererEvent, state: PlayerBroadcastState): void => callback(state)
    ipcRenderer.on('player:state', listener)
    return () => {
      ipcRenderer.removeListener('player:state', listener)
    }
  },

  /** Comandos de transporte vindos do tray/atalhos globais/mini player. */
  onPlayerCommand(callback: (command: MediaCommand) => void): () => void {
    const listener = (_event: IpcRendererEvent, command: MediaCommand): void => callback(command)
    ipcRenderer.on('player:command', listener)
    return () => {
      ipcRenderer.removeListener('player:command', listener)
    }
  },

  sendPlayerCommand(command: MediaCommand): void {
    ipcRenderer.send('player:command', command)
  },

  async openMiniPlayer(): Promise<void> {
    await ipcRenderer.invoke('window:open-mini')
  },

  async closeMiniPlayer(): Promise<void> {
    await ipcRenderer.invoke('window:close-mini')
  },

  async toggleMainWindow(): Promise<void> {
    await ipcRenderer.invoke('window:toggle-main')
  },

  async showMainWindow(): Promise<void> {
    await ipcRenderer.invoke('window:show-main')
  },

  async quitApp(): Promise<void> {
    await ipcRenderer.invoke('window:quit')
  }
}

export type OndaApi = typeof api

contextBridge.exposeInMainWorld('onda', api)
