import { memo, useRef, type ReactElement } from 'react'
import { Disc3, X } from 'lucide-react'
import { CoverArt } from './CoverArt'
import { motion } from 'framer-motion'
import { formatCount } from '@/lib/format'

export interface ShelfAlbum {
  album: string
  artist: string
  coverPath: string | null
  tracks: number
  plays: number
  year: number | null
  seed: string
}

interface AlbumShelfProps {
  albums: ShelfAlbum[]
  activeKey: string | null
  onSelect: (filter: { album: string; artist: string }) => void
  onClear: () => void
}

/**
 * Visualizador de capas — estante horizontal de álbuns da view corrente,
 * ordenada por plays. Clicar filtra a tabela; clicar de novo no ativo limpa.
 */
export const AlbumShelf = memo(function AlbumShelf({ albums, activeKey, onSelect, onClear }: AlbumShelfProps): ReactElement {
  const railRef = useRef<HTMLDivElement>(null)

  // scroll horizontal com a roda do mouse (desktop-app behavior)
  const onWheel = (e: React.WheelEvent): void => {
    const el = railRef.current
    if (!el) return
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
      el.scrollLeft += e.deltaY
    }
  }

  if (albums.length <= 1) return <div />

  return (
    <div className="relative mt-3 shrink-0">
      <div className="flex items-center justify-between px-6">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          <Disc3 className="mr-1.5 inline h-3 w-3 align-[-2px]" />
          Capas
        </span>
        {activeKey && (
          <button type="button" onClick={onClear} className="chip gap-1 hover:border-rose-400/40 hover:text-rose-300">
            filtrando por álbum <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <div
        ref={railRef}
        onWheel={onWheel}
        className="no-scrollbar mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="listbox"
        aria-label="Álbuns"
      >
        {albums.map((a) => {
          const key = `${a.album}\u0000${a.artist}`
          const active = key === activeKey
          return (
            <motion.button
              type="button"
              key={key}
              layout
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => (active ? onClear() : onSelect({ album: a.album, artist: a.artist }))}
              title={`${a.album} — ${a.artist}`}
              className={`group/album w-[132px] shrink-0 snap-start cursor-default rounded-lg p-2 text-left outline-none transition-colors duration-150 ${
                active ? 'bg-emerald-500/[0.07] ring-1 ring-emerald-400/25' : 'hover:bg-white/[0.04]'
              }`}
            >
              <div className="relative">
                <CoverArt
                  coverPath={a.coverPath}
                  seed={a.seed}
                  label={a.album}
                  className="h-[116px] w-[116px] transition-transform duration-200 ease-precise group-hover/album:scale-[1.03]"
                  rounded="rounded-lg"
                  loading="lazy"
                />
                {a.plays > 0 && (
                  <span className="absolute bottom-1 right-1 rounded-md border border-white/[0.08] bg-zinc-950/80 px-1.5 py-0.5 font-mono text-[9.5px] tabular-nums text-zinc-300 backdrop-blur-sm">
                    {formatCount(a.plays)}×
                  </span>
                )}
              </div>
              <div className="mt-2">
                <div className={`truncate-1 text-[11.5px] font-medium ${active ? 'text-emerald-300' : 'text-zinc-200'}`}>{a.album}</div>
                <div className="truncate-1 text-[10.5px] text-zinc-500">
                  {a.artist}
                  {a.year ? ` · ${a.year}` : ''} · {a.tracks} faixa{a.tracks > 1 ? 's' : ''}
                </div>
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
})
