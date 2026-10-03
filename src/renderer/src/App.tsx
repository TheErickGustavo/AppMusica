import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { MonitorX } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { TrackList } from './components/TrackList'
import { PlayerBar } from './components/PlayerBar'
import { QueueDrawer } from './components/QueueDrawer'
import { ContextMenuHost } from './components/ContextMenu'
import { Toaster } from './components/Toaster'
import { AudioEngineProvider, useCurrentTrack, usePlayerActions } from './hooks/useAudioPlayer'
import { useLibrary } from './hooks/useLibrary'
import { pushToast } from './lib/toast'

/* ═══════════════════════════════════════════════════════════════════════════
 * ONDA · App — três painéis: Sidebar (navegação/estatísticas) · Main View
 * (tabela + estante de capas) · Playbar dock. Estado global via hooks:
 * motor de áudio (useSyncExternalStore) + biblioteca (Dexie live-queries).
 * ═════════════════════════════════════════════════════════════════════════ */

function Shell(): ReactElement {
  const lib = useLibrary()
  const actions = usePlayerActions()
  const currentTrack = useCurrentTrack()
  const [queueOpen, setQueueOpen] = useState(false)

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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, currentTrack, lib, toggleQueue])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-200">
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
      />

      <ContextMenuHost />
      <Toaster />
    </div>
  )
}

export default function App(): ReactElement {
  return (
    <AudioEngineProvider>
      <Shell />
    </AudioEngineProvider>
  )
}
