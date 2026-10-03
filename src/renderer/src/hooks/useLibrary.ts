import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Feedback, KnownTrackStamp, ScanProgress } from '@shared/music'
import {
  addFolder,
  applyScanResponse,
  clearLibrary as clearDb,
  db,
  loadSettings,
  registerPlayCount,
  removeFolder,
  removeTrack,
  saveSettings,
  setFeedback,
  toggleFeedback,
  type AppSettings
} from '@/lib/db'
import { pushToast } from '@/lib/toast'

/* ═══════════════════════════════════════════════════════════════════════════
 * ONDA · BIBLIOTECA REATIVA
 * Tudo é derivado de live-queries do Dexie: curtiu, a "Favoritas" reordena
 * sozinha; ouviu até 50%, o "Mais Tocadas" sobe sem refresh manual.
 * ═════════════════════════════════════════════════════════════════════════ */

export type SmartViewId = 'all' | 'top' | 'favorites' | 'disliked'

export const VIEW_META: Record<SmartViewId, { label: string; description: string }> = {
  all: { label: 'Todas as Músicas', description: 'Catálogo completo da sua biblioteca local' },
  top: { label: 'Mais Tocadas', description: 'Ordenadas por número real de reproduções' },
  favorites: { label: 'Favoritas', description: 'Tudo que você marcou com ♥' },
  disliked: { label: 'Rejeitadas', description: 'Blacklist — o shuffle nunca passa por aqui' }
}

export type SortKey = 'title' | 'artist' | 'album' | 'year' | 'duration' | 'playCount' | 'lastPlayedAt' | 'addedAt'

export interface SortSpec {
  key: SortKey
  dir: 1 | -1
}

const DEFAULT_SORT: Record<SmartViewId, SortSpec> = {
  all: { key: 'addedAt', dir: -1 },
  top: { key: 'playCount', dir: -1 },
  favorites: { key: 'lastPlayedAt', dir: -1 },
  disliked: { key: 'title', dir: 1 }
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })

function compareBy(key: SortKey, dir: 1 | -1): (a: Parameters<typeof baseValue>[0], b: Parameters<typeof baseValue>[0]) => number {
  return (a, b) => {
    const va = baseValue(a, key)
    const vb = baseValue(b, key)
    let cmp: number
    if (typeof va === 'string' || typeof vb === 'string') {
      cmp = collator.compare(String(va ?? ''), String(vb ?? ''))
    } else {
      cmp = (va as number) - (vb as number)
    }
    if (cmp === 0) cmp = collator.compare(a.title, b.title)
    return cmp * dir
  }
}

function baseValue(t: { title: string; artist: string; album: string; year: number | null; duration: number; playCount: number; lastPlayedAt: number | null; addedAt: number }, key: SortKey): string | number {
  switch (key) {
    case 'title':
      return t.title
    case 'artist':
      return t.artist
    case 'album':
      return t.album
    case 'year':
      return t.year ?? 0
    case 'duration':
      return t.duration
    case 'playCount':
      return t.playCount
    case 'lastPlayedAt':
      return t.lastPlayedAt ?? 0
    case 'addedAt':
      return t.addedAt
  }
}

export interface LibraryScanState {
  running: boolean
  progress: ScanProgress | null
  startedAt: number | null
}

export function useLibrary() {
  const [view, setViewState] = useState<SmartViewId>('all')
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT.all)
  const [search, setSearch] = useState('')
  const [albumFilter, setAlbumFilter] = useState<{ album: string; artist: string } | null>(null)
  const [scan, setScan] = useState<LibraryScanState>({ running: false, progress: null, startedAt: null })
  const [settings, setSettings] = useState<AppSettings>({ autoRescanOnLaunch: true, rowDensity: 'comfy' })
  const autoScanDone = useRef(false)
  const scanMutex = useRef(false)

  const api = typeof window !== 'undefined' ? window.onda : undefined
  const desktop = Boolean(api)

  // ── Live queries ──────────────────────────────────────────────────────────

  const tracks = useLiveQuery(() => db.tracks.toArray(), [], [])
  const folders = useLiveQuery(() => db.folders.orderBy('path').toArray(), [], [])

  const stats = useMemo(() => {
    let totalPlays = 0
    let liked = 0
    let disliked = 0
    let totalDuration = 0
    const albums = new Set<string>()
    for (const t of tracks) {
      totalPlays += t.playCount
      if (t.feedback === 'liked') liked++
      else if (t.feedback === 'disliked') disliked++
      totalDuration += t.duration
      if (t.album) albums.add(`${t.album}\u0000${t.artist}`)
    }
    return { total: tracks.length, totalPlays, liked, disliked, totalDuration, albums: albums.size }
  }, [tracks])

  const counts = useMemo(
    () => ({
      all: tracks.length,
      top: tracks.filter((t) => t.playCount > 0).length,
      favorites: stats.liked,
      disliked: stats.disliked
    }),
    [tracks, stats]
  )

  // ── Derivações: filtro da view + busca + filtro de álbum + ordenação ─────

  const viewFiltered = useMemo(() => {
    switch (view) {
      case 'favorites':
        return tracks.filter((t) => t.feedback === 'liked')
      case 'disliked':
        return tracks.filter((t) => t.feedback === 'disliked')
      case 'top':
        // "Mais Tocadas" = catálogo completo + ordenação por playCount (default da view)
        return tracks
      default:
        return tracks
    }
  }, [tracks, view])

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return viewFiltered
    const terms = q.split(/\s+/).filter(Boolean)
    return viewFiltered.filter((t) => {
      const hay = `${t.title} ${t.artist} ${t.album} ${t.genre ?? ''} ${t.year ?? ''}`.toLowerCase()
      return terms.every((term) => hay.includes(term))
    })
  }, [viewFiltered, search])

  const list = useMemo(() => {
    let rows = searched
    if (albumFilter) {
      rows = rows.filter((t) => t.album === albumFilter.album && t.artist === albumFilter.artist)
    }
    return [...rows].sort(compareBy(sort.key, sort.dir))
  }, [searched, albumFilter, sort])

  /** Estante de capas (álbuns) derivada da view atual, por "peso" de plays. */
  const albums = useMemo(() => {
    if (view === 'disliked') return []
    const map = new Map<string, { album: string; artist: string; coverPath: string | null; tracks: number; plays: number; year: number | null; seed: string }>()
    for (const t of searched) {
      if (!t.album || t.album === 'Álbum desconhecido') continue
      const key = `${t.album}\u0000${t.artist}`
      const cur = map.get(key)
      if (cur) {
        cur.tracks++
        cur.plays += t.playCount
        if (!cur.coverPath && t.coverPath) cur.coverPath = t.coverPath
      } else {
        map.set(key, {
          album: t.album,
          artist: t.artist,
          coverPath: t.coverPath,
          tracks: 1,
          plays: t.playCount,
          year: t.year,
          seed: key
        })
      }
    }
    return [...map.values()].sort((a, b) => b.plays - a.plays || collator.compare(a.album, b.album)).slice(0, 40)
  }, [searched, view])

  // ── Ações: ordenação / view ───────────────────────────────────────────────

  const setView = useCallback((next: SmartViewId) => {
    setViewState(next)
    setAlbumFilter(null)
    setSort((current) => {
      // troca para a ordenação padrão da lista, a menos que a atual já seja válida
      const defaults = DEFAULT_SORT[next]
      return current.key === defaults.key ? current : defaults
    })
  }, [])

  const toggleSort = useCallback((key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'title' || key === 'artist' || key === 'album' ? 1 : -1 }))
  }, [])

  // ── Ações: importação / scan ─────────────────────────────────────────────

  const runScan = useCallback(
    async (dirs: string[], announce: boolean) => {
      if (!api) {
        pushToast('error', 'Somente no app desktop', 'A leitura do disco exige o Electron (npm run dev / build).')
        return
      }
      if (scanMutex.current) return
      scanMutex.current = true
      setScan({ running: true, progress: null, startedAt: Date.now() })
      let added = 0
      let updated = 0
      let removed = 0
      try {
        for (const dir of dirs) {
          const known: KnownTrackStamp[] = (await db.tracks.where('folder').equals(dir).toArray()).map((t) => ({
            filePath: t.filePath,
            size: t.size,
            mtimeMs: t.mtimeMs
          }))
          const res = await api.scan(dir, known)
          if (res.aborted) {
            pushToast('info', 'Escaneamento cancelado')
            break
          }
          const result = await applyScanResponse(res)
          added += result.added
          updated += result.updated
          removed += result.removed
        }
        if (announce) {
          if (added + updated + removed === 0) pushToast('info', 'Biblioteca em dia', 'Nenhuma mudança encontrada no disco.')
          else
            pushToast(
              'success',
              'Biblioteca sincronizada',
              [added ? `${added} nova${added > 1 ? 's' : ''}` : '', updated ? `${updated} atualizada${updated > 1 ? 's' : ''}` : '', removed ? `${removed} removida${removed > 1 ? 's' : ''}` : '']
                .filter(Boolean)
                .join(' · ')
            )
        }
      } catch (err) {
        pushToast('error', 'Falha ao escanear', (err as Error)?.message ?? 'Erro desconhecido no processo de índice.')
      } finally {
        setScan({ running: false, progress: null, startedAt: null })
        scanMutex.current = false
      }
    },
    [api]
  )

  const importFolder = useCallback(async () => {
    if (!api) return
    const dir = await api.selectFolder()
    if (!dir) return
    await addFolder(dir)
    await runScan([dir], true)
  }, [api, runScan])

  const rescanFolder = useCallback(
    (dir: string) => void runScan([dir], true),
    [runScan]
  )

  const rescanAll = useCallback(() => {
    if (folders.length === 0) {
      pushToast('info', 'Nenhuma pasta importada', 'Use “Importar pasta” para apontar sua coleção.')
      return
    }
    void runScan(folders.map((f) => f.path), true)
  }, [folders, runScan])

  const dropFolder = useCallback(
    async (dir: string) => {
      await removeFolder(dir, true)
      pushToast('info', 'Pasta removida da biblioteca', dir)
    },
    []
  )

  const cancelScan = useCallback(() => api?.cancelScan(), [api])

  const clearAll = useCallback(async () => {
    await clearDb()
    pushToast('info', 'Biblioteca limpa', 'Use Importar pasta para recomeçar.')
  }, [])

  // progresso do main → snapshot local
  useEffect(() => {
    if (!api) return
    return api.onScanProgress((p) => {
      setScan((s) => (s.running ? { ...s, progress: p } : s))
    })
  }, [api])

  // carrega preferências persistidas na montagem
  useEffect(() => {
    void loadSettings().then(setSettings)
  }, [])

  // auto-rescan incremental ao abrir o app (silencioso)
  useEffect(() => {
    if (autoScanDone.current || !api || folders.length === 0) return
    autoScanDone.current = true
    void loadSettings().then((s) => {
      setSettings(s)
      if (s.autoRescanOnLaunch) void runScan(folders.map((f) => f.path), false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.length, api])

  // ── Ações: feedback / telemetria ─────────────────────────────────────────

  const toggleLike = useCallback(
    async (filePath: string): Promise<Feedback> => {
      const next = await toggleFeedback(filePath, 'liked')
      if (next === 'liked') pushToast('success', 'Adicionada às Favoritas')
      return next
    },
    []
  )

  const toggleDislike = useCallback(
    async (filePath: string): Promise<Feedback> => {
      const next = await toggleFeedback(filePath, 'disliked')
      if (next === 'disliked') pushToast('info', 'Na blacklist', 'O shuffle vai pular essa faixa.')
      return next
    },
    []
  )

  const setTrackFeedback = useCallback(async (filePath: string, fb: Feedback) => {
    await setFeedback(filePath, fb)
  }, [])

  const deleteTrack = useCallback(async (filePath: string, title: string) => {
    await removeTrack(filePath)
    pushToast('info', 'Removida da biblioteca', title)
  }, [])

  /** Incremento manual (usado só pelo devtools de telemetria / testes futuros). */
  const debugCountPlay = useCallback(async (filePath: string) => {
    await registerPlayCount(filePath)
  }, [])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(await saveSettings(patch))
  }, [])

  return {
    // estado
    view,
    setView,
    list,
    tracks,
    folders,
    stats,
    counts,
    albums,
    sort,
    toggleSort,
    search,
    setSearch,
    albumFilter,
    setAlbumFilter,
    scan,
    settings,
    updateSettings,
    desktop,
    // ações
    importFolder,
    rescanFolder,
    rescanAll,
    cancelScan,
    clearAll,
    dropFolder,
    toggleLike,
    toggleDislike,
    setTrackFeedback,
    deleteTrack,
    debugCountPlay
  }
}

export type Library = ReturnType<typeof useLibrary>
