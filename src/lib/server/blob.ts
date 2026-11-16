import {
  BlobError,
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del,
  get,
  put
} from '@vercel/blob'
import type { LibraryFile, Track } from '@/lib/types'

export const LIBRARY_PATH = 'data/library.json'
export const MAX_COVER_BYTES = 1_500_000

const EMPTY_LIBRARY: LibraryFile = { version: 1, tracks: [] }

/** O manifesto fica em um store privado, onde `useCache: false` realmente ignora o CDN. */
function metaBlobOptions(): { token: string } {
  const token = process.env.META_READ_WRITE_TOKEN
  if (!token) {
    throw new Error('O armazenamento de metadados (Vercel Blob privado) não está configurado.')
  }
  return { token }
}

export function isBlobConfigured(): boolean {
  const audio = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)
  return audio && Boolean(process.env.META_READ_WRITE_TOKEN)
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof BlobError && /already\s+exists|blob.*exist|pathname.*exists/i.test(error.message)
}

function normalizeTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.url !== 'string' || typeof item.pathname !== 'string') {
    return null
  }

  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback
  const numberOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null

  return {
    id: item.id,
    title: text(item.title, 'Faixa sem título'),
    artist: text(item.artist, 'Artista desconhecido'),
    album: text(item.album, 'Sem álbum'),
    genre: typeof item.genre === 'string' && item.genre.trim() ? item.genre.trim() : null,
    year: numberOrNull(item.year),
    duration: numberOrNull(item.duration) ?? 0,
    bitrate: numberOrNull(item.bitrate),
    sampleRate: numberOrNull(item.sampleRate),
    codec: typeof item.codec === 'string' && item.codec.trim() ? item.codec.trim() : null,
    container: typeof item.container === 'string' && item.container.trim() ? item.container.trim() : null,
    size: numberOrNull(item.size) ?? 0,
    pathname: item.pathname,
    url: item.url,
    downloadUrl: typeof item.downloadUrl === 'string' && item.downloadUrl ? item.downloadUrl : item.url,
    coverUrl: typeof item.coverUrl === 'string' && item.coverUrl ? item.coverUrl : null,
    uploadedAt:
      typeof item.uploadedAt === 'string' && !Number.isNaN(Date.parse(item.uploadedAt))
        ? item.uploadedAt
        : new Date(0).toISOString()
  }
}

function normalizeLibrary(raw: unknown): LibraryFile {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_LIBRARY }
  const record = raw as Record<string, unknown>
  const tracks = Array.isArray(record.tracks)
    ? record.tracks.map(normalizeTrack).filter((track): track is Track => track !== null)
    : []
  return { version: 1, tracks }
}

export async function readLibrary(): Promise<{ library: LibraryFile; etag: string | null }> {
  // O store é privado e `useCache: false` lê direto do storage, sem CDN.
  // Isso é essencial para que uma remoção/adição apareça imediatamente.
  const result = await get(LIBRARY_PATH, {
    access: 'private',
    useCache: false,
    ...metaBlobOptions()
  })
  if (!result) {
    return { library: { ...EMPTY_LIBRARY, tracks: [] }, etag: null }
  }
  if (result.statusCode !== 200 || !result.stream) {
    throw new Error('Não foi possível ler a biblioteca.')
  }

  const raw: unknown = JSON.parse(await new Response(result.stream).text())
  return {
    library: normalizeLibrary(raw),
    // O `get` pode devolver um ETag fraco (W/"...") quando a resposta passa
    // por cache; o `put` com ifMatch exige o ETag forte equivalente.
    etag: result.blob.etag.replace(/^W\//, '')
  }
}

export async function mutateLibrary<T>(
  mutate: (library: LibraryFile) => { library: LibraryFile; result: T }
): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { library, etag } = await readLibrary()
    const { library: next, result } = mutate({
      version: 1,
      tracks: [...library.tracks]
    })

    try {
      await put(LIBRARY_PATH, JSON.stringify(next), {
        access: 'private',
        ...metaBlobOptions(),
        addRandomSuffix: false,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
        ...(etag ? { allowOverwrite: true, ifMatch: etag } : {})
      })
      return result
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || isAlreadyExists(error)) {
        await new Promise((resolve) => setTimeout(resolve, 60 + Math.random() * 120))
        continue
      }
      throw error
    }
  }

  throw new Error('A biblioteca está sendo atualizada por outra pessoa. Tente novamente.')
}

export async function uploadCover(id: string, data: Buffer, mime: string): Promise<string> {
  const normalized = mime === 'image/png' ? 'image/png' : mime === 'image/webp' ? 'image/webp' : 'image/jpeg'
  const ext = normalized === 'image/png' ? 'png' : normalized === 'image/webp' ? 'webp' : 'jpg'
  const blob = await put(`covers/${id}.${ext}`, data, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: normalized,
    cacheControlMaxAge: 60 * 60 * 24 * 365
  })
  return blob.url
}

export async function deleteBlobs(pathnames: string[]): Promise<void> {
  if (!pathnames.length) return
  try {
    await del(pathnames)
  } catch (error) {
    if (!(error instanceof BlobNotFoundError)) throw error
  }
}
