import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  Feedback,
  FolderEntry,
  LibrarySyncResult,
  Playlist,
  PlaylistTrack,
  ScanResponse,
  Track,
  TrackScanInput
} from '@shared/music'

/**
 * Banco local (IndexedDB via Dexie) — ultrarrápido, 100% offline.
 *
 *  - `tracks.filePath` é a chave primária (identidade estável do arquivo).
 *  - Capas NÃO vão para o IndexedDB: ficam em cache de disco no userData
 *    e são servidas via `media://cover/...` — IndexedDB guarda só metadados,
 *    mantendo consultas reativas em tempo de biblioteca de 10k faixas.
 *  - Telemetria (playCount/lastPlayedAt/feedback) sobrevive a re-scans:
 *    o sincronizador nunca zera contadores de faixas já conhecidas.
 *
 * v2 adiciona playlists customizadas (`playlists` + `playlist_tracks`) SEM
 * tocar na tabela `tracks`: a migration é puramente aditiva, então playCount,
 * lastPlayedAt e feedback de quem já usava o app continuam intactos.
 */

export interface MetaEntry {
  key: string
  value: unknown
}

class OndaDatabase extends Dexie {
  tracks!: EntityTable<Track, 'filePath'>
  folders!: EntityTable<FolderEntry, 'path'>
  meta!: EntityTable<MetaEntry, 'key'>
  playlists!: EntityTable<Playlist, 'id'>
  /** Chave composta [playlistId+filePath] — dedup garantida pelo schema. */
  playlist_tracks!: Table<PlaylistTrack, [string, string]>

  constructor() {
    super('onda-library')
    this.version(1).stores({
      // Índices para cada lista inteligente + ordenações da tabela.
      tracks:
        'filePath, title, artist, album, feedback, playCount, lastPlayedAt, addedAt, folder, [folder+feedback], [folder+playCount]',
      folders: 'path',
      meta: 'key'
    })

    this.version(2).stores({
      // Tabelas v1 re-declaradas com schema idêntico (nada é apagado).
      tracks:
        'filePath, title, artist, album, feedback, playCount, lastPlayedAt, addedAt, folder, [folder+feedback], [folder+playCount]',
      folders: 'path',
      meta: 'key',
      // Novas: playlists do usuário + vínculo ordenado faixa↔playlist.
      playlists: 'id, name, createdAt, updatedAt',
      playlist_tracks: '[playlistId+filePath], playlistId, filePath, order, addedAt'
    })
  }
}

export const db = new OndaDatabase()

// ─── Sincronização pós-scan (reconcile incremental) ────────────────────────

/**
 * Aplica o resultado de um scan do main process:
 *  - upsert das faixas novas/alteradas preservando telemetria;
 *  - remoção de faixas cujo arquivo sumiu do disco;
 *  - atualização do registro da pasta vigiada.
 */
export async function applyScanResponse(res: ScanResponse): Promise<LibrarySyncResult> {
  const now = Date.now()
  let added = 0
  let updated = 0
  let removed = 0

  return db.transaction('rw', db.tracks, db.folders, db.playlist_tracks, async () => {
    const previous = await db.tracks.where('folder').equals(res.dir).toArray()
    const prevByPath = new Map(previous.map((t) => [t.filePath, t] as const))

    // Upsert das faixas novas/alteradas preservando telemetria existente.
    const upsertOps = res.changed.map((input) => {
      const prev = prevByPath.get(input.filePath)
      const record: Track = {
        ...input,
        folder: res.dir,
        playCount: prev?.playCount ?? 0,
        lastPlayedAt: prev?.lastPlayedAt ?? null,
        feedback: prev?.feedback ?? 'neutral',
        addedAt: prev?.addedAt ?? now,
        scannedAt: res.scannedAt
      }
      if (prev) updated++
      else added++
      // put() também cobre o caso de a faixa ter mudado de pasta-raiz.
      return db.tracks.put(record)
    })
    await Promise.all(upsertOps)

    // Remove faixas cujo arquivo não existe mais no disco.
    const stillExists = new Set<string>([...res.unchanged, ...res.changed.map((c) => c.filePath)])
    const missing = previous.filter((t) => !stillExists.has(t.filePath))
    removed = missing.length
    if (missing.length > 0) {
      const missingPaths = missing.map((t) => t.filePath)
      await db.tracks.bulkDelete(missingPaths)
      // Vínculos de playlist apontando para arquivos que sumiram caem junto.
      await db.playlist_tracks.where('filePath').anyOf(missingPaths).delete()
    }

    const folderRow = await db.folders.get(res.dir)
    await db.folders.put({ path: res.dir, addedAt: folderRow?.addedAt ?? now, lastScanAt: res.scannedAt })

    return { added, updated, removed, unchanged: res.unchanged.length }
  })
}

/**
 * Upsert de UMA faixa vinda do watcher de pastas (arquivo baixado por outro
 * app enquanto o ONDA está aberto). Mesma regra de preservação de telemetria
 * do scan: se a faixa já existe, o contador e o feedback sobrevivem.
 */
export async function upsertWatchedTrack(input: TrackScanInput, folder: string): Promise<{ added: boolean }> {
  const now = Date.now()
  return db.transaction('rw', db.tracks, async () => {
    const prev = await db.tracks.get(input.filePath)
    const record: Track = {
      ...input,
      folder,
      playCount: prev?.playCount ?? 0,
      lastPlayedAt: prev?.lastPlayedAt ?? null,
      feedback: prev?.feedback ?? 'neutral',
      addedAt: prev?.addedAt ?? now,
      scannedAt: now
    }
    await db.tracks.put(record)
    return { added: prev === undefined }
  })
}

/** Upsert em lote (vários arquivos dropados de uma vez). */
export async function upsertWatchedTracks(entries: { track: TrackScanInput; folder: string }[]): Promise<number> {
  const now = Date.now()
  let added = 0
  await db.transaction('rw', db.tracks, async () => {
    for (const { track, folder } of entries) {
      const prev = await db.tracks.get(track.filePath)
      if (!prev) added++
      const record: Track = {
        ...track,
        folder,
        playCount: prev?.playCount ?? 0,
        lastPlayedAt: prev?.lastPlayedAt ?? null,
        feedback: prev?.feedback ?? 'neutral',
        addedAt: prev?.addedAt ?? now,
        scannedAt: now
      }
      await db.tracks.put(record)
    }
  })
  return added
}

/** Remove uma faixa do arquivo do disco? Não — só do índice do app. */
export async function removeTrack(filePath: string): Promise<void> {
  await db.transaction('rw', db.tracks, db.playlist_tracks, async () => {
    await db.tracks.delete(filePath)
    await db.playlist_tracks.where('filePath').equals(filePath).delete()
  })
}

/** Remoção em lote (seleção múltipla / Ctrl+A). Nunca toca no arquivo. */
export async function removeTracks(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return
  await db.transaction('rw', db.tracks, db.playlist_tracks, async () => {
    await db.tracks.bulkDelete(filePaths)
    await db.playlist_tracks.where('filePath').anyOf(filePaths).delete()
  })
}

// ─── Telemetria (feedback / plays) ─────────────────────────────────────────

export async function setFeedback(filePath: string, feedback: Feedback): Promise<void> {
  await db.tracks.update(filePath, { feedback })
}

/** Aplica o mesmo feedback a várias faixas (ações em lote da seleção). */
export async function setFeedbackMany(filePaths: string[], feedback: Feedback): Promise<void> {
  if (filePaths.length === 0) return
  await db.transaction('rw', db.tracks, async () => {
    await db.tracks.where('filePath').anyOf(filePaths).modify({ feedback })
  })
}

/** Toggle: clicar de novo no mesmo estado limpa o feedback (→ neutral). */
export async function toggleFeedback(filePath: string, kind: 'liked' | 'disliked'): Promise<Feedback> {
  const track = await db.tracks.get(filePath)
  const next: Feedback = track?.feedback === kind ? 'neutral' : kind
  await db.tracks.update(filePath, { feedback: next })
  return next
}

/** Incremento de play count — chamado SOMENTE quando a regra anti-spam dispara. */
export async function registerPlayCount(filePath: string): Promise<void> {
  await db.transaction('rw', db.tracks, async () => {
    const track = await db.tracks.get(filePath)
    if (!track) return
    await db.tracks.update(filePath, {
      playCount: (track.playCount ?? 0) + 1,
      lastPlayedAt: Date.now()
    })
  })
}

export async function touchLastPlayed(filePath: string): Promise<void> {
  await db.tracks.update(filePath, { lastPlayedAt: Date.now() })
}

// ─── Pastas vigiadas ───────────────────────────────────────────────────────

export async function addFolder(path: string): Promise<void> {
  await db.folders.put({ path, addedAt: Date.now(), lastScanAt: null })
}

export async function removeFolder(path: string, alsoClearTracks: boolean): Promise<void> {
  await db.transaction('rw', db.tracks, db.folders, db.playlist_tracks, async () => {
    await db.folders.delete(path)
    if (alsoClearTracks) {
      const victims = (await db.tracks.where('folder').equals(path).toArray()).map((t) => t.filePath)
      if (victims.length > 0) {
        await db.tracks.bulkDelete(victims)
        await db.playlist_tracks.where('filePath').anyOf(victims).delete()
      }
    }
  })
}

export async function clearLibrary(): Promise<void> {
  await db.transaction('rw', db.tracks, db.folders, db.playlist_tracks, async () => {
    await db.tracks.clear()
    await db.folders.clear()
    await db.playlist_tracks.clear()
  })
}

// ─── Playlists customizadas ────────────────────────────────────────────────

function newPlaylistId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export async function createPlaylist(name: string): Promise<Playlist> {
  const now = Date.now()
  const playlist: Playlist = {
    id: newPlaylistId(),
    name: name.trim() || 'Nova playlist',
    createdAt: now,
    updatedAt: now
  }
  await db.playlists.put(playlist)
  return playlist
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  await db.playlists.update(id, { name: name.trim() || 'Sem nome', updatedAt: Date.now() })
}

export async function deletePlaylist(id: string): Promise<void> {
  await db.transaction('rw', db.playlists, db.playlist_tracks, async () => {
    await db.playlists.delete(id)
    await db.playlist_tracks.where('playlistId').equals(id).delete()
  })
}

/**
 * Adiciona faixas ao fim da playlist. Ignora duplicatas — o schema composto
 * já impediria, mas checar antes evita reordenar o que já está lá.
 */
export async function addToPlaylist(playlistId: string, filePaths: string[]): Promise<number> {
  const unique = [...new Set(filePaths)]
  if (unique.length === 0) return 0
  return db.transaction('rw', db.playlists, db.playlist_tracks, db.tracks, async () => {
    const playlist = await db.playlists.get(playlistId)
    if (!playlist) return 0

    const existing = await db.playlist_tracks.where('playlistId').equals(playlistId).toArray()
    const already = new Set(existing.map((row) => row.filePath))
    let nextOrder = existing.reduce((max, row) => Math.max(max, row.order), -1) + 1

    // Só entra o que existe de fato na biblioteca (playlist não vira link morto).
    const candidates: Track[] = await db.tracks.where('filePath').anyOf(unique).toArray()
    const byPath = new Map(candidates.map((t) => [t.filePath, t] as const))

    const rows: PlaylistTrack[] = []
    for (const filePath of unique) {
      if (already.has(filePath)) continue
      if (!byPath.has(filePath)) continue
      rows.push({ playlistId, filePath, order: nextOrder++, addedAt: Date.now() })
    }
    if (rows.length === 0) return 0

    await db.playlist_tracks.bulkPut(rows)
    await db.playlists.update(playlistId, { updatedAt: Date.now() })
    return rows.length
  })
}

/** Remove uma faixa da playlist e compacta as posições restantes. */
export async function removeFromPlaylist(playlistId: string, filePath: string): Promise<void> {
  await db.transaction('rw', db.playlists, db.playlist_tracks, async () => {
    await db.playlist_tracks.delete([playlistId, filePath])
    const rest = (await db.playlist_tracks.where('playlistId').equals(playlistId).toArray()).sort(
      (a, b) => a.order - b.order
    )
    const rewritten: PlaylistTrack[] = rest.map((row, index) =>
      row.order === index ? row : { ...row, order: index }
    )
    await db.playlist_tracks.bulkPut(rewritten)
    await db.playlists.update(playlistId, { updatedAt: Date.now() })
  })
}

/** Grava a nova ordem manual (drag & drop interno da playlist). */
export async function reorderPlaylist(playlistId: string, orderedFilePaths: string[]): Promise<void> {
  await db.transaction('rw', db.playlists, db.playlist_tracks, async () => {
    const rows = await db.playlist_tracks.where('playlistId').equals(playlistId).toArray()
    const byPath = new Map(rows.map((row) => [row.filePath, row] as const))
    const seen = new Set<string>()
    const rewritten: PlaylistTrack[] = []

    let index = 0
    for (const filePath of orderedFilePaths) {
      const row = byPath.get(filePath)
      if (!row || seen.has(filePath)) continue
      seen.add(filePath)
      rewritten.push(row.order === index ? row : { ...row, order: index })
      index++
    }
    // Faixas que não vieram na lista (corrida entre drag e watcher) vão ao fim.
    for (const row of rows) {
      if (seen.has(row.filePath)) continue
      rewritten.push(row.order === index ? row : { ...row, order: index })
      index++
    }
    await db.playlist_tracks.bulkPut(rewritten)
    await db.playlists.update(playlistId, { updatedAt: Date.now() })
  })
}

/** Faixas da playlist na ordem manual — ignora vínculos órfãos. */
export async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  const rows = (await db.playlist_tracks.where('playlistId').equals(playlistId).toArray()).sort(
    (a, b) => a.order - b.order
  )
  if (rows.length === 0) return []
  const tracks = await db.tracks.where('filePath').anyOf(rows.map((r) => r.filePath)).toArray()
  const byPath = new Map(tracks.map((t) => [t.filePath, t] as const))
  const out: Track[] = []
  for (const row of rows) {
    const track = byPath.get(row.filePath)
    if (track) out.push(track)
  }
  return out
}

/** Limpa vínculos cujas faixas não existem mais (rede de segurança). */
export async function prunePlaylistTracks(): Promise<number> {
  return db.transaction('rw', db.playlist_tracks, db.tracks, async () => {
    const rows = await db.playlist_tracks.toArray()
    if (rows.length === 0) return 0
    const paths = [...new Set(rows.map((r) => r.filePath))]
    const alive = new Set((await db.tracks.where('filePath').anyOf(paths).toArray()).map((t) => t.filePath))
    const orphans = rows.filter((r) => !alive.has(r.filePath))
    if (orphans.length > 0) {
      await db.playlist_tracks.bulkDelete(orphans.map((r) => [r.playlistId, r.filePath]))
    }
    return orphans.length
  })
}

/** Caminhos de capa atualmente referenciados por alguma faixa. */
export async function knownCoverPaths(): Promise<string[]> {
  const rows = await db.tracks.toArray()
  const out = new Set<string>()
  for (const t of rows) if (t.coverPath) out.add(t.coverPath)
  return [...out]
}

// ─── Configurações persistidas ──────────────────────────────────────────────

export interface AppSettings {
  autoRescanOnLaunch: boolean
  rowDensity: 'comfy' | 'compact'
  /** Vigiar pastas em tempo real (músicas novas aparecem sozinhas). */
  watchFolders: boolean
  /** Fechar a janela mantém o app vivo na bandeja tocando música. */
  closeToTray: boolean
  /** Fade de 2s no fim da faixa (desligado por padrão — comportamento seco). */
  crossfade: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoRescanOnLaunch: true,
  rowDensity: 'comfy',
  watchFolders: true,
  closeToTray: true,
  crossfade: false
}

export async function loadSettings(): Promise<AppSettings> {
  const row = await db.meta.get('settings')
  return {
    ...DEFAULT_SETTINGS,
    ...(typeof row?.value === 'object' && row.value !== null ? (row.value as Partial<AppSettings>) : {})
  }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings()
  const next = { ...current, ...patch }
  await db.meta.put({ key: 'settings', value: next })
  return next
}
