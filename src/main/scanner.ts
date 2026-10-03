import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { basename, dirname, extname, join } from 'path'
import { app } from 'electron'
import { parseFile } from 'music-metadata'
import type { ScanResponse, TrackScanInput } from '@shared/music'

/** Formatos suportados nativamente pelo Chromium do Electron no Windows. */
const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.mp4',
  '.aac',
  '.wav',
  '.wave',
  '.ogg',
  '.oga',
  '.opus',
  '.aiff',
  '.aif',
  '.webm'
])

/** Capas extraídas ficam num cache de disco — IndexedDB guarda só metadados. */
export const COVERS_DIR = join(app.getPath('userData'), 'covers')

const MAX_COVER_BYTES = 8 * 1024 * 1024 // ignora anexos absurdos (>8MB)

class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelled')
    this.name = 'ScanCancelledError'
  }
}

let cancelRequested = false

export function cancelActiveScan(): void {
  cancelRequested = true
}

type ProgressFn = (p: { stage: 'walk' | 'parse' | 'done'; done: number; total: number; current: string }) => void

/** Coleta recursiva de arquivos de áudio, ignorando itens ocultos/de sistema. */
async function walk(dir: string, acc: string[], budget: { files: number }): Promise<void> {
  let handle
  try {
    handle = await fs.opendir(dir)
  } catch {
    return // pasta inacessível/sem permissão — segue o baile
  }
  for await (const entry of handle) {
    if (entry.name.startsWith('.') || entry.name === 'desktop.ini' || entry.name === 'Thumbs.db') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, acc, budget)
    } else if (entry.isFile()) {
      if (!AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
      acc.push(full)
      budget.files++
      if (budget.files % 400 === 0) throwIfCancelled()
    }
  }
}

function throwIfCancelled(): void {
  if (cancelRequested) throw new ScanCancelledError()
}

/** Pool assíncrono com limite de concorrência (evita thrash de disco). */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => (async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i] as T, i)
    }
  })())
  await Promise.all(workers)
  return results
}

function stableHash(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}

function pictureExtension(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/bmp':
      return 'png'
    default:
      return 'jpg'
  }
}

async function parseTrack(filePath: string): Promise<TrackScanInput> {
  const stat = await fs.stat(filePath)
  const fallbackTitle = basename(filePath, extname(filePath))
    .replace(/^\d+\s*[-_.]\s*/, '') // remove prefixo "01 - "
    .replace(/[_]+/g, ' ')
    .trim()

  let title = fallbackTitle
  let artist = 'Artista desconhecido'
  let album = 'Álbum desconhecido'
  let genre: string | null = null
  let year: number | null = null
  let duration = 0
  let bitrate: number | null = null
  let sampleRate: number | null = null
  let codec: string | null = null
  let coverPath: string | null = null

  try {
    const metadata = await parseFile(filePath, { duration: true, skipCovers: false })
    const common = metadata.common
    const format = metadata.format

    if (common.title) title = common.title
    if (common.artist) artist = common.artist
    if (common.album) album = common.album
    if (common.genre?.length) genre = common.genre[0] ?? null
    if (typeof common.year === 'number' && common.year > 0) year = common.year
    if (typeof format.duration === 'number' && format.duration > 0) duration = Math.round(format.duration * 1000) / 1000
    if (typeof format.bitrate === 'number' && format.bitrate > 0) bitrate = Math.round(format.bitrate / 1000)
    if (typeof format.sampleRate === 'number') sampleRate = format.sampleRate
    if (format.codec) codec = format.codec

    // Extrai a capa embutida para o cache de disco (idempotente por hash de conteúdo).
    const picture = common.picture?.[0]
    if (picture && picture.data.length > 0 && picture.data.length <= MAX_COVER_BYTES) {
      const ext = pictureExtension(picture.format)
      const name = `${stableHash(`${filePath}:${stat.size}:${Math.round(stat.mtimeMs)}`)}.${ext}`
      const target = join(COVERS_DIR, name)
      try {
        await fs.access(target)
      } catch {
        await fs.mkdir(COVERS_DIR, { recursive: true })
        await fs.writeFile(target, picture.data)
      }
      coverPath = target
    }
  } catch (err) {
    // Arquivo corrompido/sem tags — ainda assim entra na biblioteca tocável.
    console.warn(`[scanner] falha ao ler metadados de ${filePath}:`, (err as Error)?.message)
  }

  // Fallback: capa sidecar "<mesmo-nome>.jpg/png/webp" na mesma pasta (caso SunoDownload).
  if (!coverPath) {
    const dir = dirname(filePath)
    const base = basename(filePath, extname(filePath))
    const candidates = [
      `${base}.jpg`,
      `${base}.jpeg`,
      `${base}.png`,
      `${base}.webp`,
      'cover.jpg',
      'folder.jpg'
    ]
    for (const name of candidates) {
      try {
        const src = join(dir, name)
        const buf = await fs.readFile(src)
        if (buf.length === 0 || buf.length > MAX_COVER_BYTES) continue
        const ext = extname(name).slice(1) || 'jpg'
        const target = join(COVERS_DIR, `${stableHash(`${filePath}:${stat.size}:${Math.round(stat.mtimeMs)}`)}.${ext}`)
        try {
          await fs.access(target)
        } catch {
          await fs.mkdir(COVERS_DIR, { recursive: true })
          await fs.writeFile(target, buf)
        }
        coverPath = target
        break
      } catch {
        // tenta o próximo candidato
      }
    }
  }

  return {
    filePath,
    title: title || fallbackTitle,
    artist,
    album,
    genre,
    year,
    duration,
    bitrate,
    sampleRate,
    codec,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    coverPath
  }
}

export async function scanDirectory(
  dir: string,
  known: Map<string, { size: number; mtimeMs: number }>,
  onProgress: ProgressFn
): Promise<ScanResponse> {
  cancelRequested = false
  const scannedAt = Date.now()

  const files: string[] = []
  await walk(dir, files, { files: 0 })
  throwIfCancelled()

  const total = files.length
  let done = 0
  const changed: TrackScanInput[] = []
  const unchanged: string[] = []

  await mapPool(files, 8, async (filePath) => {
    throwIfCancelled()
    let statSize = -1
    let statMtime = -1
    try {
      const st = await fs.stat(filePath)
      statSize = st.size
      statMtime = Math.round(st.mtimeMs)
    } catch {
      return // sumiu durante o scan — tratado como ausente no reconcile
    }

    const prev = known.get(filePath)
    const isSame = prev !== undefined && prev.size === statSize && Math.abs(prev.mtimeMs - statMtime) < 1000

    if (isSame) {
      unchanged.push(filePath)
    } else {
      changed.push(await parseTrack(filePath))
    }

    done++
    if (done % 25 === 0 || done === total) {
      onProgress({ stage: 'parse', done, total, current: basename(filePath) })
    }
  })

  onProgress({ stage: 'done', done: total, total, current: '' })
  return { dir, changed, unchanged, scannedAt }
}
