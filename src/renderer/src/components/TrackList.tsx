import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  GripVertical,
  Heart,
  ListEnd,
  ListPlus,
  FolderOpen,
  ListMusic,
  PencilLine,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Shuffle,
  Trash2,
  Rows2,
  Rows3,
  ShieldX,
  Search,
  X
} from 'lucide-react'
import type { Track } from '@shared/music'
import { TrackRow, GRID_TEMPLATE } from './TrackRow'
import { AlbumShelf } from './AlbumShelf'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { useCurrentTrack, useIsPlaying, usePlayerActions } from '@/hooks/useAudioPlayer'
import type { Library, SortKey } from '@/hooks/useLibrary'
import { VIEW_META } from '@/hooks/useLibrary'
import { requestText } from '@/lib/prompt'
import { formatCount, formatDurationTotal } from '@/lib/format'

/* ═══════════════════════════════════════════════════════════════════════════
 * ONDA · TRACK LIST — tabela virtualizada com ordenação dinâmica, busca,
 * seleção múltipla (Ctrl/Shift/Ctrl+A), drag & drop interno de playlists e
 * menu de contexto completo. Virtualização própria (janela fixa de linhas
 * absolutas) — 10k faixas a 60fps sem uma linha de dependência extra.
 * ═════════════════════════════════════════════════════════════════════════ */

const ROWS: Record<'comfy' | 'compact', number> = { comfy: 56, compact: 44 }
const OVERSCAN = 8

interface SortHeaderProps {
  label: string
  columnKey: SortKey
  sortKey: SortKey
  sortDir: 1 | -1
  onToggle: (key: SortKey) => void
  align?: 'left' | 'right'
  icon?: ReactElement
}

function SortHeader({ label, columnKey, sortKey, sortDir, onToggle, align = 'left', icon }: SortHeaderProps): ReactElement {
  const active = sortKey === columnKey
  return (
    <button
      type="button"
      onClick={() => onToggle(columnKey)}
      className={`group/h flex h-full w-full cursor-default items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] transition-colors ${
        align === 'right' ? 'justify-end' : ''
      } ${active ? 'text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
    >
      {icon}
      <span>{label}</span>
      <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover/h:opacity-50'}`}>
        {active ? (
          sortDir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3" />
        )}
      </span>
    </button>
  )
}

export function TrackList({ lib }: { lib: Library }): ReactElement {
  const actions = usePlayerActions()
  const currentTrack = useCurrentTrack()
  const isPlaying = useIsPlaying()
  const { list, view, sort, toggleSort, search, setSearch, stats, tracks, albums, scan, settings, updateSettings, albumFilter, setAlbumFilter } = lib

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(640)
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const lastSelectedRef = useRef<string | null>(null)
  const dragSourceRef = useRef<string | null>(null)
  const rowHeight = ROWS[settings.rowDensity]

  // media do viewport p/ virtualização
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewport(el.clientHeight))
    ro.observe(el)
    setViewport(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // volta ao topo ao trocar de view / busca
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setScrollTop(0)
  }, [view, lib.activePlaylistId, search, albumFilter, sort.key, sort.dir])

  // seleção não sobrevive a uma troca de lista (evita "seleção fantasma")
  useEffect(() => {
    setSelectedPaths(new Set<string>())
    lastSelectedRef.current = null
  }, [view, lib.activePlaylistId])

  const totalDuration = useMemo(() => list.reduce((acc, t) => acc + (t.duration || 0), 0), [list])

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
  const endIndex = Math.min(list.length, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN)
  const visible = useMemo(() => list.slice(startIndex, endIndex), [list, startIndex, endIndex])

  // ── Seleção múltipla (Ctrl/Cmd, Shift-range, Ctrl+A) ─────────────────────

  const selectedTracks = useMemo(() => list.filter((t) => selectedPaths.has(t.filePath)), [list, selectedPaths])
  const selectionSize = selectedTracks.length
  const selectionMode = selectionSize > 1

  const onRowSelect = useCallback(
    (track: Track, e: ReactMouseEvent) => {
      const index = list.findIndex((t) => t.filePath === track.filePath)
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        if (e.shiftKey && lastSelectedRef.current) {
          const anchor = list.findIndex((t) => t.filePath === lastSelectedRef.current)
          if (anchor >= 0 && index >= 0) {
            const [from, to] = anchor <= index ? [anchor, index] : [index, anchor]
            for (let i = from; i <= to; i++) {
              const row = list[i]
              if (row) next.add(row.filePath)
            }
            return next
          }
        }
        if (e.ctrlKey || e.metaKey) {
          if (next.has(track.filePath)) next.delete(track.filePath)
          else next.add(track.filePath)
          lastSelectedRef.current = track.filePath
          return next
        }
        lastSelectedRef.current = track.filePath
        return new Set<string>([track.filePath])
      })
    },
    [list]
  )

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set<string>())
    lastSelectedRef.current = null
  }, [])

  // ── Reprodução ───────────────────────────────────────────────────────────

  const playRow = useCallback(
    (track: Track) => {
      const idx = list.findIndex((t) => t.filePath === track.filePath)
      if (idx < 0) return
      if (currentTrack?.filePath === track.filePath) actions.togglePlay()
      else actions.playFromQueue(list, idx)
    },
    [list, currentTrack, actions]
  )

  const playSelection = useCallback(() => {
    const first = selectedTracks[0]
    if (!first) return
    const idx = list.findIndex((t) => t.filePath === first.filePath)
    if (idx >= 0) actions.playFromQueue(list, idx)
  }, [selectedTracks, list, actions])

  // ── Playlists: submenu "Adicionar à playlist…" ───────────────────────────

  const playlistMenuItems = useCallback(
    (filePaths: string[]): MenuItem[] => {
      const items: MenuItem[] = lib.playlists.map((playlist) => ({
        id: `pl:${playlist.id}`,
        label: playlist.name,
        icon: <ListMusic className="h-3.5 w-3.5" />,
        onSelect: () => void lib.addTracksToPlaylist(playlist.id, filePaths)
      }))
      items.push({
        id: 'pl:new',
        label: 'Nova playlist…',
        separatorBefore: items.length > 0,
        icon: <Plus className="h-3.5 w-3.5" />,
        onSelect: () => {
          void requestText({
            title: 'Nova playlist',
            description: filePaths.length > 1 ? `${filePaths.length} faixas serão adicionadas.` : undefined,
            placeholder: 'Ex.: Treino, Foco, Suno Hits',
            confirmLabel: 'Criar e adicionar'
          }).then((name) => {
            if (name) void lib.addTracksToPlaylist(null, filePaths, name)
          })
        }
      })
      return items
    },
    [lib]
  )

  // ── Menu de contexto (com ações em lote) ─────────────────────────────────

  const buildMenu = useCallback(
    (track: Track): MenuItem[] => {
      const idx = list.findIndex((t) => t.filePath === track.filePath)
      const batch = selectionSize > 1 && selectedPaths.has(track.filePath)
      const targets = batch ? selectedTracks : [track]
      const paths = targets.map((t) => t.filePath)
      const n = paths.length

      const items: MenuItem[] = [
        {
          id: 'play',
          label: batch ? `Tocar ${n} faixas` : 'Tocar agora',
          icon: <Play className="h-3.5 w-3.5" />,
          onSelect: () => (batch ? playSelection() : actions.playFromQueue(list, Math.max(idx, 0)))
        },
        { id: 'next', label: batch ? `Tocar ${n} a seguir` : 'Tocar a seguir', icon: <ListEnd className="h-3.5 w-3.5" />, onSelect: () => actions.enqueue(targets, 'next') },
        { id: 'queue', label: batch ? `Adicionar ${n} à fila` : 'Adicionar à fila', icon: <ListPlus className="h-3.5 w-3.5" />, onSelect: () => actions.enqueue(targets, 'last') },
        {
          id: 'playlist',
          label: batch ? `Adicionar ${n} à playlist…` : 'Adicionar à playlist…',
          icon: <ListMusic className="h-3.5 w-3.5" />,
          submenu: playlistMenuItems(paths)
        },
        {
          id: 'like',
          separatorBefore: true,
          label: batch ? `Curtir ${n}` : track.feedback === 'liked' ? 'Remover das Favoritas' : 'Adicionar às Favoritas',
          icon: <Heart className="h-3.5 w-3.5" fill={!batch && track.feedback === 'liked' ? 'currentColor' : 'none'} />,
          onSelect: () => (batch ? void lib.likeMany(paths) : void lib.toggleLike(track.filePath))
        },
        {
          id: 'dislike',
          label: batch ? `Rejeitar ${n}` : track.feedback === 'disliked' ? 'Remover da blacklist' : 'Rejeitar faixa',
          icon: <ShieldX className="h-3.5 w-3.5" fill={!batch && track.feedback === 'disliked' ? 'currentColor' : 'none'} />,
          onSelect: () => (batch ? void lib.dislikeMany(paths) : void lib.toggleDislike(track.filePath))
        }
      ]

      if (lib.activePlaylistId) {
        items.push({
          id: 'remove-from-playlist',
          separatorBefore: true,
          label: batch ? `Remover ${n} desta playlist` : 'Remover desta playlist',
          icon: <X className="h-3.5 w-3.5" />,
          onSelect: () => {
            for (const filePath of paths) void lib.removeTrackFromPlaylist(lib.activePlaylistId as string, filePath)
          }
        })
      }

      if (!batch) {
        items.push({
          id: 'reveal',
          separatorBefore: !lib.activePlaylistId,
          label: 'Mostrar no Explorador',
          icon: <FolderOpen className="h-3.5 w-3.5" />,
          disabled: !lib.desktop,
          onSelect: () => void window.onda?.revealInFolder(track.filePath)
        })
      }

      items.push({
        id: 'remove',
        separatorBefore: batch,
        label: batch ? `Remover ${n} da biblioteca` : 'Remover da biblioteca',
        danger: true,
        icon: <Trash2 className="h-3.5 w-3.5" />,
        onSelect: () => {
          if (batch) {
            const gone = paths
            void lib.deleteMany(gone)
            actions.purgeTracks(gone)
            clearSelection()
            return
          }
          void lib.deleteTrack(track.filePath, track.title)
          actions.notifyTrackGone(track.filePath)
        }
      })

      if (batch) {
        items.push({ id: 'clear-selection', label: 'Limpar seleção', icon: <X className="h-3.5 w-3.5" />, onSelect: clearSelection })
      }

      return items
    },
    [list, actions, lib, selectionSize, selectedPaths, selectedTracks, playSelection, playlistMenuItems, clearSelection]
  )

  const onRowContext = useCallback(
    (e: ReactMouseEvent, track: Track) => {
      e.preventDefault()
      // Clique direito fora da seleção passa a selecionar só aquela faixa.
      if (selectedPaths.size > 0 && !selectedPaths.has(track.filePath)) {
        setSelectedPaths(new Set<string>([track.filePath]))
        lastSelectedRef.current = track.filePath
      }
      showContextMenu(e.clientX, e.clientY, buildMenu(track))
    },
    [buildMenu, selectedPaths]
  )

  const onMore = useCallback(
    (e: ReactMouseEvent, track: Track) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      showContextMenu(rect.left - 180, rect.bottom + 6, buildMenu(track))
    },
    [buildMenu]
  )

  // Enter toca a seleção · Ctrl+A seleciona tudo · Esc limpa
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedPaths(new Set(list.map((t) => t.filePath)))
        return
      }
      if (e.key === 'Escape' && selectedPaths.size > 0) {
        clearSelection()
        return
      }
      if (e.key === 'Enter' && lastSelectedRef.current) {
        const track = list.find((t) => t.filePath === lastSelectedRef.current)
        if (track) playRow(track)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list, selectedPaths.size, clearSelection, playRow])

  // ── Drag & drop interno: reordenar playlist (ordem manual) ───────────────

  const canReorder =
    Boolean(lib.activePlaylistId) && sort.key === 'manual' && search.trim().length === 0 && albumFilter === null && list.length > 1

  const onDragStartRow = useCallback((track: Track, e: ReactDragEvent) => {
    dragSourceRef.current = track.filePath
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', track.filePath)
  }, [])

  const onDragOverRow = useCallback(
    (track: Track, e: ReactDragEvent) => {
      if (!canReorder || !dragSourceRef.current) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTarget(track.filePath)
    },
    [canReorder]
  )

  const onDropRow = useCallback(
    (track: Track, e: ReactDragEvent) => {
      e.preventDefault()
      const source = dragSourceRef.current
      dragSourceRef.current = null
      setDropTarget(null)
      if (!source || !canReorder || !lib.activePlaylistId) return
      const order = list.map((t) => t.filePath)
      const from = order.indexOf(source)
      const to = order.indexOf(track.filePath)
      if (from < 0 || to < 0 || from === to) return
      order.splice(from, 1)
      order.splice(to, 0, source)
      void lib.reorderPlaylistTracks(lib.activePlaylistId, order)
    },
    [canReorder, lib, list]
  )

  const onDragEndRow = useCallback(() => {
    dragSourceRef.current = null
    setDropTarget(null)
  }, [])

  // ── Ações do cabeçalho ───────────────────────────────────────────────────

  const playAll = useCallback(() => actions.playFromQueue(list, 0), [actions, list])
  const playShuffled = useCallback(() => {
    if (list.length === 0) return
    actions.playFromQueue(list, Math.floor(Math.random() * list.length))
  }, [actions, list])

  const renameActivePlaylist = useCallback(() => {
    const playlist = lib.activePlaylist
    if (!playlist) return
    void requestText({
      title: 'Renomear playlist',
      initial: playlist.name,
      confirmLabel: 'Salvar'
    }).then((name) => {
      if (name) void lib.renamePlaylist(playlist.id, name)
    })
  }, [lib])

  const openPlaylistPicker = useCallback(
    (e: ReactMouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      showContextMenu(rect.left, rect.bottom + 6, playlistMenuItems(selectedTracks.map((t) => t.filePath)))
    },
    [playlistMenuItems, selectedTracks]
  )

  const isEmptyLibrary = tracks.length === 0 && !scan.running
  const isFilteredEmpty = tracks.length > 0 && list.length === 0
  const isPlaylistView = lib.activePlaylist !== null
  const title = isPlaylistView ? (lib.activePlaylist?.name ?? 'Playlist') : VIEW_META[view].label

  return (
    <section className="relative flex h-full min-w-0 flex-1 flex-col">
      {/* aura superior sutil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(16,185,129,0.05),transparent_70%)]"
      />

      {/* cabeçalho da view */}
      <header className="relative z-10 shrink-0 px-6 pb-1 pt-5">
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-[22px] font-semibold tracking-tight text-zinc-50">
              {isPlaylistView && <ListMusic className="h-5 w-5 text-emerald-400/90" />}
              <span className="truncate-1 max-w-[420px]">{title}</span>
              {isPlaylistView && (
                <button type="button" onClick={renameActivePlaylist} title="Renomear playlist" className="icon-btn !h-7 !w-7">
                  <PencilLine className="h-3.5 w-3.5" />
                </button>
              )}
              {isPlaylistView && canReorder && (
                <span className="chip mt-0.5 gap-1 text-[10px] text-emerald-300/90" title="Arraste as linhas pela alça para reordenar">
                  <GripVertical className="h-3 w-3" />
                  ordem manual
                </span>
              )}
              {isPlaylistView && !canReorder && (
                <button
                  type="button"
                  onClick={lib.applyManualOrder}
                  title="Voltar para a ordem manual da playlist"
                  className="chip mt-0.5 gap-1 hover:border-emerald-400/40 hover:text-emerald-300"
                >
                  <GripVertical className="h-3 w-3" />
                  usar ordem manual
                </button>
              )}
              {albumFilter && (
                <button
                  type="button"
                  onClick={() => setAlbumFilter(null)}
                  className="chip mt-0.5 gap-1 hover:border-rose-400/40 hover:text-rose-300"
                  title="Limpar filtro de álbum"
                >
                  <span className="max-w-[220px] truncate-1">{albumFilter.album}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
            </h1>
            <p className="mt-1 text-[12px] text-zinc-500">
              {list.length > 0 ? (
                <>
                  <span className="tnum font-mono text-zinc-300">{formatCount(list.length)}</span>
                  {list.length !== tracks.length && <span className="text-zinc-600"> / {formatCount(tracks.length)}</span>} faixas
                  <span className="mx-1.5 text-zinc-700">·</span>
                  <span className="text-zinc-400">{formatDurationTotal(totalDuration)}</span>
                  {stats.totalPlays > 0 && (
                    <>
                      <span className="mx-1.5 text-zinc-700">·</span>
                      <span className="text-zinc-400">{formatCount(stats.totalPlays)} plays na coleção</span>
                    </>
                  )}
                </>
              ) : isPlaylistView ? (
                'Playlist vazia — adicione faixas pelo menu de contexto (botão direito) ou arraste arquivos do Explorer.'
              ) : (
                VIEW_META[view].description
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 pb-0.5">
            {/* busca */}
            <div className="group/search relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within/search:text-emerald-400" />
              <input
                data-global-search
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearch('')
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
                placeholder="Buscar (tolerante a erros)…"
                className="h-8 w-64 rounded-lg border border-white/[0.07] bg-white/[0.03] pl-8 pr-7 text-[12.5px] text-zinc-200 outline-none transition-all duration-200 placeholder:text-zinc-600 focus:w-80 focus:border-emerald-500/30 focus:bg-white/[0.05] focus:ring-2 focus:ring-emerald-500/10"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="icon-btn absolute right-0.5 top-1/2 !h-6 w-6 -translate-y-1/2" title="Limpar">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="h-5 w-px bg-white/[0.07]" />

            <button
              type="button"
              onClick={playAll}
              disabled={list.length === 0}
              className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-lg bg-zinc-100 px-3.5 text-[12px] font-semibold text-zinc-950 transition-all duration-150 hover:scale-[1.02] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5" fill="currentColor" />
              Tocar
            </button>
            <button
              type="button"
              onClick={playShuffled}
              disabled={list.length === 0}
              title="Tocar tudo em modo aleatório (a blacklist é ignorada)"
              className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 text-[12px] font-medium text-zinc-300 transition-all duration-150 hover:border-emerald-400/30 hover:text-emerald-300 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
            >
              <Shuffle className="h-3.5 w-3.5" />
              Aleatório
            </button>
          </div>
        </div>
      </header>

      {/* barra de seleção múltipla */}
      {selectionSize > 0 && (
        <div className="relative z-10 mx-6 mt-2 flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1.5 text-[11.5px] text-emerald-100">
          <span className="tnum font-mono text-[11px] font-semibold text-emerald-300">{formatCount(selectionSize)}</span>
          <span className="text-emerald-200/80">selecionada{selectionSize > 1 ? 's' : ''}</span>
          <div className="mx-1 h-4 w-px bg-emerald-400/20" />
          <button type="button" onClick={playSelection} className="inline-flex h-6 cursor-default items-center gap-1 rounded-md px-1.5 text-[11.5px] text-emerald-100 transition-colors hover:bg-emerald-400/10">
            <Play className="h-3 w-3" fill="currentColor" />
            Tocar
          </button>
          <button
            type="button"
            onClick={() => actions.enqueue(selectedTracks, 'last')}
            className="inline-flex h-6 cursor-default items-center gap-1 rounded-md px-1.5 text-[11.5px] text-emerald-100 transition-colors hover:bg-emerald-400/10"
          >
            <ListPlus className="h-3 w-3" />
            Fila
          </button>
          <button
            type="button"
            onClick={openPlaylistPicker}
            className="inline-flex h-6 cursor-default items-center gap-1 rounded-md px-1.5 text-[11.5px] text-emerald-100 transition-colors hover:bg-emerald-400/10"
          >
            <ListMusic className="h-3 w-3" />
            Playlist…
          </button>
          <button
            type="button"
            onClick={() => void lib.likeMany(selectedTracks.map((t) => t.filePath))}
            className="inline-flex h-6 cursor-default items-center gap-1 rounded-md px-1.5 text-[11.5px] text-amber-200 transition-colors hover:bg-amber-400/10"
          >
            <Heart className="h-3 w-3" />
            Curtir
          </button>
          <button
            type="button"
            onClick={() => void lib.dislikeMany(selectedTracks.map((t) => t.filePath))}
            className="inline-flex h-6 cursor-default items-center gap-1 rounded-md px-1.5 text-[11.5px] text-rose-200 transition-colors hover:bg-rose-400/10"
          >
            <ShieldX className="h-3 w-3" />
            Rejeitar
          </button>
          <button
            type="button"
            onClick={() => {
              const paths = selectedTracks.map((t) => t.filePath)
              void lib.deleteMany(paths)
              actions.purgeTracks(paths)
              clearSelection()
            }}
            className="inline-flex h-6 cursor-default items-center gap-1 rounded-md px-1.5 text-[11.5px] text-rose-200 transition-colors hover:bg-rose-400/10"
          >
            <Trash2 className="h-3 w-3" />
            Remover
          </button>
          <button type="button" onClick={clearSelection} className="ml-auto inline-flex h-6 cursor-default items-center gap-1 rounded-md px-1.5 text-[11.5px] text-emerald-200/80 transition-colors hover:bg-emerald-400/10">
            <X className="h-3 w-3" />
            Limpar
          </button>
        </div>
      )}

      {/* estante de capas / visualizador de álbuns */}
      {albums.length > 1 && <AlbumShelf albums={albums} activeKey={albumFilter ? `${albumFilter.album}\u0000${albumFilter.artist}` : null} onSelect={(a) => setAlbumFilter(a)} onClear={() => setAlbumFilter(null)} />}

      {/* barra de densidade / scan */}
      {scan.running && (
        <div className="mx-6 mb-1 mt-2 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[11px] text-zinc-400">
          <RefreshCw className="h-3 w-3 animate-spin text-emerald-400" />
          <span className="truncate">{scan.progress?.current ? `Lendo tags de "${scan.progress.current}"` : 'Varrendo o disco…'}</span>
          <span className="tnum ml-auto font-mono text-[10.5px] text-zinc-500">
            {scan.progress ? `${formatCount(scan.progress.done)}/${formatCount(scan.progress.total)}` : ''}
          </span>
        </div>
      )}

      {/* tabela */}
      <div className="relative z-0 mt-2 flex min-h-0 flex-1 flex-col">
        <div className={`${GRID_TEMPLATE} shrink-0 border-b border-white/[0.06] px-5 pr-8`}>
          <div className="flex h-8 items-center justify-center text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-500">#</div>
          <SortHeader label="Título" columnKey="title" sortKey={sort.key} sortDir={sort.dir} onToggle={toggleSort} />
          <SortHeader label="Artista" columnKey="artist" sortKey={sort.key} sortDir={sort.dir} onToggle={toggleSort} />
          <SortHeader label="Álbum" columnKey="album" sortKey={sort.key} sortDir={sort.dir} onToggle={toggleSort} />
          <SortHeader label="Plays" columnKey="playCount" sortKey={sort.key} sortDir={sort.dir} onToggle={toggleSort} align="right" />
          <SortHeader label="Duração" columnKey="duration" sortKey={sort.key} sortDir={sort.dir} onToggle={toggleSort} align="right" />
          <div className="flex h-8 items-center justify-end gap-1 pr-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            {canReorder && (
              <span className="hidden items-center text-emerald-400/70 xl:inline-flex" title="Arraste as linhas para reordenar a playlist">
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            )}
            <button
              type="button"
              title={settings.rowDensity === 'comfy' ? 'Densidade compacta' : 'Densidade confortável'}
              onClick={() => void updateSettings({ rowDensity: settings.rowDensity === 'comfy' ? 'compact' : 'comfy' })}
              className="icon-btn !h-6 !w-6"
            >
              {settings.rowDensity === 'comfy' ? <Rows2 className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2"
          role="table"
          aria-rowcount={list.length}
        >
          {isEmptyLibrary ? (
            <EmptyLibrary onImport={() => void lib.importFolder()} desktop={lib.desktop} scanning={scan.running} />
          ) : isFilteredEmpty ? (
            <EmptyFilter
              search={search}
              playlist={isPlaylistView}
              onClear={() => setSearch('')}
              onImport={() => void lib.rescanAll()}
            />
          ) : (
            <div className="relative" style={{ height: list.length * rowHeight }}>
              {visible.map((t, i) => {
                const idx = startIndex + i
                return (
                  <div key={t.filePath} className="absolute inset-x-0" style={{ top: idx * rowHeight, height: rowHeight }}>
                    <TrackRow
                      track={t}
                      displayNumber={idx + 1}
                      isCurrent={currentTrack?.filePath === t.filePath}
                      isPlaying={isPlaying && currentTrack?.filePath === t.filePath}
                      isSelected={selectedPaths.has(t.filePath)}
                      selectionMode={selectionMode}
                      height={rowHeight}
                      isDisliked={t.feedback === 'disliked'}
                      reorderable={canReorder}
                      isDropTarget={dropTarget === t.filePath}
                      onSelect={onRowSelect}
                      onPlay={playRow}
                      onContextMenu={onRowContext}
                      onToggleLike={(track) => void lib.toggleLike(track.filePath)}
                      onToggleDislike={(track) => void lib.toggleDislike(track.filePath)}
                      onMore={onMore}
                      onDragStartRow={onDragStartRow}
                      onDragOverRow={onDragOverRow}
                      onDropRow={onDropRow}
                      onDragEndRow={onDragEndRow}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/* ── Empty states desenhados (nunca "sem resultados :(" pelado) ───────────── */

function EmptyLibrary({ onImport, desktop, scanning }: { onImport: () => void; desktop: boolean; scanning: boolean }): ReactElement {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-8 text-center">
      <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent">
        <RadioTower className="h-7 w-7 text-emerald-400/80" />
        {scanning && <span className="absolute -inset-2 animate-ping rounded-2xl border border-emerald-500/20" />}
      </div>
      <h2 className="text-[16px] font-semibold text-zinc-100">Sua frequência está no vácuo</h2>
      <p className="mt-1.5 max-w-[400px] text-[12.5px] leading-relaxed text-zinc-500">
        {scanning
          ? 'Lendo tags ID3/Vorbis, extraindo capas e montando as listas inteligentes…'
          : 'Aponte o Onda para uma pasta com suas músicas — ou arraste arquivos/pastas do Explorer para cá. Metadados, durações e capas são lidos 100% offline e indexados no IndexedDB.'}
      </p>
      {desktop && !scanning && (
        <button
          type="button"
          onClick={onImport}
          className="mt-5 inline-flex h-9 cursor-default items-center gap-2 rounded-lg bg-zinc-100 px-4 text-[12.5px] font-semibold text-zinc-950 transition-transform hover:scale-[1.02] active:scale-[0.97]"
        >
          <FolderOpen className="h-4 w-4" />
          Importar pasta de música
        </button>
      )}
      {!desktop && (
        <p className="chip mt-4 text-[11px] text-zinc-400">Acesso ao disco exige o app desktop — rode via Electron</p>
      )}
    </div>
  )
}

function EmptyFilter({
  search,
  playlist,
  onClear,
  onImport
}: {
  search: string
  playlist: boolean
  onClear: () => void
  onImport: () => void
}): ReactElement {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-8 text-center">
      <Search className="mb-3 h-6 w-6 text-zinc-700" />
      <h2 className="text-[14px] font-semibold text-zinc-200">
        {search ? <>Nada corresponde a <span className="text-zinc-50">“{search}”</span></> : playlist ? 'Esta playlist está vazia' : 'Esta lista está vazia por enquanto'}
      </h2>
      <p className="mt-1 max-w-[380px] text-[12px] leading-relaxed text-zinc-500">
        {search
          ? 'Tente outros termos — a busca tolera erros de digitação.'
          : playlist
            ? 'Selecione faixas em qualquer lista (Ctrl+clique / Shift+clique) e use “Adicionar à playlist…”, ou arraste músicas do Explorer para a janela.'
            : 'Curta músicas (♥) para popular Favoritas, ou re-escaneie suas pastas para achar novas faixas.'}
      </p>
      <div className="mt-4 flex items-center gap-2">
        {search && (
          <button type="button" onClick={onClear} className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.06]">
            <X className="h-3.5 w-3.5" />
            Limpar busca
          </button>
        )}
        <button type="button" onClick={onImport} className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.06]">
          <RefreshCw className="h-3.5 w-3.5" />
          Re-escanear
        </button>
      </div>
    </div>
  )
}
