'use client'

import type { CSSProperties } from 'react'
import {
  Download,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX
} from 'lucide-react'
import { formatTime } from '@/lib/format'
import type { Track } from '@/lib/types'
import { TrackCover } from './TrackCover'

function rangeStyle(value: number): CSSProperties {
  return { '--value': `${Math.max(0, Math.min(100, value))}%` } as CSSProperties
}

export function PlayerBar({
  track,
  playing,
  position,
  duration,
  volume,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onVolume
}: {
  track: Track | null
  playing: boolean
  position: number
  duration: number
  volume: number
  onTogglePlay: () => void
  onPrev: () => void
  onNext: () => void
  onSeek: (value: number) => void
  onVolume: (value: number) => void
}): React.ReactElement | null {
  if (!track) return null

  const max = Math.max(duration || track.duration || 0, 0.1)
  const current = Math.min(Math.max(position, 0), max)
  const seekPercent = (current / max) * 100
  const volumePercent = volume * 100

  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.09] bg-zinc-950/90 backdrop-blur-2xl">
      <div className="mx-auto max-w-6xl px-4 pb-1.5 pt-2 sm:h-20 sm:px-6 sm:py-0">
        {/* Mobile */}
        <div className="sm:hidden">
          <div className="flex items-center gap-3">
            <TrackCover track={track} className="h-10 w-10" rounded="rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-zinc-100">{track.title}</p>
              <p className="truncate text-[11px] text-zinc-500">{track.artist}</p>
            </div>
            <button
              type="button"
              onClick={onPrev}
              className="icon-btn h-8 w-8"
              aria-label="Música anterior"
            >
              <SkipBack className="h-4 w-4" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={onTogglePlay}
              className="grid h-10 w-10 place-items-center rounded-full bg-emerald-400 text-emerald-950 shadow-lg shadow-emerald-500/20 transition active:scale-95"
              aria-label={playing ? 'Pausar' : 'Tocar'}
            >
              {playing ? (
                <Pause className="h-4 w-4" fill="currentColor" />
              ) : (
                <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={onNext}
              className="icon-btn h-8 w-8"
              aria-label="Próxima música"
            >
              <SkipForward className="h-4 w-4" fill="currentColor" />
            </button>
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <span className="w-9 text-right font-mono text-[10px] tabular-nums text-zinc-500">
              {formatTime(current)}
            </span>
            <input
              type="range"
              min={0}
              max={max}
              step={0.1}
              value={current}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="range h-1"
              style={rangeStyle(seekPercent)}
              aria-label="Posição da música"
              disabled={duration <= 0 && track.duration <= 0}
            />
            <span className="w-9 font-mono text-[10px] tabular-nums text-zinc-500">
              {formatTime(duration || track.duration)}
            </span>
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden h-20 grid-cols-[minmax(0,1fr)_minmax(300px,1.5fr)_minmax(0,1fr)] items-center gap-4 sm:grid">
          <div className="flex min-w-0 items-center gap-3">
            <TrackCover track={track} className="h-11 w-11" rounded="rounded-lg" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-zinc-100" title={track.title}>
                {track.title}
              </p>
              <p className="truncate text-[11.5px] text-zinc-500" title={`${track.artist} · ${track.album}`} style={{ maxWidth: '180px' }}>
                {track.artist}
                <span className="text-zinc-700"> · {track.album}</span>
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col items-center gap-1.5">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onPrev}
                className="icon-btn h-8 w-8"
                aria-label="Música anterior"
                title="Anterior"
              >
                <SkipBack className="h-4 w-4" fill="currentColor" />
              </button>
              <button
                type="button"
                onClick={onTogglePlay}
                className="grid h-10 w-10 place-items-center rounded-full bg-emerald-400 text-emerald-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 active:scale-95"
                aria-label={playing ? 'Pausar' : 'Tocar'}
                title={playing ? 'Pausar' : 'Tocar'}
              >
                {playing ? (
                  <Pause className="h-4 w-4" fill="currentColor" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
                )}
              </button>
              <button
                type="button"
                onClick={onNext}
                className="icon-btn h-8 w-8"
                aria-label="Próxima música"
                title="Próxima"
              >
                <SkipForward className="h-4 w-4" fill="currentColor" />
              </button>
            </div>

            <div className="flex w-full max-w-[430px] items-center gap-2">
              <span className="w-10 text-right font-mono text-[10.5px] tabular-nums text-zinc-500">
                {formatTime(current)}
              </span>
              <input
                type="range"
                min={0}
                max={max}
                step={0.1}
                value={current}
                onChange={(event) => onSeek(Number(event.target.value))}
                className="range"
                style={rangeStyle(seekPercent)}
                aria-label="Posição da música"
                disabled={duration <= 0 && track.duration <= 0}
              />
              <span className="w-10 font-mono text-[10.5px] tabular-nums text-zinc-500">
                {formatTime(duration || track.duration)}
              </span>
            </div>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onVolume(volume > 0 ? 0 : 0.9)}
              className="icon-btn h-8 w-8"
              aria-label={volume > 0 ? 'Silenciar' : 'Ativar som'}
              title={volume > 0 ? 'Silenciar' : 'Ativar som'}
            >
              {volume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => onVolume(Number(event.target.value))}
              className="range w-24"
              style={rangeStyle(volumePercent)}
              aria-label="Volume"
            />
            <a
              href={track.downloadUrl}
              className="icon-btn h-8 w-8"
              title="Baixar música"
              aria-label={`Baixar ${track.title}`}
            >
              <Download className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
