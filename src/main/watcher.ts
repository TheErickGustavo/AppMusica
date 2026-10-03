import chokidar, { type FSWatcher } from 'chokidar'
import { promises as fs } from 'fs'
import { basename } from 'path'
import type { ParsePathsResult, TrackScanInput } from '@shared/music'
import { isAudioFile, parseTrack } from './scanner'

/* ═══════════════════════════════════════════════════════════════════════════
 * ONDA · AUTO-WATCHER DE PASTAS
 *
 * Problema que isto resolve: baixar uma música com OUTRO app e ter que clicar
 * em "Re-escanear" para ela aparecer. Aqui, cada pasta importada é vigiada
 * com chokidar; quando um arquivo termina de ser escrito, o main o parseia e
 * empurra para o renderer via IPC (`library:file-added`), que faz o upsert no
 * Dexie preservando telemetria (playCount/lastPlayedAt/feedback).
 *
 * Decisões deliberadas:
 *  - `awaitWriteFinish` (1.5s) → só emitimos quando o download acabou de
 *    verdade; arquivos parciais de outro app nunca entram na biblioteca.
 *  - debounce de 1s por caminho → downloaders escrevem em rajadas de chunks;
 *    sem isso teríamos dezenas de parses do mesmo arquivo.
 *  - `ignored` como função (sem glob) → imune a diferenças de separador do
 *    Windows e à semântica de glob entre versões do chokidar.
 *  - Um watcher por pasta-raiz, recriado apenas quando a lista muda.
 * ═════════════════════════════════════════════════════════════════════════ */

interface WatchEventSink {
  onAdded(folder: string, track: TrackScanInput): void
  onRemoved(folder: string, filePath: string): void
}

const watchers = new Map<string, FSWatcher>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

let sink: WatchEventSink | null = null
/** Pastas pedidas pelo renderer (fonte da verdade), mesmo as offline. */
let requestedRoots: string[] = []
/** Pastas que realmente têm watcher ativo agora. */
let watchedRoots: string[] = []
/** Durante um scan completo, os eventos do watcher só geram trabalho duplicado. */
let suspended = false
/** HD externo desconectado: tenta reatar a vigilância de tempos em tempos. */
let retryTimer: ReturnType<typeof setInterval> | null = null

const DEBOUNCE_MS = 1000
const RETRY_MS = 20000

export function setWatchEventSink(next: WatchEventSink): void {
  sink = next
}

export function getWatchedFolders(): string[] {
  return [...watchedRoots]
}

export function suspendWatcher(value: boolean): void {
  suspended = value
}

function isHidden(name: string): boolean {
  return name.startsWith('.') || name === 'desktop.ini' || name === 'Thumbs.db'
}

/** Debounce por caminho: absorve rajadas de escrita de downloaders. */
function debounce(key: string, fn: () => void): void {
  const existing = debounceTimers.get(key)
  if (existing) clearTimeout(existing)
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key)
      fn()
    }, DEBOUNCE_MS)
  )
}

async function emitAdded(root: string, filePath: string): Promise<void> {
  if (!sink || suspended) return
  if (!isAudioFile(filePath)) return
  try {
    const track = await parseTrack(filePath)
    sink.onAdded(root, track)
  } catch (err) {
    console.warn(`[watcher] falha ao indexar ${filePath}:`, (err as Error)?.message)
  }
}

/** Resolve quando o chokidar terminou o scan inicial (ou no timeout). */
function waitForReady(watcher: FSWatcher, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      watcher.off('ready', finish)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    watcher.once('ready', finish)
  })
}

function createWatcher(root: string): FSWatcher {
  const watcher = chokidar.watch(root, {
    // Sem globs: função pura → mesmo comportamento em qualquer plataforma.
    ignored: (target: string) => isHidden(basename(target)),
    persistent: true,
    depth: 10,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 100 }
  })

  watcher.on('add', (filePath: string) => {
    debounce(`add:${filePath}`, () => void emitAdded(root, filePath))
  })

  watcher.on('change', (filePath: string) => {
    // Retag/renomeação interna: metadados podem ter mudado → re-parseia.
    debounce(`add:${filePath}`, () => void emitAdded(root, filePath))
  })

  watcher.on('unlink', (filePath: string) => {
    debounce(`del:${filePath}`, () => {
      if (!sink || suspended) return
      sink.onRemoved(root, filePath)
    })
  })

  watcher.on('error', (err: unknown) => {
    console.warn(`[watcher] erro em ${root}:`, (err as Error)?.message)
  })

  return watcher
}

/** Cria watchers para as pastas pedidas que ainda não estão sendo vigiadas. */
async function ensureWatchers(): Promise<void> {
  const created: FSWatcher[] = []
  for (const root of requestedRoots) {
    if (watchers.has(root)) continue
    try {
      const stat = await fs.stat(root)
      if (!stat.isDirectory()) continue
    } catch {
      continue // pasta offline (HD externo desconectado) — o retry reata depois
    }
    const watcher = createWatcher(root)
    watchers.set(root, watcher)
    created.push(watcher)
  }
  // Espera o scan inicial terminar: sem isso, um arquivo criado nos primeiros
  // milissegundos poderia cair no "initial scan" e nunca ser anunciado.
  if (created.length > 0) await Promise.all(created.map((w) => waitForReady(w)))
  watchedRoots = [...watchers.keys()].sort()
  scheduleRetry()
}

/**
 * Se alguma pasta pedida continua sem watcher (HD desconectado, rede fora),
 * tenta de novo a cada 20s — quando o disco volta, a vigilância volta sozinha.
 */
function scheduleRetry(): void {
  const missing = requestedRoots.filter((root) => !watchers.has(root))
  if (missing.length === 0) {
    if (retryTimer) clearInterval(retryTimer)
    retryTimer = null
    return
  }
  if (retryTimer) return
  retryTimer = setInterval(() => {
    if (suspended) return
    void ensureWatchers().then(() => {
      if (requestedRoots.every((root) => watchers.has(root))) {
        console.log('[watcher] pastas reconectadas — vigilância reatada')
      }
    })
  }, RETRY_MS)
}

/**
 * Reconcilia a lista de pastas vigiadas com o que está no banco.
 * Idempotente: chamar com a mesma lista não faz nada.
 */
export async function syncWatchedFolders(roots: string[]): Promise<void> {
  const next = [...new Set(roots.filter((r) => r.trim().length > 0))].sort()
  if (next.length === requestedRoots.length && next.every((r, i) => r === requestedRoots[i])) return

  // Fecha watchers de pastas removidas.
  for (const [root, watcher] of watchers) {
    if (!next.includes(root)) {
      watchers.delete(root)
      await watcher.close().catch(() => undefined)
    }
  }

  requestedRoots = next
  await ensureWatchers()
  console.log(
    `[watcher] vigiando ${watchers.size}/${requestedRoots.length} pasta(s)${suspended ? ' (suspenso)' : ''}`
  )
}

export async function closeAllWatchers(): Promise<void> {
  for (const timer of debounceTimers.values()) clearTimeout(timer)
  debounceTimers.clear()
  if (retryTimer) {
    clearInterval(retryTimer)
    retryTimer = null
  }
  const all = [...watchers.values()]
  watchers.clear()
  watchedRoots = []
  requestedRoots = []
  await Promise.all(all.map((w) => w.close().catch(() => undefined)))
}

// ─── Drag & drop do Explorer: parse de caminhos soltos ─────────────────────

/**
 * Recebe caminhos absolutos (do `webUtils.getPathForFile`) e devolve:
 *  - arquivos de áudio já parseados (prontos para virarem Track);
 *  - diretórios (para o renderer importar como pasta vigiada);
 *  - o que foi ignorado.
 *
 * Um `.mp3` solto fora de qualquer pasta vigiada também é aceito — ele entra
 * na biblioteca com `folder` = pasta que o contém (resolvida no renderer).
 */
export async function parseDroppedPaths(paths: string[]): Promise<ParsePathsResult> {
  const tracks: TrackScanInput[] = []
  const directories: string[] = []
  const skipped: string[] = []

  for (const raw of paths) {
    const target = raw.trim()
    if (target.length === 0) continue
    try {
      const stat = await fs.stat(target)
      if (stat.isDirectory()) {
        directories.push(target)
        continue
      }
      if (!stat.isFile() || !isAudioFile(target)) {
        skipped.push(target)
        continue
      }
      tracks.push(await parseTrack(target))
    } catch {
      skipped.push(target)
    }
  }

  return { tracks, directories, skipped }
}
