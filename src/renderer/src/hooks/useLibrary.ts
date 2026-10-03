import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import Fuse from 'fuse.js'
import type { Feedback, KnownTrackStamp, Playlist, PlaylistTrack, ScanProgress, Track } from '@shared/music'
import {
  addFolder,
  addToPlaylist as dbAddToPlaylist,
  applyScanResponse,
  clearLibrary as clearDb,
  createPlaylist as dbCreatePlaylist,
  db,
  DEFAULT_SETTINGS,
  deletePlaylist as dbDeletePlaylist,
  knownCoverPaths,
  loadSettings,
  prunePlaylistTracks,
  registerPlayCount,
  removeFolder,
  removeFromPlaylist as dbRemoveFromPlaylist,
  removeTrack,
  removeTracks as dbRemoveTracks,
  renamePlaylist as dbRenamePlaylist,
  reorderPlaylist as dbReorderPlaylist,
  saveSettings,
  setFeedback,
  setFeedbackMany,
  toggleFeedback,
  upsertWatchedTrack,
  upsertWatchedTracks,
  type AppSettings
} from '@/lib/db'
import { pushToast } from '@/lib/toast'
import { formatBytes } from '@/lib/format'

/* ═══════════════════════════════════════════════════════════════════════════
 * ONDA · BIBLIOTECA REATIVA
 * Tudo é derivado de live-queries do Dexie: curtiu, a "Favoritas" reordena
 * sozinha; ouviu até 50%, o "Mais Tocadas" sobe sem refresh manual.
 *
 *  - Listas inteligentes (fixas) + playlists customizadas (v2 do banco).
 *  - Auto-watcher: o main (chokidar) empurra `library:file-added/removed`;
 *    aqui vira upsert/delete preservando playCount/lastPlayedAt/feedback.
 *  - Busca fuzzy (Fuse.js, threshold 0.4) com fallback para substring exata.
 * ═════════════════════════════════════════════════════════════════════════ */

export type SmartViewId = 'all' | 'top' | 'favorites' | 'disliked'

export const VIEW_META: Record<SmartViewId, { label: string; description: string }> = {
  all: { label: 'Todas as Músicas', description: 'Catálogo completo da sua biblioteca local' },
  top: { label: 'Mais Tocadas', description: 'Ordenadas por número real de reproduções' },
  favorites: { label: 'Favoritas', description: 'Tudo que você marcou com ♥' },
  disliked: { label: 'Rejeitadas', description: 'Blacklist — o shuffle nunca passa por aqui' }
}

/** `manual` = ordem da playlist (drag & drop), sem reordenar por coluna. */
export type SortKey =
  | 'manual'
  | 'title'
  | 'artist'
  | 'album'
  | 'year'
  | 'duration'
  | 'playCount'
  | 'lastPlayedAt'
  | 'addedAt'

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

/** Ordenação padrão de uma playlist: a ordem manual do usuário. */
export const PLAYLIST_SORT: SortSpec = { key: 'manual', dir: 1 }

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })

function compareBy(key: SortKey, dir: 1 | -1): (a: Track, b: Track) => number {
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

function baseValue(t: Track, key: SortKey): string | number {
  switch (key) {
    case 'manual':
      return 0
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

export interface AddPathsResult {
  /** Faixas efetivamente indexadas (novas ou atualizadas), na ordem do drop. */
  tracks: Track[]
  /** Pastas importadas a partir do drop (escaneadas em seguida). */
  folders: string[]
}

export function useLibrary() {
  const [view, setViewState] = useState<SmartViewId>('all')
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null)
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT.all)
  const [search, setSearch] = useState('')
  const [albumFilter, setAlbumFilter] = useState<{ album: string; artist: string } | null>(null)
  const [scan, setScan] = useState<LibraryScanState>({ running: false, progress: null, startedAt: null })
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const autoScanDone = useRef(false)
  const scanMutex = useRef(false)
  /** Agrupador de toasts do watcher: 40 arquivos = 1 aviso, não 40. */
  const watcherBatch = useRef<{ count: number; timer: ReturnType<typeof setTimeout> | null }>({ count: 0, timer: null })

  const api = typeof window !== 'undefined' ? window.onda : undefined
  const desktop = Boolean(api)

  // ── Live queries ──────────────────────────────────────────────────────────

  const tracks = useLiveQuery(() => db.tracks.toArray(), [], [] as Track[])
  const folders = useLiveQuery(() => db.folders.orderBy('path').toArray(), [], [])
  const playlists = useLiveQuery(() => db.playlists.orderBy('name').toArray(), [], [] as Playlist[])
  const playlistTracks = useLiveQuery(() => db.playlist_tracks.toArray(), [], [] as PlaylistTrack[])

  const trackByPath = useMemo(() => new Map(tracks.map((t) => [t.filePath, t] as const)), [tracks])
  /** Espelho em ref: os listeners de IPC não devem se re-inscrever a cada play. */
  const trackByPathRef = useRef(trackByPath)
  trackByPathRef.current = trackByPath

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

  /** Contagem por playlist (barra lateral) + ordem manual por playlist. */
  const playlistIndex = useMemo(() => {
    const ordered = new Map<string, PlaylistTrack[]>()
    for (const row of playlistTracks) {
      const bucket = ordered.get(row.playlistId)
      if (bucket) bucket.push(row)
      else ordered.set(row.playlistId, [row])
    }
    const counts = new Map<string, number>()
    const orders = new Map<string, string[]>()
    for (const [playlistId, rows] of ordered) {
      rows.sort((a, b) => a.order - b.order)
      const alive = rows.filter((row) => trackByPath.has(row.filePath))
      counts.set(playlistId, alive.length)
      orders.set(
        playlistId,
        alive.map((row) => row.filePath)
      )
    }
    return { counts, orders }
  }, [playlistTracks, trackByPath])

  const activePlaylist = useMemo(
    () => (activePlaylistId ? playlists.find((p) => p.id === activePlaylistId) ?? null : null),
    [activePlaylistId, playlists]
  )

  // ── Derivações: filtro da view + busca + filtro de álbum + ordenação ─────

  const viewFiltered = useMemo(() => {
    if (activePlaylistId) {
      const order = playlistIndex.orders.get(activePlaylistId) ?? []
      const out: Track[] = []
      for (const filePath of order) {
        const track = trackByPath.get(filePath)
        if (track) out.push(track)
      }
      return out
    }
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
  }, [tracks, view, activePlaylistId, playlistIndex, trackByPath])

  /**
   * Índice Fuse em memória, reconstruído só quando a base muda (playlist
   * trocada, scan, like…). threshold 0.4 → "daftpunk" acha "Daft Punk",
   * "radiohead" acha "Radiohed" sem custo perceptual.
   */
  const fuse = useMemo(
    () =>
      new Fuse(viewFiltered, {
        keys: [
          { name: 'title', weight: 0.5 },
          { name: 'artist', weight: 0.3 },
          { name: 'album', weight: 0.15 },
          { name: 'genre', weight: 0.05 }
        ],
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 2,
        shouldSort: true
      }),
    [viewFiltered]
  )

  const searched = useMemo(() => {
    const q = search.trim()
    if (!q) return viewFiltered

    // 1) fuzzy: tolera erro de digitação, falta de espaço e ordem trocada
    const fuzzyHits = fuse.search(q).map((hit) => hit.item)
    if (fuzzyHits.length > 0) return fuzzyHits

    // 2) fallback determinístico: substring (multi-termo AND) sobre todos os campos
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return viewFiltered.filter((t) => {
      const hay = `${t.title} ${t.artist} ${t.album} ${t.genre ?? ''} ${t.year ?? ''}`.toLowerCase()
      return terms.every((term) => hay.includes(term))
    })
  }, [viewFiltered, search, fuse])

  const list = useMemo(() => {
    let rows = searched
    if (albumFilter) {
      rows = rows.filter((t) => t.album === albumFilter.album && t.artist === albumFilter.artist)
    }
    // `manual` = respeita a ordem vinda da playlist/consulta (sem tocar no array).
    if (sort.key === 'manual') return rows
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

  // ── Ações: ordenação / view / playlist ativa ─────────────────────────────

  const setView = useCallback((next: SmartViewId) => {
    setViewState(next)
    setActivePlaylistId(null)
    setAlbumFilter(null)
    setSort((current) => {
      // troca para a ordenação padrão da lista, a menos que a atual já seja válida
      const defaults = DEFAULT_SORT[next]
      return current.key === defaults.key ? current : defaults
    })
  }, [])

  /** Abre uma playlist customizada (ordem manual por padrão). */
  const openPlaylist = useCallback((playlistId: string) => {
    setActivePlaylistId(playlistId)
    setAlbumFilter(null)
    setSort(PLAYLIST_SORT)
  }, [])

  const toggleSort = useCallback((key: SortKey) => {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'title' || key === 'artist' || key === 'album' ? 1 : -1 }
    )
  }, [])

  /** Volta à ordem manual (drag & drop) de uma playlist. */
  const applyManualOrder = useCallback(() => setSort(PLAYLIST_SORT), [])

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
        await prunePlaylistTracks()
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
      pushToast('info', 'Nenhuma pasta importada', 'Use "Importar pasta" para apontar sua coleção.')
      return
    }
    void runScan(folders.map((f) => f.path), true)
  }, [folders, runScan])

  const dropFolder = useCallback(async (dir: string) => {
    await removeFolder(dir, true)
    pushToast('info', 'Pasta removida da biblioteca', dir)
  }, [])

  const cancelScan = useCallback(() => api?.cancelScan(), [api])

  const clearAll = useCallback(async () => {
    await clearDb()
    pushToast('info', 'Biblioteca limpa', 'Use Importar pasta para recomeçar.')
  }, [])

  // ── Auto-watcher: pastas vigiadas no main ────────────────────────────────

  const folderKey = useMemo(() => folders.map((f) => f.path).sort().join('\u0000'), [folders])

  useEffect(() => {
    if (!api) return
    const dirs = folderKey.length === 0 ? [] : folderKey.split('\u0000')
    if (!settings.watchFolders) {
      void api.watchFolders([])
      return
    }
    void api.watchFolders(dirs).catch(() => undefined)
  }, [api, folderKey, settings.watchFolders])

  /**
   * Eventos do watcher → Dexie. O arquivo já chega parseado (o main leu as
   * tags); aqui só fazemos o upsert preservando telemetria.
   */
  useEffect(() => {
    if (!api) return

    const flushWatcherToast = (): void => {
      const pending = watcherBatch.current
      pending.timer = null
      if (pending.count === 0) return
      const n = pending.count
      pending.count = 0
      pushToast('success', n === 1 ? 'Nova música na biblioteca' : `${n} músicas novas na biblioteca`, 'Detectadas automaticamente nas pastas vigiadas.')
    }

    const offAdded = api.onFileAdded(({ folder, track }) => {
      void upsertWatchedTrack(track, folder).then(({ added }) => {
        if (!added) return
        const pending = watcherBatch.current
        pending.count++
        if (pending.timer) clearTimeout(pending.timer)
        pending.timer = setTimeout(flushWatcherToast, 1500)
      })
    })

    const offRemoved = api.onFileRemoved(({ filePath }) => {
      const track = trackByPathRef.current.get(filePath)
      void removeTrack(filePath).then(() => {
        // O motor de áudio limpa fila/bag da faixa que sumiu do disco.
        window.dispatchEvent(new CustomEvent('onda:tracks-removed', { detail: { filePaths: [filePath] } }))
        if (track) pushToast('info', 'Arquivo removido do disco', track.title)
      })
    })

    return () => {
      offAdded()
      offRemoved()
      if (watcherBatch.current.timer) clearTimeout(watcherBatch.current.timer)
    }
  }, [api])

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

  // pastas vigiadas migradas para um banco antigo → garante rescan inicial
  useEffect(() => {
    if (autoScanDone.current || !api || folders.length === 0) return
    autoScanDone.current = true
    void loadSettings().then((s) => {
      setSettings(s)
      if (s.autoRescanOnLaunch) void runScan(folders.map((f) => f.path), false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.length, api])

  // ── Ações: drag & drop do Explorer ───────────────────────────────────────

  /** Pasta-raiz que contém o arquivo (ou a própria pasta dele). */
  const folderForPath = useCallback(
    (filePath: string): string => {
      const normalized = filePath.replace(/\\/g, '/')
      let best: string | null = null
      for (const folder of folders) {
        const root = folder.path.replace(/\\/g, '/').replace(/\/+$/, '')
        if (normalized === root || normalized.startsWith(`${root}/`)) {
          if (!best || root.length > best.length) best = root
        }
      }
      if (best) {
        const original = folders.find((f) => f.path.replace(/\\/g, '/').replace(/\/+$/, '') === best)
        if (original) return original.path
      }
      const cut = filePath.replace(/[\\/][^\\/]*$/, '')
      return cut === filePath ? filePath : cut
    },
    [folders]
  )

  /**
   * Drag & drop do Windows Explorer: aceita arquivos de áudio soltos e/ou
   * pastas inteiras. Devolve as faixas indexadas para quem chamou poder tocar.
   */
  const addPaths = useCallback(
    async (paths: string[]): Promise<AddPathsResult> => {
      const empty: AddPathsResult = { tracks: [], folders: [] }
      if (!api || paths.length === 0) return empty

      try {
        const parsed = await api.parsePaths(paths)
        const entries = parsed.tracks.map((track) => ({ track, folder: folderForPath(track.filePath) }))
        const indexed = await upsertWatchedTracks(entries)

        // Resolve os Track completos (com telemetria) na ordem do drop.
        const pathsInOrder = entries.map((e) => e.track.filePath)
        const rows = pathsInOrder.length > 0 ? await db.tracks.where('filePath').anyOf(pathsInOrder).toArray() : []
        const byPath = new Map(rows.map((t) => [t.filePath, t] as const))
        const ordered: Track[] = []
        for (const filePath of pathsInOrder) {
          const track = byPath.get(filePath)
          if (track) ordered.push(track)
        }

        // Pastas soltas viram pastas vigiadas + scan (aí o watcher assume).
        for (const dir of parsed.directories) {
          await addFolder(dir)
        }

        if (parsed.tracks.length > 0) {
          pushToast(
            'success',
            indexed > 0 ? `${indexed} faixa${indexed > 1 ? 's' : ''} adicionada${indexed > 1 ? 's' : ''}` : 'Biblioteca atualizada',
            parsed.tracks.length > indexed ? `${parsed.tracks.length} arquivo(s) processado(s), ${indexed} novo(s).` : undefined
          )
        }
        if (parsed.directories.length > 0) {
          pushToast('info', parsed.directories.length === 1 ? 'Pasta adicionada' : `${parsed.directories.length} pastas adicionadas`, 'Indexando e passando a vigiar em tempo real.')
          void runScan(parsed.directories, false)
        }
        if (parsed.tracks.length === 0 && parsed.directories.length === 0) {
          pushToast('error', 'Nada para importar', 'Solte arquivos de áudio (mp3, flac, m4a…) ou uma pasta.')
        }

        return { tracks: ordered, folders: parsed.directories }
      } catch (err) {
        pushToast('error', 'Falha ao importar arquivos', (err as Error)?.message ?? 'Erro desconhecido no drop.')
        return empty
      }
    },
    [api, folderForPath, runScan]
  )

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

  /** Curtir em lote: se TODAS já estão curtidas → remove o like de todas. */
  const likeMany = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0) return
      const allLiked = filePaths.every((p) => trackByPath.get(p)?.feedback === 'liked')
      const target: Feedback = allLiked ? 'neutral' : 'liked'
      await setFeedbackMany(filePaths, target)
      pushToast(
        'success',
        target === 'liked'
          ? `${filePaths.length} faixas nas Favoritas`
          : `${filePaths.length} faixas removidas das Favoritas`
      )
    },
    [trackByPath]
  )

  const dislikeMany = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0) return
      const allDisliked = filePaths.every((p) => trackByPath.get(p)?.feedback === 'disliked')
      const target: Feedback = allDisliked ? 'neutral' : 'disliked'
      await setFeedbackMany(filePaths, target)
      pushToast('info', target === 'disliked' ? `${filePaths.length} faixas na blacklist` : `${filePaths.length} faixas liberadas`)
    },
    [trackByPath]
  )

  const deleteTrack = useCallback(async (filePath: string, title: string) => {
    await removeTrack(filePath)
    pushToast('info', 'Removida da biblioteca', title)
  }, [])

  const deleteMany = useCallback(async (filePaths: string[]) => {
    if (filePaths.length === 0) return
    await dbRemoveTracks(filePaths)
    pushToast('info', `${filePaths.length} faixas removidas da biblioteca`, 'Os arquivos continuam no disco.')
  }, [])

  /** Incremento manual (usado só pelo devtools de telemetria / testes futuros). */
  const debugCountPlay = useCallback(async (filePath: string) => {
    await registerPlayCount(filePath)
  }, [])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(await saveSettings(patch))
  }, [])

  // ── Ações: playlists ─────────────────────────────────────────────────────

  const createPlaylist = useCallback(async (name: string): Promise<Playlist> => {
    const playlist = await dbCreatePlaylist(name)
    pushToast('success', 'Playlist criada', playlist.name)
    return playlist
  }, [])

  const renamePlaylist = useCallback(async (id: string, name: string) => {
    await dbRenamePlaylist(id, name)
  }, [])

  const deletePlaylist = useCallback(
    async (id: string) => {
      const playlist = playlists.find((p) => p.id === id)
      await dbDeletePlaylist(id)
      setActivePlaylistId((current) => (current === id ? null : current))
      if (activePlaylistId === id) {
        setViewState('all')
        setSort(DEFAULT_SORT.all)
      }
      pushToast('info', 'Playlist removida', playlist?.name)
    },
    [playlists, activePlaylistId]
  )

  /** Adiciona faixas a uma playlist; cria uma nova se `playlistId` for nulo. */
  const addTracksToPlaylist = useCallback(
    async (playlistId: string | null, filePaths: string[], name?: string): Promise<number> => {
      let targetId = playlistId
      if (!targetId) {
        const created = await dbCreatePlaylist(name?.trim() || 'Nova playlist')
        targetId = created.id
      }
      const added = await dbAddToPlaylist(targetId, filePaths)
      const playlist = playlists.find((p) => p.id === targetId)
      if (added === 0) {
        pushToast('info', 'Nada novo para adicionar', playlist ? `Todas já estão em “${playlist.name}”.` : undefined)
      } else {
        pushToast('success', `${added} faixa${added > 1 ? 's' : ''} em “${playlist?.name ?? name ?? 'playlist'}”`)
      }
      return added
    },
    [playlists]
  )

  const removeTrackFromPlaylist = useCallback(async (playlistId: string, filePath: string) => {
    await dbRemoveFromPlaylist(playlistId, filePath)
  }, [])

  const reorderPlaylistTracks = useCallback(async (playlistId: string, orderedFilePaths: string[]) => {
    await dbReorderPlaylist(playlistId, orderedFilePaths)
  }, [])

  // ── Ações: manutenção ────────────────────────────────────────────────────

  const cleanupCovers = useCallback(async () => {
    if (!api) {
      pushToast('error', 'Somente no app desktop')
      return
    }
    try {
      const known = await knownCoverPaths()
      const result = await api.cleanupCovers(known)
      pushToast(
        'success',
        result.removed === 0 ? 'Nenhuma capa órfã' : `${result.removed} capa${result.removed > 1 ? 's' : ''} órfã${result.removed > 1 ? 's' : ''} removida${result.removed > 1 ? 's' : ''}`,
        `${formatBytes(result.freedBytes)} liberados de ${result.scanned} arquivo(s) no cache.`
      )
    } catch (err) {
      pushToast('error', 'Falha na limpeza de capas', (err as Error)?.message)
    }
  }, [api])

  return {
    // estado
    view,
    setView,
    activePlaylistId,
    activePlaylist,
    openPlaylist,
    list,
    tracks,
    folders,
    playlists,
    playlistCounts: playlistIndex.counts,
    stats,
    counts,
    albums,
    sort,
    toggleSort,
    applyManualOrder,
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
    addPaths,
    toggleLike,
    toggleDislike,
    setTrackFeedback,
    likeMany,
    dislikeMany,
    deleteTrack,
    deleteMany,
    debugCountPlay,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addTracksToPlaylist,
    removeTrackFromPlaylist,
    reorderPlaylistTracks,
    cleanupCovers
  }
}

export type Library = ReturnType<typeof useLibrary>
