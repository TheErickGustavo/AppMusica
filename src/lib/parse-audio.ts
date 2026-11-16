import { parseBlob } from 'music-metadata'
import { titleFromFilename } from '@/lib/media'

export interface ParsedAudio {
  title: string
  artist: string
  album: string
  genre: string | null
  year: number | null
  duration: number
  bitrate: number | null
  sampleRate: number | null
  codec: string | null
  container: string | null
  coverBase64: string | null
  coverMime: string | null
}

const MAX_COVER_BYTES = 1_500_000

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function cleanCoverMime(value: string): string | null {
  const mime = value.toLowerCase().trim()
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'image/jpeg'
  if (mime === 'image/png') return 'image/png'
  if (mime === 'image/webp') return 'image/webp'
  return null
}

function fallback(file: File): ParsedAudio {
  return {
    title: titleFromFilename(file.name),
    artist: 'Artista desconhecido',
    album: 'Sem álbum',
    genre: null,
    year: null,
    duration: 0,
    bitrate: null,
    sampleRate: null,
    codec: null,
    container: null,
    coverBase64: null,
    coverMime: null
  }
}

export async function extractAudioMetadata(file: File): Promise<ParsedAudio> {
  const base = fallback(file)

  try {
    const metadata = await parseBlob(file, { duration: true, skipCovers: false })
    const common = metadata.common
    const format = metadata.format

    let coverBase64: string | null = null
    let coverMime: string | null = null
    const picture = common.picture?.[0]
    if (picture && picture.data.length > 0 && picture.data.length <= MAX_COVER_BYTES) {
      coverMime = cleanCoverMime(picture.format)
      if (coverMime) {
        try {
          coverBase64 = toBase64(picture.data)
        } catch {
          coverBase64 = null
          coverMime = null
        }
      }
    }

    const duration = typeof format.duration === 'number' && Number.isFinite(format.duration)
      ? format.duration
      : 0
    const bitrate = typeof format.bitrate === 'number' && Number.isFinite(format.bitrate)
      ? Math.round(format.bitrate / 1000)
      : null

    return {
      title: common.title?.trim() || base.title,
      artist: common.artist?.trim() || common.albumartist?.trim() || base.artist,
      album: common.album?.trim() || base.album,
      genre: common.genre?.[0]?.trim() || null,
      year: typeof common.year === 'number' ? common.year : null,
      duration,
      bitrate,
      sampleRate: typeof format.sampleRate === 'number' ? format.sampleRate : null,
      codec: format.codec?.trim() || null,
      container: format.container?.trim() || null,
      coverBase64,
      coverMime
    }
  } catch {
    return base
  }
}
