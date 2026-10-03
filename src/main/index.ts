import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join } from 'path'
import { scanDirectory, cancelActiveScan } from './scanner'
import { registerMediaProtocol } from './media'
import type { KnownTrackStamp } from '@shared/music'

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
    icon: is.dev ? join(__dirname, '../../resources/icon.svg') : join(process.resourcesPath, 'buildResources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
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

    try {
      return await scanDirectory(dir, knownMap, send)
    } catch (err) {
      // Cancelamento explícito não é erro.
      if ((err as Error)?.name === 'ScanCancelledError') {
        return { dir, changed: [], unchanged: [], scannedAt: Date.now(), aborted: true }
      }
      throw err
    }
  }
)

ipcMain.handle('library:cancel-scan', () => {
  cancelActiveScan()
})

ipcMain.handle('app:reveal-in-folder', (_e, filePath: string) => {
  if (typeof filePath === 'string' && filePath.length > 0) {
    shell.showItemInFolder(filePath)
  }
})

ipcMain.handle('app:get-version', () => app.getVersion())

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

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
