'use client'

import { Download, ListMusic, Play, SearchX, Trash2 } from 'lucide-react'
import { formatTime } from '@/lib/format'
import type { Track } from '@/lib/types'
import { TrackCover } from './TrackCover'

function EqBars({ paused = false }: { paused?: boolean }): React.ReactElement {
  return (
    <div
      className={`flex h-3.5 items-end gap-[2px] ${paused ? 'eq-paused opacity-60' : ''}`}
      aria-hidden
    >
      <span className="eq-bar w-[2.5px] rounded-sm bg-emerald-400" style={{ height: '100%' }} />
      <span className="eq-bar w-[2.5px] rounded-sm bg-emerald-400" style={{ height: '100%' }} />
      <span className="eq-bar w-[2.5px] rounded-sm bg-emerald-400" style={{ height: '100%' }} />
    </div>
  )
}

function SkeletonRows(): React.ReactElement {
  return (
    <div className="divide-y divide-white/[0.035]">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 px-3 py-3 sm:grid sm:grid-cols-[32px_minmax(0,2.2fr)_minmax(0,1.2fr)_64px_76px] sm:px-4"
        >
          <div className="h-4 w-4 animate-pulse rounded bg-white/[0.06]" />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-white/[0.06]" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.06]" />
              <div className="mt-1.5 h-2.5 w-1/3 animate-pulse rounded bg-white/[0.04]" />
            </div>
          </div>
          <div className="hidden h-3 w-2/3 animate-pulse rounded bg-white/[0.04] sm:block" />
          <div className="hidden h-3 w-10 animate-pulse rounded bg-white/[0.04] sm:block" />
          <div className="h-3 w-12 animate-pulse rounded bg-white/[0.04]" />
        </div>
      ))}
    </div>
  )
}

export function TrackList({
  tracks,
  loading,
  currentId,
  playing,
  query,
  onPlay,
  onDelete
}: {
  tracks: Track[]
  loading: boolean
  currentId: string | null
  playing: boolean
  query: string
  onPlay: (track: Track) => void
  onDelete: (track: Track) => void
}): React.ReactElement {
  if (loading) return <SkeletonRows />

  if (tracks.length === 0) {
    const searching = query.trim().length > 0
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.035]">
          {searching ? (
            <SearchX className="h-6 w-6 text-zinc-500" />
          ) : (
            <ListMusic className="h-6 w-6 text-zinc-500" />
          )}
        </div>
        <h3 className="mt-4 text-[14px] font-medium text-zinc-200">
          {searching ? 'Nenhuma música encontrada' : 'Sua biblioteca está vazia'}
        </h3>
        <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-zinc-500">
          {searching
            ? `Não encontramos nada para “${query.trim()}”. Tente buscar por outro título, artista ou álbum.`
            : 'Arraste seus MP3, M4A, FLAC ou WAV para a área de envio acima. Eles ficam disponíveis para você e seu amigo.'}
        </p>
      </div>
    )
  }

  return (
    <div role="table" aria-label="Biblioteca de músicas">
      <div
        role="row"
        className="hidden border-b border-white/[0.05] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-600 sm:grid sm:grid-cols-[32px_minmax(0,2.2fr)_minmax(0,1.2fr)_64px_76px] sm:items-center sm:gap-3"
      >
        <span>#</span>
        <span>Faixa</span>
        <span>Álbum</span>
        <span className="text-right">Duração</span>
        <span />
      </div>

      {tracks.map((track, index) => {
        const isCurrent = track.id === currentId
        return (
          <div
            key={track.id}
            role="row"
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => onPlay(track)}
            className={`group grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_72px] items-center gap-2.5 border-b border-white/[0.035] px-3 py-2.5 transition-colors last:border-b-0 sm:grid-cols-[32px_minmax(0,2.2fr)_minmax(0,1.2fr)_64px_76px] sm:gap-3 sm:px-4 ${
              isCurrent ? 'bg-emerald-400/[0.065]' : 'hover:bg-white/[0.035]'
            }`}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onPlay(track)
              }}
              className="relative flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 outline-none transition hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-emerald-400/30"
              aria-label={isCurrent && playing ? `Pausar ${track.title}` : `Tocar ${track.title}`}
              title={isCurrent && playing ? 'Pausar' : 'Tocar'}
            >
              {isCurrent ? (
                <>
                  <span className="transition group-hover:opacity-0">
                    <EqBars paused={!playing} />
                  </span>
                  <Play
                    className="absolute h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100"
                    fill="currentColor"
                  />
                </>
              ) : (
                <>
                  <span className="text-[11px] tabular-nums text-zinc-600 transition group-hover:opacity-0">
                    {index + 1}
                  </span>
                  <Play
                    className="absolute h-3.5 w-3.5 text-zinc-100 opacity-0 transition group-hover:opacity-100"
                    fill="currentColor"
                  />
                </>
              )}
            </button>

            <div className="flex min-w-0 items-center gap-3">
              <TrackCover track={track} className="h-10 w-10" />
              <div className="min-w-0">
                <div
                  className={`truncate text-[13px] font-medium ${
                    isCurrent ? 'text-emerald-400' : 'text-zinc-100'
                  }`}
                  title={track.title}
                >
                  {track.title}
                </div>
                <div className="truncate text-[11.5px] text-zinc-500" title={track.artist}>
                  {track.artist}
                  <span className="text-zinc-700 sm:hidden"> · {formatTime(track.duration)}</span>
                </div>
              </div>
            </div>

            <div className="hidden min-w-0 sm:block">
              <div className="truncate text-[12.5px] text-zinc-400" title={track.album} style={{ maxWidth: '180px' }}>
                {track.album}
              </div>
              <div className="truncate text-[10.5px] text-zinc-600">
                {track.year ?? '—'}
                {track.genre ? ` · ${track.genre}` : ''}
              </div>
            </div>

            <div className="hidden text-right font-mono text-[12px] tabular-nums text-zinc-400 sm:block">
              {track.duration > 0 ? formatTime(track.duration) : '—'}
            </div>

            <div className="flex items-center justify-end gap-0.5">
              <a
                href={track.downloadUrl}
                onClick={(event) => event.stopPropagation()}
                className="icon-btn h-7 w-7 opacity-60 sm:opacity-0 sm:group-hover:opacity-100"
                title="Baixar música"
                aria-label={`Baixar ${track.title}`}
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onDelete(track)
                }}
                className="icon-btn h-7 w-7 text-zinc-500 opacity-60 hover:text-rose-300 sm:opacity-0 sm:group-hover:opacity-100"
                title="Remover da biblioteca"
                aria-label={`Remover ${track.title}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
