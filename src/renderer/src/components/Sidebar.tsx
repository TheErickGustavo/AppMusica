import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import { motion } from 'framer-motion'
import {
  Database,
  FolderPlus,
  FolderX,
  Heart,
  ImageOff,
  ListMusic,
  MoreHorizontal,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  ShieldX,
  Sparkles,
  Trash2,
  TrendingUp,
  X
} from 'lucide-react'
import { AppIcon } from './AppIcon'
import { showContextMenu, type MenuItem } from './ContextMenu'
import type { Library, SmartViewId } from '@/hooks/useLibrary'
import { VIEW_META } from '@/hooks/useLibrary'
import { requestText } from '@/lib/prompt'
import { formatCount, formatDurationTotal, formatBytes } from '@/lib/format'

const NAV: { id: SmartViewId; label: string; icon: typeof ListMusic; accent: string }[] = [
  { id: 'all', label: VIEW_META.all.label, icon: ListMusic, accent: 'text-zinc-100' },
  { id: 'top', label: VIEW_META.top.label, icon: TrendingUp, accent: 'text-zinc-100' },
  { id: 'favorites', label: VIEW_META.favorites.label, icon: Heart, accent: 'text-amber-400' },
  { id: 'disliked', label: VIEW_META.disliked.label, icon: ShieldX, accent: 'text-rose-400' }
]

function SectionTitle({ children, right }: { children: ReactElement | string; right?: ReactElement }): ReactElement {
  return (
    <div className="flex h-8 items-center justify-between px-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{children}</span>
      {right}
    </div>
  )
}

function Stat({ label, value, tone = 'text-zinc-100' }: { label: string; value: string; tone?: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-white/[0.04] bg-white/[0.02] px-2.5 py-2">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  )
}

function SettingToggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
}): ReactElement {
  return (
    <label className="mt-1.5 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] px-2.5 py-2" title={hint}>
      <span className="text-[11.5px] leading-tight text-zinc-400">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer appearance-none rounded-[4px] border border-white/15 bg-transparent transition-colors checked:border-emerald-400/60 checked:bg-emerald-500/80"
      />
    </label>
  )
}

export function Sidebar({ lib }: { lib: Library }): ReactElement {
  const { stats, counts, folders, view, setView, scan, settings, updateSettings } = lib
  const [storage, setStorage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!navigator.storage?.estimate) return
    void navigator.storage.estimate().then((est) => {
      if (!cancelled && est.usage != null) setStorage(formatBytes(est.usage))
    })
    return () => {
      cancelled = true
    }
  }, [])

  // ── Playlists customizadas ───────────────────────────────────────────────

  const createNewPlaylist = useCallback(async () => {
    const name = await requestText({
      title: 'Nova playlist',
      placeholder: 'Ex.: Treino, Foco, Suno Hits',
      confirmLabel: 'Criar playlist'
    })
    if (!name) return
    const playlist = await lib.createPlaylist(name)
    lib.openPlaylist(playlist.id)
  }, [lib])

  const playlistMenu = useCallback(
    (playlistId: string, name: string): MenuItem[] => [
      {
        id: 'play',
        label: 'Tocar playlist',
        icon: <ListMusic className="h-3.5 w-3.5" />,
        onSelect: () => lib.openPlaylist(playlistId)
      },
      {
        id: 'rename',
        label: 'Renomear…',
        separatorBefore: true,
        icon: <PencilLine className="h-3.5 w-3.5" />,
        onSelect: () => {
          void requestText({ title: 'Renomear playlist', initial: name, confirmLabel: 'Salvar' }).then((next) => {
            if (next) void lib.renamePlaylist(playlistId, next)
          })
        }
      },
      {
        id: 'delete',
        label: 'Excluir playlist',
        danger: true,
        icon: <Trash2 className="h-3.5 w-3.5" />,
        onSelect: () => void lib.deletePlaylist(playlistId)
      }
    ],
    [lib]
  )

  /** Delegação: menu de contexto da playlist na posição do cursor. */
  const onPlaylistContext = useCallback(
    (e: ReactMouseEvent, playlistId: string, name: string) => {
      e.preventDefault()
      showContextMenu(e.clientX, e.clientY, playlistMenu(playlistId, name))
    },
    [playlistMenu]
  )

  return (
    <aside className="flex h-full w-[264px] shrink-0 select-none flex-col border-r border-white/[0.06] bg-zinc-950">
      {/* marca */}
      <div className="flex items-center gap-3 px-4 pb-2 pt-4">
        <AppIcon size={30} />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight tracking-tight text-zinc-50">Onda</div>
          <div className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            local soundscape engine
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1 pt-0.5">
          {scan.running ? (
            <button
              type="button"
              title="Cancelar escaneamento"
              onClick={lib.cancelScan}
              className="icon-btn !h-7 !w-7 text-rose-400 hover:text-rose-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              title="Re-escanear todas as pastas"
              onClick={lib.rescanAll}
              className="icon-btn !h-7 !w-7"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            title="Importar pasta de música"
            onClick={() => void lib.importFolder()}
            className="icon-btn !h-7 !w-7"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* status do scan */}
      {scan.running && (
        <div className="mx-3 mb-1 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.06] px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] font-medium text-emerald-400">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Indexando coleção…
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] text-zinc-500">{scan.progress?.current || scan.progress?.stage || 'procurando arquivos'}</span>
            <span className="font-mono text-[10px] tabular-nums text-zinc-400">
              {scan.progress ? `${scan.progress.done}/${scan.progress.total}` : ''}
            </span>
          </div>
        </div>
      )}

      <nav className="mt-2">
        <SectionTitle>Descobrir</SectionTitle>
        <div className="px-2">
          <button
            type="button"
            onClick={() => {
              const input = document.querySelector<HTMLInputElement>('[data-global-search]')
              input?.focus()
              input?.select()
            }}
            className="group flex h-9 w-full items-center gap-2.5 rounded-lg px-1 text-left text-[13px] text-zinc-400 transition-colors hover:text-zinc-100"
          >
            <Search className="h-4 w-4" />
            Buscar na biblioteca
            <span className="ml-auto font-mono text-[10px] text-zinc-600">/</span>
          </button>
        </div>

        <div className="mt-2">
          <SectionTitle>Sua Biblioteca</SectionTitle>
        </div>
        <ul className="space-y-0.5 px-2">
          {NAV.map(({ id, label, icon: Icon, accent }) => {
            const active = view === id && !lib.activePlaylistId
            const count = counts[id]
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setView(id)}
                  className={`group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium transition-colors duration-150 ${
                    active ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      transition={{ type: 'spring', stiffness: 500, damping: 38, mass: 0.6 }}
                      className="absolute inset-0 rounded-lg border border-white/[0.06] bg-white/[0.07]"
                    />
                  )}
                  <Icon className={`relative z-10 h-4 w-4 ${active ? accent : ''}`} />
                  <span className="relative z-10 truncate">{label}</span>
                  <span className="relative z-10 ml-auto font-mono text-[11px] tabular-nums text-zinc-500 group-hover:text-zinc-400">
                    {formatCount(count)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {/* playlists customizadas */}
        <div className="mt-5">
          <SectionTitle
            right={
              <button type="button" onClick={() => void createNewPlaylist()} className="icon-btn !h-6 !w-6" title="Nova playlist">
                <Plus className="h-3.5 w-3.5" />
              </button>
            }
          >
            Playlists
          </SectionTitle>
        </div>

        {lib.playlists.length === 0 ? (
          <div className="mx-2 mt-1 rounded-lg border border-dashed border-white/[0.08] px-3 py-3.5">
            <p className="text-[12px] font-medium text-zinc-300">Nenhuma playlist ainda</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              Crie “Treino”, “Foco”, “Suno Hits”… e mande faixas pra dentro pelo menu de contexto.
            </p>
            <button
              type="button"
              onClick={() => void createNewPlaylist()}
              className="mt-2 inline-flex h-7 cursor-default items-center gap-1.5 rounded-md bg-zinc-100 px-2.5 text-[11px] font-semibold text-zinc-950 transition-transform hover:scale-[1.02] active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" />
              Nova playlist
            </button>
          </div>
        ) : (
          <ul className="space-y-0.5 px-2">
            {lib.playlists.map((playlist) => {
              const active = lib.activePlaylistId === playlist.id
              const count = lib.playlistCounts.get(playlist.id) ?? 0
              return (
                <li key={playlist.id}>
                  <div
                    onContextMenu={(e) => onPlaylistContext(e, playlist.id, playlist.name)}
                    className={`group relative flex h-9 items-center gap-2 rounded-lg transition-colors duration-150 ${
                      active ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="playlist-active"
                        transition={{ type: 'spring', stiffness: 500, damping: 38, mass: 0.6 }}
                        className="absolute inset-0 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08]"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => lib.openPlaylist(playlist.id)}
                      title={playlist.name}
                      className="relative z-10 flex h-full min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left text-[13px] font-medium"
                    >
                      <ListMusic className={`h-4 w-4 shrink-0 ${active ? 'text-emerald-400' : ''}`} />
                      <span className="truncate">{playlist.name}</span>
                      <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-500">{formatCount(count)}</span>
                    </button>
                    <button
                      type="button"
                      title="Ações da playlist"
                      onClick={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        showContextMenu(rect.right - 232, rect.bottom + 4, playlistMenu(playlist.id, playlist.name))
                      }}
                      className="icon-btn relative z-10 -ml-1 mr-1 !h-6 !w-6 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* pastas vigiadas */}
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          <SectionTitle
            right={
              <button type="button" onClick={() => void lib.importFolder()} className="icon-btn !h-6 !w-6" title="Adicionar pasta">
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            }
          >
            Pastas
          </SectionTitle>
          {folders.length === 0 ? (
            <div className="mx-2 mt-1 rounded-lg border border-dashed border-white/[0.08] px-3 py-3.5">
              <p className="text-[12px] font-medium text-zinc-300">Nenhuma pasta vigiada</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                Importe um diretório local — .mp3, .flac, .m4a, .wav, .ogg… Tudo fica offline.
              </p>
              <button
                type="button"
                onClick={() => void lib.importFolder()}
                className="mt-2 inline-flex h-7 cursor-default items-center gap-1.5 rounded-md bg-zinc-100 px-2.5 text-[11px] font-semibold text-zinc-950 transition-transform hover:scale-[1.02] active:scale-95"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                Importar pasta
              </button>
            </div>
          ) : (
            <ul className="space-y-0.5 px-2">
              {folders.map((f) => {
                const name = f.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? f.path
                const lastScan = f.lastScanAt ? new Date(f.lastScanAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : 'nunca'
                return (
                  <li key={f.path} className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-white/[0.04]">
                    <button
                      type="button"
                      title={f.path}
                      onClick={() => void lib.rescanFolder(f.path)}
                      className="flex min-w-0 flex-1 cursor-default flex-col items-start text-left"
                    >
                      <span className="max-w-full truncate text-[12.5px] font-medium text-zinc-300 group-hover:text-zinc-100">{name}</span>
                      <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                        {settings.watchFolders && <span className="h-1 w-1 rounded-full bg-emerald-400/80" title="Vigiada em tempo real" />}
                        scan: {lastScan}
                      </span>
                    </button>
                    <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        title="Escanear novamente"
                        onClick={() => void lib.rescanFolder(f.path)}
                        className="icon-btn !h-6 !w-6"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="Remover pasta e suas faixas da biblioteca"
                        onClick={() => void lib.dropFolder(f.path)}
                        className="icon-btn !h-6 !w-6 hover:!text-rose-400"
                      >
                        <FolderX className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </nav>

      {/* estatísticas globais */}
      <div className="border-t border-white/[0.06] px-3 pb-3 pt-3">
        <SectionTitle>Telemetria da Biblioteca</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Faixas" value={formatCount(stats.total)} />
          <Stat label="Reproduções" value={formatCount(stats.totalPlays)} tone="text-emerald-400" />
          <Stat label="Favoritas" value={formatCount(stats.liked)} tone="text-amber-400" />
          <Stat label="Rejeitadas" value={formatCount(stats.disliked)} tone="text-rose-400" />
        </div>
        <div className="mt-2.5 flex items-center justify-between px-1 text-[10.5px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <Database className="h-3 w-3" />
            {storage ? `IndexedDB ${storage}` : 'IndexedDB local'}
          </span>
          <span className="font-mono tabular-nums">{stats.total > 0 ? formatDurationTotal(stats.totalDuration) : '0 min'}</span>
        </div>

        <SettingToggle
          label="Vigiar pastas em tempo real"
          hint="Músicas baixadas com outro app entram sozinhas na biblioteca."
          checked={settings.watchFolders}
          onChange={(value) => void updateSettings({ watchFolders: value })}
        />
        <SettingToggle
          label="Re-escanear pastas ao abrir"
          checked={settings.autoRescanOnLaunch}
          onChange={(value) => void updateSettings({ autoRescanOnLaunch: value })}
        />
        <SettingToggle
          label="Fechar para a bandeja"
          hint="X esconde a janela e a música continua tocando."
          checked={settings.closeToTray}
          onChange={(value) => void updateSettings({ closeToTray: value })}
        />
        <SettingToggle
          label="Crossfade no fim da faixa"
          hint="Fade-out de 2s quando falta pouco para a próxima faixa."
          checked={settings.crossfade}
          onChange={(value) => void updateSettings({ crossfade: value })}
        />

        <button
          type="button"
          onClick={() => void lib.cleanupCovers()}
          disabled={!lib.desktop}
          className="mt-2 flex h-8 w-full cursor-default items-center justify-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-[11.5px] font-medium text-zinc-400 transition-colors hover:border-white/[0.12] hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40"
        >
          <ImageOff className="h-3.5 w-3.5" />
          Limpar cache de capas órfãs
        </button>
        <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[10.5px] leading-relaxed text-zinc-600">
          <Sparkles className="h-3 w-3 text-emerald-500/70" />
          {settings.watchFolders ? 'Watcher ativo: novas músicas aparecem sem clicar em nada.' : 'Watcher desligado — use Re-escanear.'}
        </p>
      </div>
    </aside>
  )
}
