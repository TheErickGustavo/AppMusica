import { useEffect, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ListEnd, ListMusic, Play, X } from 'lucide-react'
import type { Track } from '@shared/music'
import { CoverArt } from './CoverArt'
import {
  useCurrentTrack,
  usePlayerActions,
  usePlayerEngine,
  usePlayerState,
  useShuffleOn,
  useUpcomingItems,
  type UpcomingItem
} from '@/hooks/useAudioPlayer'
import { formatTime } from '@/lib/format'

/* ═══════════════════════════════════════════════════════════════════════════
 * ONDA · QUEUE DRAWER — espelho da fila real do motor:
 * "Tocando agora" + pending ("tocar a seguir") + resto do bag (shuffle e
 * blacklist já aplicados). Clique pula direto; X remove do upcoming.
 *
 * Arquitetura de render: a lista assina apenas `upcoming` (muta quando a
 * fila muda), enquanto o relógio vivo mora num subcomponente minúsculo —
 * 500 linhas nunca re-renderizam a 60fps.
 * ═════════════════════════════════════════════════════════════════════════ */

function NowPlayingClock(): ReactElement {
  const s = usePlayerState()
  return (
    <span className="tnum font-mono text-[10.5px] text-zinc-500">
      {formatTime(s.currentTime)} / {formatTime(s.duration)}
    </span>
  )
}

export function QueueDrawer({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const engine = usePlayerEngine()
  const actions = usePlayerActions()
  const track = useCurrentTrack()
  const upcoming = useUpcomingItems()
  const shuffle = useShuffleOn()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const jumpTo = (t: Track): void => {
    const { queue } = engine.getSnapshot()
    const idx = queue.findIndex((q) => q.filePath === t.filePath)
    if (idx >= 0) actions.playQueueIndex(idx)
    else actions.enqueue([t], 'next')
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-y-0 right-0 z-30 flex w-[340px] flex-col border-l border-white/[0.07] bg-zinc-950/95 backdrop-blur-xl"
          role="complementary"
          aria-label="Fila de reprodução"
        >
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.06] px-4">
            <ListMusic className="h-4 w-4 text-emerald-400" />
            <h2 className="text-[13.5px] font-semibold text-zinc-50">Fila de reprodução</h2>
            <span className="tnum chip ml-auto font-mono text-[10px]">{upcoming.length} na frente</span>
            <button type="button" onClick={onClose} className="icon-btn -mr-1.5" title="Fechar (Q / Esc)">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {track && (
              <div className="mb-3">
                <p className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-emerald-400/90">Tocando agora</p>
                <div className="flex items-center gap-2.5 rounded-lg border border-emerald-400/10 bg-emerald-400/[0.05] px-2 py-2">
                  <CoverArt coverPath={track.coverPath} seed={track.filePath} label={track.title} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate-1 text-[12.5px] font-medium text-emerald-300">{track.title}</div>
                    <div className="truncate-1 text-[11px] text-zinc-500">{track.artist}</div>
                  </div>
                  <NowPlayingClock />
                </div>
              </div>
            )}

            <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-zinc-500">A seguir</p>

            {upcoming.length === 0 ? (
              <div className="mx-2 mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/[0.07] px-4 py-8 text-center">
                <ListEnd className="h-5 w-5 text-zinc-700" />
                <p className="text-[12px] font-medium text-zinc-400">Fila vazia</p>
                <p className="max-w-[220px] text-[11px] leading-relaxed text-zinc-600">
                  Botão direito numa faixa → “Tocar a seguir” / “Adicionar à fila”.
                </p>
              </div>
            ) : (
              <ul>
                {upcoming.map((item: UpcomingItem) => (
                  <li key={item.key}>
                    <div className="group/q flex h-12 cursor-default items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-white/[0.045]" onClick={() => jumpTo(item.track)}>
                      <span className="tnum w-5 shrink-0 text-center font-mono text-[10.5px] text-zinc-600">{item.handle}</span>
                      <CoverArt coverPath={item.track.coverPath} seed={item.track.filePath} label={item.track.title} className="h-8 w-8" rounded="rounded" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate-1 text-[12px] font-medium text-zinc-200">{item.track.title}</div>
                        <div className="truncate-1 text-[10.5px] text-zinc-500">{item.track.artist}</div>
                      </div>
                      {item.source === 'pending' && <span className="chip hidden h-[15px] px-1.5 text-[8.5px] uppercase tracking-wider group-hover/q:inline-flex">manual</span>}
                      <span className="tnum font-mono text-[10px] text-zinc-600">{item.track.duration > 0 ? formatTime(item.track.duration) : ''}</span>
                      <button
                        type="button"
                        title="Remover da fila"
                        onClick={(e) => {
                          e.stopPropagation()
                          actions.removeUpcoming(item)
                        }}
                        className="icon-btn !h-6 !w-6 opacity-0 group-hover/q:opacity-100 hover:!text-rose-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="Tocar agora"
                        onClick={(e) => {
                          e.stopPropagation()
                          jumpTo(item.track)
                        }}
                        className="icon-btn !h-6 !w-6 opacity-0 group-hover/q:opacity-100"
                      >
                        <Play className="h-3 w-3" fill="currentColor" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {shuffle && (
            <footer className="shrink-0 border-t border-white/[0.06] px-4 py-2.5">
              <p className="flex items-center gap-2 text-[10.5px] text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Shuffle ativo — faixas rejeitadas foram excluídas automaticamente do sorteio.
              </p>
            </footer>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
