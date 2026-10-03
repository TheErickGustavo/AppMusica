import type { ReactElement } from 'react'
import { motion } from 'framer-motion'
import {
  Heart,
  ListMusic,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  ThumbsDown,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import { CoverArt } from './CoverArt'
import { Slider } from './Slider'
import { usePlayerActions, usePlayerState } from '@/hooks/useAudioPlayer'
import { formatBitrate, formatTime, formatTimePrecise } from '@/lib/format'

/* ═══════════════════════════════════════════════════════════════════════════
 * ONDA · PLAYBAR — dock persistente: transporte tátil, scrubber de precisão
 * (ms no tooltip durante o arraste), volume, badges de like/dislike,
 * badge de qualidade e painel de fila. Única assinante do relógio de 60fps.
 * ═════════════════════════════════════════════════════════════════════════ */

export function PlayerBar({
  onToggleLike,
  onToggleDislike,
  onToggleQueue,
  queueOpen,
  onOpenMini
}: {
  onToggleLike: (filePath: string) => void
  onToggleDislike: (filePath: string) => void
  onToggleQueue: () => void
  queueOpen: boolean
  onOpenMini: () => void
}): ReactElement {
  const s = usePlayerState()
  const actions = usePlayerActions()

  const hasTrack = s.track !== null
  const duration = s.duration > 0 ? s.duration : (s.track?.duration ?? 0)
  const playing = s.status === 'playing'
  const loading = s.status === 'loading' || s.status === 'buffering'
  const VolIcon = s.muted || s.effectiveVolume === 0 ? VolumeX : s.effectiveVolume < 0.45 ? Volume1 : Volume2
  const quality = hasTrack ? formatBitrate(s.track?.bitrate ?? null, s.track?.codec ?? null) : null

  return (
    <footer className="relative z-20 flex h-[88px] shrink-0 items-center gap-4 border-t border-white/[0.06] bg-zinc-950/85 px-4 backdrop-blur-md">
      {/* fio de luz no topo do dock — vivo só durante a reprodução */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent transition-opacity duration-700 ${
          playing ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* ── faixa atual ── */}
      <div className="flex w-[27%] min-w-[240px] items-center gap-3">
        <motion.div
          key={s.track?.filePath ?? 'idle'}
          initial={{ opacity: 0, scale: 0.96, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <CoverArt
            coverPath={s.track?.coverPath ?? null}
            seed={s.track?.filePath ?? 'onda-idle'}
            label={s.track?.title ?? 'Onda'}
            className="h-12 w-12"
            rounded="rounded-lg"
            loading="eager"
          />
        </motion.div>
        <div className="min-w-0 flex-1">
          {hasTrack ? (
            <>
              <div className="flex items-center gap-2">
                <span className="truncate-1 text-[13px] font-semibold text-zinc-50">{s.track?.title}</span>
                {quality && (
                  <span className="chip hidden h-[17px] shrink-0 px-1.5 font-mono text-[9px] tracking-wide xl:inline-flex" title="Qualidade do arquivo">
                    {quality}
                  </span>
                )}
              </div>
              <div className="truncate-1 text-[11.5px] text-zinc-500">
                {s.track?.artist}
                {s.track?.album ? <span className="text-zinc-600"> — {s.track.album}</span> : null}
              </div>
            </>
          ) : (
            <>
              <div className="text-[13px] font-medium text-zinc-500">Nada tocando</div>
              <div className="text-[11px] text-zinc-600">Dê play numa faixa da lista</div>
            </>
          )}
        </div>

        {/* badges de feedback no dock */}
        <div className={hasTrack ? 'mr-1 shrink-0' : 'pointer-events-none mr-1 shrink-0 opacity-30'}>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-pressed={s.track?.feedback === 'liked'}
              title="Favoritar (L)"
              onClick={() => s.track && onToggleLike(s.track.filePath)}
              className={`icon-btn h-8 w-8 ${s.track?.feedback === 'liked' ? '!text-amber-400 hover:!bg-amber-400/10' : ''}`}
            >
              <Heart className="h-[17px] w-[17px]" fill={s.track?.feedback === 'liked' ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              aria-pressed={s.track?.feedback === 'disliked'}
              title="Rejeitar — o shuffle pula (K)"
              onClick={() => s.track && onToggleDislike(s.track.filePath)}
              className={`icon-btn h-8 w-8 ${s.track?.feedback === 'disliked' ? '!text-rose-400 hover:!bg-rose-400/10' : ''}`}
            >
              <ThumbsDown className="h-[17px] w-[17px]" fill={s.track?.feedback === 'disliked' ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>
      </div>

      {/* ── transporte + scrubber ── */}
      <div className="flex min-w-0 flex-[1.7] flex-col items-center justify-center gap-1.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Aleatório (S) — rejeitadas nunca entram no bag"
            aria-pressed={s.shuffle}
            onClick={actions.toggleShuffle}
            className={`icon-btn relative ${s.shuffle ? '!text-emerald-400' : ''}`}
          >
            <Shuffle className="h-[15px] w-[15px]" />
            {s.shuffle && <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-400" />}
          </button>
          <button type="button" title="Anterior" onClick={actions.previous} className="icon-btn h-9 w-9">
            <SkipBack className="h-[18px] w-[18px]" fill="currentColor" strokeWidth={1.2} />
          </button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.1 }}
            title={playing ? 'Pausar (Espaço)' : 'Tocar (Espaço)'}
            onClick={actions.togglePlay}
            className="mx-0.5 flex h-9 w-9 cursor-default items-center justify-center rounded-full bg-zinc-50 text-zinc-950 shadow-[0_2px_10px_rgba(0,0,0,0.45)] transition-colors duration-150 hover:bg-white"
          >
            {hasTrack && playing ? (
              <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} />
            ) : loading && hasTrack ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
            ) : (
              <Play className="ml-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />
            )}
          </motion.button>
          <button type="button" title="Próxima" onClick={actions.next} className="icon-btn h-9 w-9">
            <SkipForward className="h-[18px] w-[18px]" fill="currentColor" strokeWidth={1.2} />
          </button>
          <button
            type="button"
            title={`Repetição: ${s.playMode === 'off' ? 'desligada' : s.playMode === 'all' ? 'fila toda' : 'faixa atual'} (R)`}
            aria-pressed={s.playMode !== 'off'}
            onClick={actions.cyclePlayMode}
            className={`icon-btn relative ${s.playMode !== 'off' ? '!text-emerald-400' : ''}`}
          >
            {s.playMode === 'one' ? <Repeat1 className="h-[15px] w-[15px]" /> : <Repeat className="h-[15px] w-[15px]" />}
            {s.playMode !== 'off' && <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-400" />}
          </button>
        </div>

        <div className="flex w-full items-center gap-2.5">
          <span className="tnum w-10 shrink-0 text-right font-mono text-[11px] text-zinc-400">{formatTime(s.currentTime)}</span>
          <div className="min-w-0 flex-1" onPointerDownCapture={() => hasTrack && actions.setScrubBlocked(true)}>
            <Slider
              label="Progresso da faixa"
              value={s.currentTime}
              max={duration}
              disabled={!hasTrack}
              fillClassName={`bg-zinc-100 group-hover/slider:bg-emerald-400 ${playing ? '' : 'transition-[width] duration-150'}`}
              onInput={(v) => hasTrack && actions.seekLive(v)}
              onCommit={(v) => {
                if (!hasTrack) return
                actions.seekTo(v)
                actions.setScrubBlocked(false)
              }}
              tooltip={(v) => formatTimePrecise(v)}
            />
          </div>
          <span className="tnum w-10 shrink-0 font-mono text-[11px] text-zinc-400">{formatTime(duration)}</span>
        </div>
      </div>

      {/* ── fila + mini player + volume ── */}
      <div className="flex w-[23%] min-w-[210px] items-center justify-end gap-1.5">
        <button
          type="button"
          title="Mini player flutuante (P) — toca por cima dos outros apps"
          onClick={onOpenMini}
          className="icon-btn"
        >
          <PictureInPicture2 className="h-[17px] w-[17px]" />
        </button>
        <button
          type="button"
          title="Fila de reprodução (Q)"
          onClick={onToggleQueue}
          className={`icon-btn relative ${queueOpen ? '!bg-white/[0.07] !text-zinc-100' : ''}`}
        >
          <ListMusic className="h-[17px] w-[17px]" />
          {s.upcoming.length > 0 && (
            <span className="tnum absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-0.5 font-mono text-[8.5px] font-bold text-zinc-950">
              {s.upcoming.length > 99 ? '99' : s.upcoming.length}
            </span>
          )}
        </button>
        <button type="button" title="Silenciar (M)" onClick={actions.toggleMute} className="icon-btn">
          <VolIcon className="h-[17px] w-[17px]" />
        </button>
        <div className="w-24">
          <Slider
            label="Volume"
            value={s.muted ? 0 : s.volume}
            max={1}
            fillClassName="bg-zinc-300 group-hover/slider:bg-zinc-50"
            onInput={(v) => actions.setVolume(v)}
            onCommit={(v) => actions.setVolume(v)}
            tooltip={(v) => `${Math.round(v * 100)}%`}
            heightClass="h-[3px]"
          />
        </div>
      </div>
    </footer>
  )
}
