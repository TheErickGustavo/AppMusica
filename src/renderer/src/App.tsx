import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type ReactElement } from 'react'
import { MonitorX, Music4 } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { TrackList } from './components/TrackList'
import { PlayerBar } from './components/PlayerBar'
import { MiniPlayerBar } from './components/MiniPlayer'
import { QueueDrawer } from './components/QueueDrawer'
import { ContextMenuHost } from './components/ContextMenu'
import { PromptHost } from './components/PromptHost'
import { Toaster } from './components/Toaster'
import { AudioEngineProvider, useCurrentTrack, usePlayerActions } from './hooks/useAudioPlayer'
import { useLibrary } from './hooks/useLibrary'
import { pushToast } from './lib/toast'

/* ═══════════════════════════════════════════════════════════════════════════
 * ONDA · App — três painéis: Sidebar (navegação/playlists/estatísticas) ·
 * Main View (tabela + estante de capas) · Playbar dock. Estado global via
 * hooks: motor de áudio (useSyncExternalStore) + biblioteca (Dexie live).
 *
 * Aqui também vivem os recursos "de desktop": drop do Explorer com overlay,
 * sincronização de preferências com o main (bandeja), crossfade e atalhos.
 * ═════════════════════════════════════════════════════════════════════════ */

const MINI_QUERY = 'mini'

export default function App(): ReactElement {
  // A janela do mini player carrega o mesmo bundle com ?mini=1 — não faz
  // sentido montar biblioteca/engine lá (o áudio vive na janela principal).
  const isMini = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get(MINI_QUERY) === '1'
  if (isMini) return <MiniPlayerBar />

  return (
    <AudioEngineProvider>
      <Shell />
    </AudioEngineProvider>
  )
}

function Shell(): ReactElement {
  const lib = useLibrary()
  const actions = usePlayerActions()
  const currentTrack = useCurrentTrack()
  const [queueOpen, setQueueOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  /** dragenter/dragleave disparam por elemento filho — contador evita flicker. */
  const dragDepth = useRef(0)

  const toggleQueue = useCallback(() => setQueueOpen((v) => !v), [])

  const onToggleLike = useCallback(
    (filePath: string) => {
      void lib.toggleLike(filePath)
    },
    [lib]
  )
  const onToggleDislike = useCallback(
    (filePath: string) => {
      void lib.toggleDislike(filePath)
    },
    [lib]
  )

  // ── drag & drop do Windows Explorer ──────────────────────────────────────
  // O overlay é React; a resolução dos caminhos acontece no preload
  // (webUtils.getPathForFile), que emite `onDroppedPaths`.

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    dragDepth.current++
    setIsDragging(true)
  }, [])

  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback((e: ReactDragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }, [])

  const onDrop = useCallback((e: ReactDragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
  }, [])

  const importPaths = useCallback(
    async (paths: string[]) => {
      const result = await lib.addPaths(paths)
      if (result.tracks.length === 0) return
      // Nada tocando → começa na hora. Tocando algo → entra na fila, sem
      // interromper o que o usuário está ouvindo (comportamento de player).
      if (currentTrack === null) actions.playFromQueue(result.tracks, 0)
      else actions.enqueue(result.tracks, 'last')
    },
    [lib, actions, currentTrack]
  )

  useEffect(() => {
    const api = window.onda
    if (!api) return
    return api.onDroppedPaths((paths) => {
      void importPaths(paths)
    })
  }, [importPaths])

  // ── preferências que o main precisa conhecer (bandeja/fechar) ────────────

  useEffect(() => {
    const api = window.onda
    if (!api) return
    void api.syncMainSettings({ closeToTray: lib.settings.closeToTray })
  }, [lib.settings.closeToTray])

  useEffect(() => {
    const api = window.onda
    if (!api) return
    return api.onTrayPreference((closeToTray) => {
      void lib.updateSettings({ closeToTray })
    })
  }, [lib])

  // Aviso único por sessão: o X esconde a janela, o app segue tocando.
  useEffect(() => {
    const api = window.onda
    if (!api) return
    let announced = false
    return api.onHiddenToTray(() => {
      if (announced) return
      announced = true
      pushToast('info', 'Onda segue tocando na bandeja', 'Clique no ícone perto do relógio para voltar (ou Menu da bandeja → Sair).')
    })
  }, [])

  useEffect(() => {
    actions.setCrossfade(lib.settings.crossfade)
  }, [actions, lib.settings.crossfade])

  // ── atalhos de teclado globais (padrões de desktop, não de web) ──────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (e.altKey || e.metaKey) return

      if (e.key === 'Escape' && typing) return // o input cuida dele mesmo

      if (e.code === 'Space') {
        if (typing) return
        e.preventDefault()
        actions.togglePlay()
        return
      }
      if (e.key === '/' && !typing) {
        e.preventDefault()
        const input = document.querySelector<HTMLInputElement>('[data-global-search]')
        input?.focus()
        input?.select()
        return
      }
      if (typing) return

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          actions.skipSeconds(e.shiftKey ? 15 : 5)
          break
        case 'ArrowLeft':
          e.preventDefault()
          actions.skipSeconds(e.shiftKey ? -15 : -5)
          break
        case 'ArrowUp':
          e.preventDefault()
          actions.setVolume(Math.min(1, actions.getAudioElement().volume + 0.05))
          break
        case 'ArrowDown':
          e.preventDefault()
          actions.setVolume(Math.max(0, actions.getAudioElement().volume - 0.05))
          break
        case 'm':
        case 'M':
          actions.toggleMute()
          break
        case 's':
        case 'S': {
          const next = actions.toggleShuffle()
          pushToast('info', `Shuffle ${next ? 'ligado' : 'desligado'}`, next ? 'Faixas rejeitadas ficam fora do sorteio.' : undefined)
          break
        }
        case 'r':
        case 'R': {
          const mode = actions.cyclePlayMode()
          pushToast('info', mode === 'off' ? 'Repetição desligada' : mode === 'all' ? 'Repetindo a fila' : 'Repetindo a faixa')
          break
        }
        case 'l':
        case 'L':
          if (currentTrack) void lib.toggleLike(currentTrack.filePath)
          break
        case 'k':
        case 'K':
          if (currentTrack) void lib.toggleDislike(currentTrack.filePath)
          break
        case 'q':
        case 'Q':
          toggleQueue()
          break
        case 'p':
        case 'P':
          void window.onda?.openMiniPlayer()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, currentTrack, lib, toggleQueue])

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-200"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {!lib.desktop && (
        <div className="flex h-9 shrink-0 items-center justify-center gap-2 border-b border-amber-400/15 bg-amber-400/[0.07] text-[11.5px] text-amber-200/90">
          <MonitorX className="h-3.5 w-3.5" />
          Rodando em browser de desenvolvimento — leitura de disco e codecs nativos só no app Electron (<span className="font-mono">npm run dev</span>).
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar lib={lib} />
        <main className="relative flex min-w-0 flex-1 flex-col bg-zinc-950">
          <TrackList lib={lib} />
          <QueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
        </main>
      </div>

      <PlayerBar
        onToggleLike={onToggleLike}
        onToggleDislike={onToggleDislike}
        onToggleQueue={toggleQueue}
        queueOpen={queueOpen}
        onOpenMini={() => void window.onda?.openMiniPlayer()}
      />

      {/* overlay do drop — border tracejada esmeralda + blur, nada de bounce */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-3 z-[85] flex items-center justify-center rounded-2xl border-2 border-dashed border-emerald-500/50 bg-emerald-500/[0.06] backdrop-blur-[3px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-400/20 bg-zinc-950/70 px-7 py-6 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
            <Music4 className="h-7 w-7 text-emerald-400" />
            <p className="text-[14px] font-semibold text-zinc-50">Solte para adicionar ao Onda</p>
            <p className="text-[11.5px] text-zinc-400">
              Arquivos de áudio entram na biblioteca · pastas passam a ser vigiadas em tempo real
            </p>
          </div>
        </div>
      )}

      <ContextMenuHost />
      <PromptHost />
      <Toaster />
    </div>
  )
}
