import Dexie, { type EntityTable } from 'dexie'
import type { Feedback, FolderEntry, LibrarySyncResult, ScanResponse, Track } from '@shared/music'

/**
 * Banco local (IndexedDB via Dexie) — ultrarrápido, 100% offline.
 *
 *  - `tracks.filePath` é a chave primária (identidade estável do arquivo).
 *  - Capas NÃO vão para o IndexedDB: ficam em cache de disco no userData
 *    e são servidas via `media://cover/...` — IndexedDB guarda só metadados,
 *    mantendo consultas reativas em tempo de biblioteca de 10k faixas.
 *  - Telemetria (playCount/lastPlayedAt/feedback) sobrevive a re-scans:
 *    o sincronizador nunca zera contadores de faixas já conhecidas.
 */

export interface MetaEntry {
  key: string
  value: unknown
}

class OndaDatabase extends Dexie {
  tracks!: EntityTable<Track, 'filePath'>
  folders!: EntityTable<FolderEntry, 'path'>
  meta!: EntityTable<MetaEntry, 'key'>

  constructor() {
    super('onda-library')
    this.version(1).stores({
      // Índices para cada lista inteligente + ordenações da tabela.
      tracks:
        'filePath, title, artist, album, feedback, playCount, lastPlayedAt, addedAt, folder, [folder+feedback], [folder+playCount]',
      folders: 'path',
      meta: 'key'
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

  return db.transaction('rw', db.tracks, db.folders, async () => {
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
    const deleteOps = previous.filter((t) => !stillExists.has(t.filePath)).map((t) => db.tracks.delete(t.filePath))
    removed = deleteOps.length
    await Promise.all(deleteOps)

    const folderRow = await db.folders.get(res.dir)
    await db.folders.put({ path: res.dir, addedAt: folderRow?.addedAt ?? now, lastScanAt: res.scannedAt })

    return { added, updated, removed, unchanged: res.unchanged.length }
  })
}
export async function setFeedback(filePath: string, feedback: Feedback): Promise<void> {
  await db.tracks.update(filePath, { feedback })
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

export async function removeTrack(filePath: string): Promise<void> {
  await db.transaction('rw', db.tracks, async () => {
    await db.tracks.delete(filePath)
  })
}

export async function addFolder(path: string): Promise<void> {
  await db.folders.put({ path, addedAt: Date.now(), lastScanAt: null })
}

export async function removeFolder(path: string, alsoClearTracks: boolean): Promise<void> {
  await db.transaction('rw', db.tracks, db.folders, async () => {
    await db.folders.delete(path)
    if (alsoClearTracks) {
      await db.tracks.where('folder').equals(path).delete()
    }
  })
}

export async function clearLibrary(): Promise<void> {
  await db.transaction('rw', db.tracks, db.folders, async () => {
    await db.tracks.clear()
    await db.folders.clear()
  })
}

// ─── Configurações persistidas ──────────────────────────────────────────────

export interface AppSettings {
  autoRescanOnLaunch: boolean
  rowDensity: 'comfy' | 'compact'
}

const DEFAULTS: AppSettings = { autoRescanOnLaunch: true, rowDensity: 'comfy' }

export async function loadSettings(): Promise<AppSettings> {
  const row = await db.meta.get('settings')
  return { ...DEFAULTS, ...(typeof row?.value === 'object' && row.value !== null ? (row.value as Partial<AppSettings>) : {}) }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings()
  const next = { ...current, ...patch }
  await db.meta.put({ key: 'settings', value: next })
  return next
}
