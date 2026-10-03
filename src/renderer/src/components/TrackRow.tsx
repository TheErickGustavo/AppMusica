import { memo, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import { MoreHorizontal, Pause, Play } from 'lucide-react'
import type { Track } from '@shared/music'
import { CoverArt } from './CoverArt'
import { FeedbackButtons } from './FeedbackButtons'
import { formatCount, formatRelativeDate, formatTime } from '@/lib/format'

export const GRID_TEMPLATE =
  'grid grid-cols-[26px_minmax(0,2.3fr)_minmax(0,1.4fr)_minmax(0,1.5fr)_92px_64px_118px] items-center gap-x-3'

interface TrackRowProps {
  track: Track
  displayNumber: number
  isCurrent: boolean
  isPlaying: boolean
  isSelected: boolean
  height: number
  isDisliked: boolean
  onSelect: (track: Track) => void
  onPlay: (track: Track) => void
  onContextMenu: (e: ReactMouseEvent, track: Track) => void
  onToggleLike: (track: Track) => void
  onToggleDislike: (track: Track) => void
  onMore: (e: ReactMouseEvent, track: Track) => void
}

/** Linha da tabela — memo puro: 10k faixas re-renderizam só as janelas visíveis. */
export const TrackRow = memo(function TrackRow({
  track,
  displayNumber,
  isCurrent,
  isPlaying,
  isSelected,
  height,
  isDisliked,
  onSelect,
  onPlay,
  onContextMenu,
  onToggleLike,
  onToggleDislike,
  onMore
}: TrackRowProps): ReactElement {
  return (
    <div
      role="row"
      aria-current={isCurrent ? 'true' : undefined}
      title={`${track.filePath}\n${track.codec ?? ''}${track.bitrate ? ` · ${track.bitrate} kbps` : ''}${track.sampleRate ? ` · ${track.sampleRate} Hz` : ''}`}
      onClick={() => onSelect(track)}
      onDoubleClick={() => onPlay(track)}
      onContextMenu={(e) => onContextMenu(e, track)}
      style={{ height }}
      className={`group/row relative cursor-default select-none border-b border-white/[0.025] px-5 ${GRID_TEMPLATE} transition-colors duration-100 ${
        isCurrent ? 'bg-white/[0.05]' : isSelected ? 'bg-white/[0.045]' : 'hover:bg-white/[0.035]'
      }`}
    >
      {isCurrent && <span className="absolute inset-y-0 left-0 w-[2.5px] rounded-full bg-emerald-400" />}

      {/* nº / estado */}
      <div className="relative flex h-full items-center justify-center text-[12px]">
        {isCurrent ? (
          <>
            <div className={`flex h-3.5 items-end gap-[2px] ${isPlaying ? '' : 'eq-paused opacity-60'}`} aria-hidden>
              <span className="eq-bar w-[2.5px] rounded-sm bg-emerald-400" style={{ height: '100%' }} />
              <span className="eq-bar w-[2.5px] rounded-sm bg-emerald-400" style={{ height: '100%' }} />
              <span className="eq-bar w-[2.5px] rounded-sm bg-emerald-400" style={{ height: '100%' }} />
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onPlay(track)
              }}
              className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 text-zinc-100 opacity-0 transition-opacity group-hover/row:opacity-100"
              title={isPlaying ? 'Pausar' : 'Retomar'}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
            </button>
          </>
        ) : (
          <>
            <span className={`tnum font-mono text-zinc-600 group-hover/row:opacity-0 ${isDisliked ? 'text-zinc-700' : ''}`}>{displayNumber}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onPlay(track)
              }}
              className="absolute inset-0 flex items-center justify-center text-zinc-100 opacity-0 transition-opacity group-hover/row:opacity-100"
              title="Tocar"
            >
              <Play className="h-3.5 w-3.5" fill="currentColor" />
            </button>
          </>
        )}
      </div>

      {/* capa + título */}
      <div className="flex min-w-0 items-center gap-3">
        <CoverArt coverPath={track.coverPath} seed={track.filePath} label={track.title} className="h-9 w-9" rounded="rounded" />
        <div className="min-w-0">
          <div className={`truncate-1 text-[13px] font-medium ${isCurrent ? 'text-emerald-400' : isDisliked ? 'text-zinc-500' : 'text-zinc-100'}`}>
            {track.title}
          </div>
          <div className="truncate-1 text-[11px] text-zinc-500">{track.artist}</div>
        </div>
      </div>

      {/* artista (dedup visual: artista tem peso próprio na ordenação) */}
      <div className="truncate-1 text-[12.5px] text-zinc-400">{track.artist}</div>

      {/* álbum */}
      <div className="flex min-w-0 flex-col">
        <span className="truncate-1 text-[12.5px] text-zinc-400">{track.album}</span>
        <span className="text-[10.5px] text-zinc-600">
          {track.year ?? '—'}
          {track.genre ? ` · ${track.genre}` : ''}
        </span>
      </div>

      {/* plays */}
      <div className="flex items-center justify-end gap-1.5" title={`Última audição: ${formatRelativeDate(track.lastPlayedAt)}`}>
        {track.playCount > 0 ? (
          <>
            <Play className="h-2.5 w-2.5 text-zinc-600" fill="currentColor" />
            <span className={`tnum font-mono text-[12px] ${track.playCount >= 10 ? 'text-zinc-200' : 'text-zinc-400'}`}>{formatCount(track.playCount)}</span>
          </>
        ) : (
          <span className="text-[11px] text-zinc-700">—</span>
        )}
      </div>

      {/* duração */}
      <div className="tnum text-right font-mono text-[12px] text-zinc-400">{track.duration > 0 ? formatTime(track.duration) : '—'}</div>

      {/* feedback + menu */}
      <div className="flex items-center justify-end gap-0.5">
        <div className={track.feedback === 'neutral' ? 'opacity-0 transition-opacity group-hover/row:opacity-100' : ''}>
          <FeedbackButtons
            feedback={track.feedback}
            onToggleLike={() => onToggleLike(track)}
            onToggleDislike={() => onToggleDislike(track)}
          />
        </div>
        <button
          type="button"
          title="Mais ações"
          onClick={(e) => {
            e.stopPropagation()
            onMore(e, track)
          }}
          className="icon-btn !h-7 !w-7 opacity-0 transition-opacity group-hover/row:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
})
