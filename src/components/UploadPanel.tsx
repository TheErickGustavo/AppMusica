'use client'

import { useCallback, useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  FileAudio,
  Loader2,
  RotateCcw,
  X
} from 'lucide-react'
import { formatBytes } from '@/lib/format'
import {
  AUDIO_ACCEPT,
  extensionForFile,
  isSupportedAudioFile,
  mimeForFile
} from '@/lib/media'
import { extractAudioMetadata } from '@/lib/parse-audio'
import type { Track } from '@/lib/types'
import type { ToastTone } from './Toasts'

type UploadStatus = 'waiting' | 'reading' | 'uploading' | 'saving' | 'done' | 'error'

interface UploadItem {
  id: string
  name: string
  size: number
  status: UploadStatus
  progress: number
  error?: string
}

interface UploadJob {
  itemId: string
  file: File
  uploadedPathname?: string
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  waiting: 'Na fila',
  reading: 'Lendo tags…',
  uploading: 'Enviando…',
  saving: 'Salvando…',
  done: 'Pronta',
  error: 'Falhou'
}

function UploadRow({
  item,
  onRetry,
  onDismiss
}: {
  item: UploadItem
  onRetry: (id: string) => void
  onDismiss: (id: string) => void
}): React.ReactElement {
  const active = item.status === 'reading' || item.status === 'uploading' || item.status === 'saving'
  const finished = item.status === 'done' || item.status === 'error'

  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/[0.04] text-zinc-500">
          {item.status === 'done' ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          ) : item.status === 'error' ? (
            <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
          ) : active ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
          ) : (
            <FileAudio className="h-3.5 w-3.5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[12px] font-medium text-zinc-200" title={item.name}>
              {item.name}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">
              {item.status === 'uploading' ? `${item.progress}%` : STATUS_LABEL[item.status]}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`relative h-full overflow-hidden rounded-full transition-[width] duration-300 ${
                  item.status === 'error' ? 'bg-rose-400/70' : 'bg-emerald-400'
                }`}
                style={{
                  width:
                    item.status === 'done'
                      ? '100%'
                      : item.status === 'error'
                        ? '100%'
                        : item.status === 'reading'
                          ? '28%'
                          : `${Math.max(2, item.progress)}%`
                }}
              >
                {item.status === 'reading' && (
                  <span className="pulse-bar absolute inset-y-0 w-1/3 bg-white/35" />
                )}
              </div>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-zinc-600">{formatBytes(item.size)}</span>
          </div>
          {item.error && (
            <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-rose-300/90">
              {item.error}
            </p>
          )}
        </div>

        {finished && (
          <div className="flex shrink-0 items-center gap-0.5">
            {item.status === 'error' && (
              <button
                type="button"
                onClick={() => onRetry(item.id)}
                className="icon-btn h-7 w-7"
                title="Tentar de novo"
                aria-label={`Tentar enviar ${item.name} de novo`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              className="icon-btn h-7 w-7"
              title="Remover da lista"
              aria-label={`Remover ${item.name} da lista de envios`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function UploadPanel({
  disabled,
  onUploaded,
  onToast
}: {
  disabled: boolean
  onUploaded: (track: Track) => void
  onToast: (message: string, tone?: ToastTone) => void
}): React.ReactElement {
  const [items, setItems] = useState<UploadItem[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const jobsRef = useRef<UploadJob[]>([])
  const jobsByIdRef = useRef(new Map<string, UploadJob>())
  const runningRef = useRef(false)

  const patchItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  }, [])

  const processJob = useCallback(
    async (job: UploadJob): Promise<void> => {
      const { itemId, file } = job
      try {
        patchItem(itemId, { status: 'reading', progress: 0, error: undefined })

        const metadata = await extractAudioMetadata(file)
        const extension = extensionForFile(file)

        let pathname = job.uploadedPathname
        if (!pathname) {
          patchItem(itemId, { status: 'uploading', progress: 1 })
          const blob = await upload(`music/${itemId}.${extension}`, file, {
            access: 'public',
            handleUploadUrl: '/api/upload',
            clientPayload: JSON.stringify({ id: itemId, name: file.name }),
            contentType: mimeForFile(file),
            multipart: file.size > 4.5 * 1024 * 1024,
            onUploadProgress: ({ percentage }) => {
              patchItem(itemId, {
                status: 'uploading',
                progress: Math.max(1, Math.min(100, Math.round(percentage)))
              })
            }
          })
          pathname = blob.pathname
          job.uploadedPathname = pathname
        }

        patchItem(itemId, { status: 'saving', progress: 100 })

        const response = await fetch('/api/tracks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: itemId,
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            genre: metadata.genre,
            year: metadata.year,
            duration: metadata.duration,
            bitrate: metadata.bitrate,
            sampleRate: metadata.sampleRate,
            codec: metadata.codec,
            container: metadata.container,
            size: file.size,
            pathname,
            coverBase64: metadata.coverBase64,
            coverMime: metadata.coverMime
          })
        })

        const data = (await response.json().catch(() => ({}))) as {
          track?: Track
          error?: string
        }
        if (!response.ok || !data.track) {
          throw new Error(data.error || 'Não foi possível salvar os dados da música.')
        }

        jobsByIdRef.current.delete(itemId)
        patchItem(itemId, { status: 'done', progress: 100 })
        onUploaded(data.track)
        onToast(`“${data.track.title}” entrou na biblioteca.`, 'success')
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Falha ao enviar a música. Tente novamente.'
        patchItem(itemId, { status: 'error', error: message, progress: 0 })
        onToast(message, 'error')
      }
    },
    [onToast, onUploaded, patchItem]
  )

  const runQueue = useCallback(async (): Promise<void> => {
    if (runningRef.current) return
    runningRef.current = true

    try {
      while (jobsRef.current.length > 0) {
        const job = jobsRef.current.shift()
        if (!job || !jobsByIdRef.current.has(job.itemId)) continue
        await processJob(job)
      }
    } finally {
      runningRef.current = false
      if (jobsRef.current.length > 0) void runQueue()
    }
  }, [processJob])

  const enqueue = useCallback(
    (files: File[]) => {
      if (disabled) {
        onToast('O armazenamento ainda não está configurado. Finalize o Vercel Blob para enviar músicas.', 'error')
        return
      }
      if (files.length === 0) return

      const supported = files.filter(isSupportedAudioFile)
      const rejected = files.length - supported.length
      if (rejected > 0) {
        onToast(
          `${rejected} arquivo${rejected > 1 ? 's' : ''} ignorado${rejected > 1 ? 's' : ''}: formato não suportado.`,
          'error'
        )
      }
      if (supported.length === 0) return

      const newItems: UploadItem[] = []
      for (const file of supported) {
        const itemId = crypto.randomUUID()
        const job: UploadJob = { itemId, file }
        jobsByIdRef.current.set(itemId, job)
        jobsRef.current.push(job)
        newItems.push({
          id: itemId,
          name: file.name,
          size: file.size,
          status: 'waiting',
          progress: 0
        })
      }

      setItems((previous) => [...previous, ...newItems])
      void runQueue()
    },
    [disabled, onToast, runQueue]
  )

  const retry = useCallback(
    (itemId: string) => {
      const job = jobsByIdRef.current.get(itemId)
      if (!job) return
      patchItem(itemId, { status: 'waiting', progress: 0, error: undefined })
      jobsRef.current.push(job)
      void runQueue()
    },
    [patchItem, runQueue]
  )

  const dismiss = useCallback((itemId: string) => {
    jobsByIdRef.current.delete(itemId)
    setItems((previous) => previous.filter((item) => item.id !== itemId))
  }, [])

  const clearFinished = useCallback(() => {
    setItems((previous) => {
      const next = previous.filter((item) => item.status !== 'done' && item.status !== 'error')
      const keep = new Set(next.map((item) => item.id))
      for (const key of jobsByIdRef.current.keys()) {
        if (!keep.has(key)) jobsByIdRef.current.delete(key)
      }
      return next
    })
  }, [])

  const hasFinished = items.some((item) => item.status === 'done' || item.status === 'error')

  return (
    <div
      className={`surface p-3.5 transition-colors ${
        dragging ? 'border-emerald-400/40 bg-emerald-400/[0.035]' : ''
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (disabled) {
            onToast('O armazenamento ainda não está configurado.', 'error')
            return
          }
          inputRef.current?.click()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (!disabled) inputRef.current?.click()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          enqueue(Array.from(event.dataTransfer.files))
        }}
        className={`group flex cursor-pointer flex-col items-start gap-3 rounded-xl border border-dashed px-3.5 py-3.5 outline-none transition sm:flex-row sm:items-center ${
          disabled
            ? 'cursor-not-allowed border-white/[0.06] opacity-55'
            : dragging
              ? 'border-emerald-400/60 bg-emerald-400/[0.06]'
              : 'border-white/[0.11] bg-white/[0.015] hover:border-emerald-400/30 hover:bg-white/[0.03] focus-visible:border-emerald-400/40 focus-visible:ring-2 focus-visible:ring-emerald-400/15'
        }`}
        aria-label="Enviar músicas"
      >
        <input
          ref={inputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          multiple
          disabled={disabled}
          className="hidden"
          onChange={(event) => {
            enqueue(Array.from(event.target.files ?? []))
            event.currentTarget.value = ''
          }}
        />

        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-400 transition group-hover:bg-emerald-400/[0.12]">
            <CloudUpload className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-zinc-100">
              {disabled ? 'Armazenamento pendente' : 'Arraste músicas para cá'}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-zinc-500">
              ou clique para escolher · MP3, M4A, FLAC, WAV, OGG…
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            inputRef.current?.click()
          }}
          className="h-8 shrink-0 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 text-[11.5px] font-medium text-zinc-200 transition hover:border-emerald-400/25 hover:bg-emerald-400/[0.08] hover:text-emerald-200 disabled:cursor-not-allowed sm:ml-auto"
        >
          Escolher arquivos
        </button>
      </div>

      {items.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between px-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-600">
              Envios · {items.length}
            </span>
            {hasFinished && (
              <button
                type="button"
                onClick={clearFinished}
                className="text-[10.5px] text-zinc-500 transition hover:text-zinc-300"
              >
                Limpar concluídos
              </button>
            )}
          </div>
          <div className="max-h-52 space-y-1.5 overflow-y-auto pr-0.5">
            {items.map((item) => (
              <UploadRow key={item.id} item={item} onRetry={retry} onDismiss={dismiss} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
