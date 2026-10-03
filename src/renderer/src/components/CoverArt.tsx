import { memo, useState } from 'react'
import { coverUrl } from '@/lib/media'
import { smartCoverDataUrl } from '@/lib/smartCover'

interface CoverArtProps {
  /** Caminho absoluto da capa em cache (ou null → arte gerada). */
  coverPath: string | null
  /** Seed determinístico para a arte gerada (filePath ou chave do álbum). */
  seed: string
  label: string
  className?: string
  rounded?: string
  loading?: 'lazy' | 'eager'
  draggable?: boolean
}

/**
 * Capa real quando existe; caso contrário, arte geométrica vetorial gerada
 * pelo hash do nome — zero broken-image, zero template genérico.
 */
export const CoverArt = memo(function CoverArt({
  coverPath,
  seed,
  label,
  className = 'h-10 w-10',
  rounded = 'rounded-md',
  loading = 'lazy',
  draggable = false
}: CoverArtProps) {
  const [failed, setFailed] = useState(false)
  const src = coverPath && !failed ? coverUrl(coverPath) : smartCoverDataUrl(seed, label)

  return (
    <div className={`${className} relative shrink-0 overflow-hidden ${rounded} border border-white/[0.06] bg-zinc-900`}>
      <img
        src={src}
        alt=""
        aria-hidden
        loading={loading}
        draggable={draggable}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  )
})
