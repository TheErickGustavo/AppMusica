import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, protocol, shell, Tray } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join } from 'path'
import { cleanupOrphanCovers, scanDirectory, cancelActiveScan } from './scanner'
import { registerMediaProtocol } from './media'
import {
  closeAllWatchers,
  getWatchedFolders,
  parseDroppedPaths,
  setWatchEventSink,
  suspendWatcher,
  syncWatchedFolders
} from './watcher'
import type {
  CoverCleanupResult,
  KnownTrackStamp,
  LibraryFileAddedEvent,
  LibraryFileRemovedEvent,
  MainWindowSettings,
  MediaCommand,
  ParsePathsResult,
  PlayerBroadcastState
} from '@shared/music'

// Protocolo privilegiado precisa ser declarado ANTES do app estar pronto.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let mainSettings: MainWindowSettings = { closeToTray: true }
let lastPlayerState: PlayerBroadcastState = {
  isPlaying: false,
  status: 'idle',
  title: null,
  artist: null,
  album: null,
  coverPath: null,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  playMode: 'off'
}

/** Caminho de um asset empacotado (dev: raiz do repo · prod: resources/). */
function assetPath(...parts: string[]): string {
  return is.dev ? join(__dirname, '../../', ...parts) : join(process.resourcesPath, ...parts)
}

// ─── Janela principal ───────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    title: 'Onda',
    icon: assetPath('buildResources', 'icon@256.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Escondida na bandeja o Chromium estrangula timers da janela oculta.
      // Com isto a telemetria, o broadcast p/ bandeja e o crossfade continuam
      // exatos mesmo tocando em segundo plano.
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  // Fechar ≠ encerrar: com "fechar para a bandeja" ligado, a música continua.
  mainWindow.on('close', (event) => {
    if (isQuitting || !mainSettings.closeToTray) return
    event.preventDefault()
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Uma vez por sessão: o usuário precisa saber que o app continua vivo.
      mainWindow.webContents.send('window:hidden-to-tray', true)
    }
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    closeMiniWindow()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Qualquer link externo vai para o navegador padrão; nunca dentro do app.
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── Mini player (janela flutuante always-on-top) ───────────────────────────

function createMiniWindow(): void {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.show()
    miniWindow.focus()
    return
  }
  miniWindow = new BrowserWindow({
    width: 360,
    height: 104,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#09090b',
    title: 'Onda · mini',
    icon: assetPath('buildResources', 'icon@256.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  miniWindow.on('ready-to-show', () => miniWindow?.show())
  miniWindow.on('closed', () => {
    miniWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void miniWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?mini=1`)
  } else {
    void miniWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { mini: '1' } })
  }
}

function closeMiniWindow(): void {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.destroy()
  }
  miniWindow = null
}

function toggleMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide()
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

// ─── Bandeja do sistema (Tray) + ThumbarButtons ─────────────────────────────

function trayImage(): Electron.NativeImage {
  const candidates = [assetPath('tray-icon.png'), assetPath('buildResources', 'icon@32.png')]
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate)
    if (!image.isEmpty()) return image.resize({ width: 16, height: 16 })
  }
  return nativeImage.createEmpty()
}

function mediaGlyph(name: 'play' | 'pause' | 'next' | 'prev'): Electron.NativeImage {
  return nativeImage.createFromPath(assetPath('player', `${name}.png`))
}

function trayPlayLabel(): string {
  return lastPlayerState.isPlaying ? 'Pausar' : 'Tocar'
}

function rebuildTray(): void {
  if (!tray) return
  const trackLabel = lastPlayerState.title
    ? `${lastPlayerState.title}${lastPlayerState.artist ? ` — ${lastPlayerState.artist}` : ''}`
    : 'Nada tocando'
  tray.setToolTip(`Onda · ${trackLabel}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trackLabel.length > 60 ? `${trackLabel.slice(0, 60)}…` : trackLabel, enabled: false },
      { type: 'separator' },
      { label: trayPlayLabel(), click: () => sendMediaCommand('toggle') },
      { label: 'Próxima faixa', click: () => sendMediaCommand('next') },
      { label: 'Faixa anterior', click: () => sendMediaCommand('previous') },
      { type: 'separator' },
      { label: 'Mini player', click: () => createMiniWindow() },
      { label: 'Mostrar / ocultar Onda', click: toggleMainWindow },
      {
        label: 'Fechar para a bandeja',
        type: 'checkbox',
        checked: mainSettings.closeToTray,
        click: (item) => {
          mainSettings = { ...mainSettings, closeToTray: item.checked }
          mainWindow?.webContents.send('settings:tray-preference', mainSettings.closeToTray)
        }
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(): void {
  const image = trayImage()
  if (image.isEmpty()) {
    console.warn('[tray] ícone não encontrado — bandeja desabilitada')
    return
  }
  tray = new Tray(image)
  tray.on('click', toggleMainWindow)
  tray.on('double-click', toggleMainWindow)
  rebuildTray()
}

/** Botões de mídia na taskbar do Windows (Windows 7+). */
function updateThumbar(): void {
  if (process.platform !== 'win32') return
  if (!mainWindow || mainWindow.isDestroyed()) return
  const playPauseGlyph = mediaGlyph(lastPlayerState.isPlaying ? 'pause' : 'play')
  if (playPauseGlyph.isEmpty()) return
  try {
    mainWindow.setThumbarButtons([
      {
        tooltip: 'Faixa anterior',
        icon: mediaGlyph('prev'),
        click: () => sendMediaCommand('previous')
      },
      {
        tooltip: lastPlayerState.isPlaying ? 'Pausar' : 'Tocar',
        icon: playPauseGlyph,
        click: () => sendMediaCommand('toggle')
      },
      {
        tooltip: 'Próxima faixa',
        icon: mediaGlyph('next'),
        click: () => sendMediaCommand('next')
      }
    ])
  } catch (err) {
    console.warn('[thumbar] falha ao registrar botões:', (err as Error)?.message)
  }
}

// ─── Comandos de transporte (tray / atalhos globais / mini player) ──────────

function sendMediaCommand(command: MediaCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // A janela pode estar escondida na bandeja — o áudio continua no renderer.
  mainWindow.webContents.send('player:command', command)
}

function registerMediaShortcuts(): void {
  const bindings: { accelerator: string; command: MediaCommand }[] = [
    { accelerator: 'MediaPlayPause', command: 'toggle' },
    { accelerator: 'MediaNextTrack', command: 'next' },
    { accelerator: 'MediaPreviousTrack', command: 'previous' },
    { accelerator: 'MediaStop', command: 'stop' }
  ]
  for (const { accelerator, command } of bindings) {
    try {
      const ok = globalShortcut.register(accelerator, () => sendMediaCommand(command))
      if (!ok) console.warn(`[shortcuts] ${accelerator} já está em uso por outro app`)
    } catch (err) {
      console.warn(`[shortcuts] ${accelerator} indisponível:`, (err as Error)?.message)
    }
  }
}

// ─── IPC ────────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:select-folder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolha uma pasta de música',
    buttonLabel: 'Usar pasta',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
})

ipcMain.handle(
  'library:scan',
  async (event, payload: { dir: string; known: KnownTrackStamp[] }) => {
    const { dir, known } = payload
    const knownMap = new Map<string, KnownTrackStamp>()
    for (const k of known) knownMap.set(k.filePath, k)

    const send = (progress: { stage: 'walk' | 'parse' | 'done'; done: number; total: number; current: string }): void => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('scan:progress', { dir, ...progress })
      }
    }

    // O scan completo já cobre o que o watcher faria — evita trabalho duplicado.
    suspendWatcher(true)
    try {
      return await scanDirectory(dir, knownMap, send)
    } catch (err) {
      // Cancelamento explícito não é erro.
      if ((err as Error)?.name === 'ScanCancelledError') {
        return { dir, changed: [], unchanged: [], scannedAt: Date.now(), aborted: true }
      }
      throw err
    } finally {
      suspendWatcher(false)
    }
  }
)

ipcMain.handle('library:cancel-scan', () => {
  cancelActiveScan()
})

// Auto-watcher: o renderer manda as pastas do Dexie (o main não lê IndexedDB).
ipcMain.handle('library:watch-folders', async (_event, dirs: string[]) => {
  await syncWatchedFolders(Array.isArray(dirs) ? dirs : [])
  return getWatchedFolders()
})

// Drag & drop do Explorer: parse de caminhos soltos + pastas.
ipcMain.handle('library:parse-paths', async (_event, paths: string[]): Promise<ParsePathsResult> => {
  return parseDroppedPaths(Array.isArray(paths) ? paths : [])
})

// Limpeza de capas órfãs (cache de disco) — o renderer envia os caminhos vivos.
ipcMain.handle('library:cleanup-covers', async (_event, knownCoverPaths: string[]): Promise<CoverCleanupResult> => {
  return cleanupOrphanCovers(Array.isArray(knownCoverPaths) ? knownCoverPaths : [])
})

ipcMain.handle('app:reveal-in-folder', (_e, filePath: string) => {
  if (typeof filePath === 'string' && filePath.length > 0) {
    shell.showItemInFolder(filePath)
  }
})

ipcMain.handle('app:get-version', () => app.getVersion())

// Preferências que só o main precisa (fechar para a bandeja).
ipcMain.handle('settings:sync-main', (_event, settings: Partial<MainWindowSettings>) => {
  mainSettings = { ...mainSettings, ...(settings ?? {}) }
  rebuildTray()
  return mainSettings
})

// Estado do player publicado pelo renderer → tray, mini player e janelas.
ipcMain.on('player:broadcast', (_event, state: PlayerBroadcastState) => {
  const previous = lastPlayerState
  lastPlayerState = state
  // O renderer publica a cada ~400ms (relógio da faixa). Reconstruir o menu
  // nativo 2.5x/s é desperdício — só quando o que aparece no tray muda.
  const relevantChange =
    previous.isPlaying !== state.isPlaying || previous.title !== state.title || previous.artist !== state.artist
  if (relevantChange) {
    rebuildTray()
    if (previous.isPlaying !== state.isPlaying) updateThumbar()
  }
  broadcastToOtherWindows('player:state', state)
})

// Comandos vindos do mini player (janela separada) → janela principal.
ipcMain.on('player:command', (_event, command: MediaCommand) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('player:command', command)
})

ipcMain.handle('player:request-state', () => lastPlayerState)

ipcMain.handle('window:open-mini', () => {
  createMiniWindow()
})

ipcMain.handle('window:close-mini', () => {
  closeMiniWindow()
})

ipcMain.handle('window:toggle-main', () => {
  toggleMainWindow()
})

ipcMain.handle('window:show-main', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

ipcMain.handle('window:quit', () => {
  isQuitting = true
  app.quit()
})

function broadcastToOtherWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

if (process.platform === 'win32') {
  app.setAppUserModelId('com.onda.desktop')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    electronApp.setAppUserModelId('com.onda.desktop')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerMediaProtocol()

    // Watcher: eventos de disco → janela principal (upsert preservando telemetria).
    setWatchEventSink({
      onAdded: (folder, track) => {
        const payload: LibraryFileAddedEvent = { folder, track }
        mainWindow?.webContents.send('library:file-added', payload)
      },
      onRemoved: (folder, filePath) => {
        const payload: LibraryFileRemovedEvent = { folder, filePath }
        mainWindow?.webContents.send('library:file-removed', payload)
      }
    })

    createWindow()
    createTray()
    registerMediaShortcuts()
    updateThumbar()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    void closeAllWatchers()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
