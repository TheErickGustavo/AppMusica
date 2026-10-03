import { app, protocol } from 'electron'
import { promises as fs, createReadStream } from 'fs'
import { Readable } from 'stream'
import { extname, isAbsolute, normalize, sep } from 'path'

/**
 * Protocolo `media://<kind>/<token>` onde token = base64url(caminho absoluto).
 *
 * Por que base64url em vez de encodeURIComponent?
 * Porque URLs de schemes customizados "standard" passam pela normalização do
 * Chromium (%2F→/, backslashes viram /, %25 ambiguous...) — o que destrói
 * caminhos Windows de forma não-invertível. O alfabeto base64url sobrevive
 * byte-a-byte a qualquer normalização de URL.
 *
 * Respostas com suporte total a HTTP Range (206) — é isso que torna o seek do
 * <audio> instantâneo (~<100ms) em vez de reiniciar o stream do zero.
 */

const AUDIO_EXT = new Set([
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

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.webm': 'audio/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

function coversDir(): string {
  return normalize(joinUserDataCovers())
}

function joinUserDataCovers(): string {
  return app.getPath('userData') + sep + 'covers'
}

/** Decodifica o token base64url do pathname para um caminho absoluto validado. */
export function decodeMediaToken(kind: 'audio' | 'cover', token: string): string | null {
  let raw: string
  try {
    raw = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return null
  }
  if (raw.length === 0 || raw.includes('\0')) return null
  // Absolutez independente de plataforma: aceita 'C:\…', UNC '\\host\…' e POSIX.
  const looksAbsolute = /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/') || isAbsolute(raw)
  if (!looksAbsolute) return null
  const target = normalize(raw)

  const ext = extname(target).toLowerCase()
  if (kind === 'audio') {
    return AUDIO_EXT.has(ext) ? target : null
  }
  // cover: só serve arquivos dentro do cache de capas — nada de path traversal.
  const dir = coversDir()
  if (!target.startsWith(dir + sep) && target !== dir) return null
  return IMAGE_EXT.has(ext) ? target : null
}

function headers(extra: Record<string, string>): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    ...extra
  }
}

function httpError(status: number, statusText: string): Response {
  return new Response(statusText, { status, statusText, headers: headers({}) })
}

function streamFor(filePath: string, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream<Uint8Array>
}

export function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url)
      const kind = url.host === 'cover' ? 'cover' : url.host === 'audio' ? 'audio' : null
      if (!kind) return httpError(404, 'Not found')

      const token = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname
      const target = decodeMediaToken(kind, token)
      if (!target) return httpError(404, 'Not found')

      let stat: Awaited<ReturnType<typeof fs.stat>>
      try {
        stat = await fs.stat(target)
      } catch {
        return httpError(404, 'File not found')
      }
      if (!stat.isFile()) return httpError(404, 'Not a file')

      const mime = MIME_BY_EXT[extname(target).toLowerCase()] ?? 'application/octet-stream'
      const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`

      if (request.headers.get('If-None-Match') === etag) {
        return new Response(null, { status: 304, headers: headers({ ETag: etag }) })
      }

      const size = stat.size
      const rangeHeader = request.headers.get('Range')

      if (!rangeHeader) {
        return new Response(streamFor(target, 0, size - 1), {
          status: 200,
          headers: headers({
            'Content-Type': mime,
            'Content-Length': String(size),
            'Cache-Control': 'private, max-age=3600',
            ETag: etag
          })
        })
      }

      // "bytes=start-end" (end opcional) e sufixo "bytes=-N".
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (!match) return httpError(416, 'Malformed range')
      let start: number
      let end: number
      if ((match[1] ?? '') === '') {
        const suffix = Number.parseInt(match[2] ?? '0', 10)
        if (!Number.isFinite(suffix) || suffix <= 0) return httpError(416, 'Malformed range')
        start = Math.max(size - suffix, 0)
        end = size - 1
      } else {
        start = Number.parseInt(match[1] ?? '0', 10)
        end = match[2] ? Math.min(Number.parseInt(match[2], 10), size - 1) : size - 1
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return httpError(416, 'Range not satisfiable')
      }

      return new Response(streamFor(target, start, end), {
        status: 206,
        headers: headers({
          'Content-Type': mime,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Cache-Control': 'private, max-age=3600',
          ETag: etag
        })
      })
    } catch (err) {
      console.error('[media] handler error:', err)
      return httpError(500, 'Internal error')
    }
  })
}
