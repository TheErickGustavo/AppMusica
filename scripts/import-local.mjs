#!/usr/bin/env node
/**
 * Importa uma pasta local de músicas para o Vercel Blob e para a biblioteca
 * compartilhada do Onda Web.
 *
 * Uso:
 *   node --env-file=.env.local scripts/import-local.mjs ~/Músicas
 *   node --env-file=.env.local scripts/import-local.mjs ~/Músicas --dry-run
 *
 * Requer a variável BLOB_READ_WRITE_TOKEN no ambiente (o `vercel env pull`
 * coloca ela no .env.local).
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { BlobNotFoundError, get, head, put } from '@vercel/blob'
import { parseFile } from 'music-metadata'

const SUPPORTED = new Set([
  'mp3',
  'mpeg',
  'mpga',
  'm4a',
  'm4b',
  'flac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'aiff',
  'aif',
  'webm',
  'aac',
  'mp4'
])

const MIME = {
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  webm: 'audio/webm',
  aac: 'audio/aac',
  mp4: 'audio/mp4'
}

const MAX_COVER_BYTES = 1_500_000
const LIBRARY_PATH = process.env.LIBRARY_PATH || 'data/library.json'
const META_BLOB_TOKEN = process.env.META_READ_WRITE_TOKEN

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const folderArg = args.find((arg) => !arg.startsWith('--'))
const folder = path.resolve(folderArg || path.join(homedir(), 'Músicas'))

if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
  console.error('Credenciais do Vercel Blob (áudio) não encontradas. Rode com: node --env-file=.env.local scripts/import-local.mjs')
  process.exit(1)
}

if (!META_BLOB_TOKEN) {
  console.error('META_READ_WRITE_TOKEN não encontrado. Rode com: node --env-file=.env.local scripts/import-local.mjs')
  process.exit(1)
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function idFor(relativePath) {
  const hex = createHash('sha256')
    .update(relativePath.split(path.sep).join('/'))
    .digest('hex')
    .slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function text(value, fallback, max = 300) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback
}

function optional(value, max = 100) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function titleFromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim()
  return base || 'Faixa sem título'
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(full)))
    } else if (entry.isFile() && SUPPORTED.has(extensionOf(entry.name))) {
      files.push(full)
    }
  }
  return files
}

async function readLibrary() {
  const result = await get(LIBRARY_PATH, {
    access: 'private',
    useCache: false,
    token: META_BLOB_TOKEN
  })
  if (!result) {
    return { library: { version: 1, tracks: [] }, etag: null }
  }
  if (result.statusCode !== 200 || !result.stream) {
    throw new Error('Falha ao ler a biblioteca.')
  }
  const data = JSON.parse(await new Response(result.stream).text())
  return {
    library: {
      version: 1,
      tracks: Array.isArray(data.tracks) ? data.tracks : []
    },
    etag: result.blob.etag.replace(/^W\//, '')
  }
}

async function writeLibrary(library, etag) {
  const result = await put(LIBRARY_PATH, JSON.stringify(library), {
    access: 'private',
    token: META_BLOB_TOKEN,
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    ...(etag ? { allowOverwrite: true, ifMatch: etag } : {})
  })
  return result.etag
}

async function appendTrack(track) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { library, etag } = await readLibrary()
    if (library.tracks.some((item) => item.id === track.id)) {
      return
    }
    library.tracks.push(track)
    try {
      await writeLibrary(library, etag)
      return
    } catch (error) {
      if (attempt === 7) throw error
      await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200))
    }
  }
}

async function main() {
  console.log(`Pasta: ${folder}`)
  console.log(dryRun ? 'Modo: simulação (nada será enviado)' : 'Modo: importação real')

  const files = (await walk(folder)).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  if (files.length === 0) {
    console.log('Nenhum arquivo de áudio encontrado.')
    return
  }

  const { library } = await readLibrary()
  const existingIds = new Set(library.tracks.map((track) => track.id))
  console.log(`${files.length} arquivos encontrados · ${library.tracks.length} já na biblioteca`)

  let imported = 0
  let skipped = 0
  let failed = 0

  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    const relative = path.relative(folder, file)
    const id = idFor(relative)
    const prefix = `[${index + 1}/${files.length}]`

    if (existingIds.has(id)) {
      skipped++
      console.log(`${prefix} já existe · ${relative}`)
      continue
    }

    try {
      const fileStat = await stat(file)
      const extension = extensionOf(file)
      const mime = MIME[extension] || 'application/octet-stream'
      const pathname = `music/${id}.${extension}`

      let metadata = null
      try {
        metadata = await parseFile(file, { duration: true })
      } catch (error) {
        console.warn(`${prefix} tags ilegíveis (${error.message}) · ${relative}`)
      }

      const common = metadata?.common || {}
      const format = metadata?.format || {}
      const title = text(common.title, titleFromFilename(path.basename(file)))
      const artist = text(common.artist || common.albumartist, 'Artista desconhecido', 200)
      const album = text(common.album, 'Sem álbum', 200)

      if (dryRun) {
        console.log(`${prefix} ${artist} — ${title}`)
        imported++
        continue
      }

      let info = null
      try {
        info = await head(pathname)
      } catch (error) {
        if (!(error instanceof BlobNotFoundError)) throw error
      }

      if (!info) {
        info = await put(pathname, createReadStream(file), {
          access: 'public',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: mime,
          cacheControlMaxAge: 60 * 60
        })
      }

      let coverUrl = null
      const picture = common.picture?.[0]
      if (picture && picture.data?.length > 0 && picture.data.length <= MAX_COVER_BYTES) {
        const pictureMime =
          picture.format === 'image/png'
            ? 'image/png'
            : picture.format === 'image/webp'
              ? 'image/webp'
              : 'image/jpeg'
        const coverExt = pictureMime === 'image/png' ? 'png' : pictureMime === 'image/webp' ? 'webp' : 'jpg'
        try {
          const cover = await put(`covers/${id}.${coverExt}`, Buffer.from(picture.data), {
            access: 'public',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: pictureMime,
            cacheControlMaxAge: 60 * 60 * 24 * 365
          })
          coverUrl = cover.url
        } catch (error) {
          console.warn(`${prefix} capa falhou (${error.message}) · ${relative}`)
        }
      }

      const duration =
        typeof format.duration === 'number' && Number.isFinite(format.duration) ? format.duration : 0
      const bitrate =
        typeof format.bitrate === 'number' && Number.isFinite(format.bitrate)
          ? Math.round(format.bitrate / 1000)
          : null

      await appendTrack({
        id,
        title,
        artist,
        album,
        genre: optional(common.genre?.[0]),
        year: typeof common.year === 'number' ? common.year : null,
        duration,
        bitrate,
        sampleRate: typeof format.sampleRate === 'number' ? format.sampleRate : null,
        codec: optional(format.codec),
        container: optional(format.container),
        size: info.size ?? fileStat.size,
        pathname,
        url: info.url,
        downloadUrl: info.downloadUrl || info.url,
        coverUrl,
        uploadedAt: new Date().toISOString()
      })

      existingIds.add(id)
      imported++
      console.log(`${prefix} ✓ ${artist} — ${title}`)
    } catch (error) {
      failed++
      console.error(`${prefix} ✗ ${relative}: ${error.message}`)
    }
  }

  console.log(
    `\nConcluído: ${imported} importadas, ${skipped} já existiam, ${failed} falharam.`
  )
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
