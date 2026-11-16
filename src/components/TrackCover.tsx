/* eslint-disable @next/next/no-img-element */
import { AudioLines } from 'lucide-react'
import { coverGradient } from '@/lib/format'
import type { Track } from '@/lib/types'

export function TrackCover({
  track,
  className = 'h-10 w-10',
  rounded = 'rounded-lg'
}: {
  track: Track
  className?: string
  rounded?: string
}): React.ReactElement {
  return (
    <div
      className={`relative shrink-0 overflow-hidden border border-white/10 bg-zinc-900 ${rounded} ${className}`}
    >
      {track.coverUrl ? (
        <img
          src={track.coverUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ background: coverGradient(track.id || track.title) }}
          aria-hidden
        >
          <AudioLines className="h-1/2 w-1/2 text-white/75" strokeWidth={1.6} />
        </div>
      )}
    </div>
  )
}
