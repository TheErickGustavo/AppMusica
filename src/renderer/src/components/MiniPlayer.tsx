import { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import type { PlayerBroadcastState } from '@shared/music'
import { CoverArt } from './CoverArt'
import { formatTime } from '@/lib/format'

/* ═══════════════════════════════════════════════════════════════════════════
 * ONDA · MINI PLAYER — janela frameless always-on-top (?mini=1).
 *
 * Este componente roda em OUTRO renderer: ele não tem biblioteca nem engine
 * de áudio. Todo o estado vem por IPC (`player:state`, publicado pela janela
 * principal a cada 400ms) e os botões mandam comandos de volta pelo main.
 * A barra superior é a região de arraste da janela (app-region: drag).
 * ═════════════════════════════════════════════════════════════════════════ */

const DRAG_REGION: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties
const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

export function MiniPlayerBar(): ReactElement {
  const [state, setState] = useState<PlayerBroadcastState | null>(null)
  const api = typeof window !== 'undefined' ? window.onda : undefined

  useEffect(() => {
    if (!api) return
    let alive = true
    void api.requestPlayerState().then((initial) => {
      if (alive && initial) setState(initial)
    })
    const off = api.onPlayerState((next) => setState(next))
    return () => {
      alive = false
      off()
    }
  }, [api])

  const playing = state?.isPlaying ?? false
  const duration = state?.duration ?? 0
  const currentTime = state?.currentTime ?? 0
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0

  const command = useCallback(
    (name: 'toggle' | 'next' | 'previous') => {
      api?.sendPlayerCommand(name)
    },
    [api]
  )

  const closeAndReturn = useCallback(() => {
    void api?.closeMiniPlayer()
    void api?.showMainWindow()
  }, [api])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden border border-white/[0.08] bg-zinc-950/95 text-zinc-200 backdrop-blur-xl" style={DRAG_REGION}>
      <div className="flex min-h-0 flex-1 items-center gap-3 px-3">
        <CoverArt
          coverPath={state?.coverPath ?? null}
          seed={state?.title ?? 'onda-mini'}
          label={state?.title ?? 'Onda'}
          className="h-14 w-14"
          rounded="rounded-lg"
          loading="eager"
        />

        <div className="min-w-0 flex-1">
          <div className="truncate-1 text-[12.5px] font-semibold text-zinc-50">{state?.title ?? 'Nada tocando'}</div>
          <div className="truncate-1 text-[11px] text-zinc-500">{state?.artist ?? 'Onda'}</div>
          <div className="mt-1 flex items-center gap-2 font-mono text-[10px] tabular-nums text-zinc-500">
            <span>{formatTime(currentTime)}</span>
            <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <span className="block h-full rounded-full bg-emerald-400/80" style={{ width: `${progress * 100}%` }} />
            </span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5" style={NO_DRAG}>
          <button type="button" title="Anterior" onClick={() => command('previous')} className="icon-btn !h-7 !w-7">
            <SkipBack className="h-3.5 w-3.5" fill="currentColor" strokeWidth={1.2} />
          </button>
          <button
            type="button"
            title={playing ? 'Pausar' : 'Tocar'}
            onClick={() => command('toggle')}
            className="mx-0.5 flex h-8 w-8 cursor-default items-center justify-center rounded-full bg-zinc-50 text-zinc-950 transition-colors hover:bg-white"
          >
            {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />}
          </button>
          <button type="button" title="Próxima" onClick={() => command('next')} className="icon-btn !h-7 !w-7">
            <SkipForward className="h-3.5 w-3.5" fill="currentColor" strokeWidth={1.2} />
          </button>
          <button
            type="button"
            title="Fechar mini player e voltar para a janela principal"
            onClick={closeAndReturn}
            className="icon-btn !h-7 !w-7 hover:!text-rose-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
