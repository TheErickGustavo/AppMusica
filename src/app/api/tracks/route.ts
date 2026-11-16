import { BlobNotFoundError, head } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth-server'
import { AUDIO_PATHNAME_RE } from '@/lib/media'
import {
  MAX_COVER_BYTES,
  deleteBlobs,
  isBlobConfigured,
  mutateLibrary,
  readLibrary,
  uploadCover
} from '@/lib/server/blob'
import type { Track, TrackPayload } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : fallback
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number | null, min: number, max: number): number | null {
  if (value === null) return null
  return Math.min(Math.max(value, min), max)
}

function decodeCover(payload: Partial<TrackPayload>): { data: Buffer; mime: string } | null {
  if (typeof payload.coverBase64 !== 'string' || !payload.coverBase64) return null
  const mime = payload.coverMime
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') return null

  const raw = payload.coverBase64.replace(/^data:[^;]+;base64,/, '')
  if (!raw || raw.length > MAX_COVER_BYTES * 1.5) return null

  const data = Buffer.from(raw, 'base64')
  if (data.length === 0 || data.length > MAX_COVER_BYTES) return null
  return { data, mime }
}

export async function GET(): Promise<NextResponse> {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  if (!isBlobConfigured()) {
    return NextResponse.json({ tracks: [], configured: false })
  }

  try {
    const { library } = await readLibrary()
    const tracks = [...library.tracks].sort(
      (a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt)
    )
    return NextResponse.json({ tracks, configured: true })
  } catch (error) {
    console.error('[tracks:GET]', error)
    return NextResponse.json(
      { error: 'Não foi possível carregar a biblioteca. Tente novamente.' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  if (!isBlobConfigured()) {
    return NextResponse.json(
      { error: 'O armazenamento (Vercel Blob) ainda não está configurado.' },
      { status: 503 }
    )
  }

  let payload: Partial<TrackPayload>
  try {
    payload = (await request.json()) as Partial<TrackPayload>
  } catch {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  const id = typeof payload.id === 'string' ? payload.id.trim().toLowerCase() : ''
  const pathname = typeof payload.pathname === 'string' ? payload.pathname.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 })
  }
  if (!AUDIO_PATHNAME_RE.test(pathname)) {
    return NextResponse.json({ error: 'Caminho de áudio inválido.' }, { status: 400 })
  }

  const filename = pathname.slice('music/'.length)
  const pathId = filename.slice(0, filename.lastIndexOf('.')).toLowerCase()
  if (pathId !== id) {
    return NextResponse.json({ error: 'O arquivo não corresponde à faixa.' }, { status: 400 })
  }

  let info
  try {
    info = await head(pathname)
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return NextResponse.json(
        { error: 'O arquivo ainda não foi enviado. Tente novamente.' },
        { status: 400 }
      )
    }
    console.error('[tracks:POST:head]', error)
    return NextResponse.json({ error: 'Não foi possível validar o arquivo.' }, { status: 500 })
  }

  const existing = await readLibrary().then(({ library }) =>
    library.tracks.find((track) => track.id === id)
  )
  if (existing) {
    return NextResponse.json({ track: existing, duplicate: true })
  }

  const cover = decodeCover(payload)
  let coverUrl: string | null = null
  if (cover) {
    try {
      coverUrl = await uploadCover(id, cover.data, cover.mime)
    } catch (error) {
      console.error('[tracks:POST:cover]', error)
    }
  }

  const duration = clamp(finiteNumber(payload.duration), 0, 24 * 60 * 60) ?? 0
  const track: Track = {
    id,
    title: cleanText(payload.title, 'Faixa sem título', 300),
    artist: cleanText(payload.artist, 'Artista desconhecido', 200),
    album: cleanText(payload.album, 'Sem álbum', 200),
    genre: optionalText(payload.genre, 100),
    year: clamp(finiteNumber(payload.year), 0, 3000),
    duration,
    bitrate: clamp(finiteNumber(payload.bitrate), 0, 100_000),
    sampleRate: clamp(finiteNumber(payload.sampleRate), 0, 1_000_000),
    codec: optionalText(payload.codec, 100),
    container: optionalText(payload.container, 100),
    size: info.size,
    pathname,
    url: info.url,
    downloadUrl: info.downloadUrl || info.url,
    coverUrl,
    uploadedAt: new Date().toISOString()
  }

  try {
    const saved = await mutateLibrary((library) => {
      const duplicate = library.tracks.find((item) => item.id === id)
      if (duplicate) {
        return { library, result: duplicate }
      }
      return {
        library: { version: 1, tracks: [...library.tracks, track] },
        result: track
      }
    })
    return NextResponse.json({ track: saved })
  } catch (error) {
    console.error('[tracks:POST]', error)
    return NextResponse.json(
      { error: 'Não foi possível salvar os dados da música. Tente novamente.' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  if (!isBlobConfigured()) {
    return NextResponse.json(
      { error: 'O armazenamento (Vercel Blob) ainda não está configurado.' },
      { status: 503 }
    )
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'Música não informada.' }, { status: 400 })
  }

  try {
    const { library } = await readLibrary()
    const track = library.tracks.find((item) => item.id === id)
    if (!track) {
      return NextResponse.json({ error: 'Música não encontrada.' }, { status: 404 })
    }

    await mutateLibrary((current) => ({
      library: { version: 1, tracks: current.tracks.filter((item) => item.id !== id) },
      result: true
    }))

    try {
      await deleteBlobs([track.pathname, ...(track.coverUrl ? [track.coverUrl] : [])])
    } catch (error) {
      console.error('[tracks:DELETE:blob]', error)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[tracks:DELETE]', error)
    return NextResponse.json(
      { error: 'Não foi possível remover a música. Tente novamente.' },
      { status: 500 }
    )
  }
}
