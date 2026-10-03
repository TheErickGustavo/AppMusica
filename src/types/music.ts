/**
 * Tipos compartilhados entre o processo main (Node/Electron) e o
 * renderer (React). Nada aqui importa runtime de UI — apenas shapes de dados.
 */

export type Feedback = 'liked' | 'disliked' | 'neutral'

/** Registro canônico de uma faixa na biblioteca local (IndexedDB / Dexie). */
export interface Track {
  /** Caminho absoluto — chave primária do banco. */
  filePath: string
  title: string
  artist: string
  album: string
  genre: string | null
  year: number | null
  /** Duração em segundos (pode ser 0 se o container não reportar). */
  duration: number
  /** kbps aproximados, quando disponíveis. */
  bitrate: number | null
  sampleRate: number | null
  codec: string | null
  /** Bytes no disco. */
  size: number
  /** mtimeMs do arquivo na última leitura (cache-buster incremental). */
  mtimeMs: number
  /** Caminho absoluto do PNG/JPG em cache gerado pelo scanner (ou null). */
  coverPath: string | null
  playCount: number
  lastPlayedAt: number | null
  feedback: Feedback
  /** Epoch ms em que a faixa entrou na biblioteca. */
  addedAt: number
  /** Epoch ms da última vez que o scanner validou este arquivo. */
  scannedAt: number
  /** Pasta-raiz (watch folder) à qual esta faixa pertence. */
  folder: string
}

/** Payload bruto vindo do scanner do main — metadados puros, sem telemetria. */
export interface TrackScanInput {
  filePath: string
  title: string
  artist: string
  album: string
  genre: string | null
  year: number | null
  duration: number
  bitrate: number | null
  sampleRate: number | null
  codec: string | null
  size: number
  mtimeMs: number
  coverPath: string | null
}

/** Resumo mínimo que o renderer envia ao main para permitir scan incremental. */
export interface KnownTrackStamp {
  filePath: string
  size: number
  mtimeMs: number
}

export interface ScanResponse {
  dir: string
  /** Arquivos novos/alterados com metadados completos. */
  changed: TrackScanInput[]
  /** Caminhos que permanecem idênticos desde o último scan (só existência). */
  unchanged: string[]
  scannedAt: number
  /** true se o scan foi cancelado pelo usuário. */
  aborted?: boolean
}

export interface ScanProgress {
  dir: string
  stage: 'walk' | 'parse' | 'done'
  done: number
  total: number
  current: string
}

export interface FolderEntry {
  /** Caminho absoluto da pasta vigiada (chave primária). */
  path: string
  addedAt: number
  lastScanAt: number | null
}

// ─── Playlists customizadas (Dexie v2) ──────────────────────────────────────

/** Playlist criada pelo usuário ("Treino", "Foco", "Suno Hits"…). */
export interface Playlist {
  /** Id opaco gerado no renderer (crypto.randomUUID). */
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

/**
 * Vínculo faixa↔playlist. Chave composta [playlistId+filePath] → impossível
 * duplicar a mesma faixa na mesma playlist; `order` é a posição manual.
 */
export interface PlaylistTrack {
  playlistId: string
  filePath: string
  /** Posição manual (0-based) — reordenável por drag. */
  order: number
  addedAt: number
}

// ─── Watcher de pastas (chokidar no main) ───────────────────────────────────

/** Evento `library:file-added` — faixa nova/alterada detectada no disco. */
export interface LibraryFileAddedEvent {
  /** Pasta-raiz vigiada que contém o arquivo. */
  folder: string
  track: TrackScanInput
}

/** Evento `library:file-removed` — arquivo sumiu/mudou de lugar. */
export interface LibraryFileRemovedEvent {
  folder: string
  filePath: string
}

/** Resultado do parse de caminhos soltos (drag & drop do Explorer). */
export interface ParsePathsResult {
  /** Arquivos de áudio já com metadados lidos. */
  tracks: TrackScanInput[]
  /** Diretórios soltos — o renderer decide escanear como pasta vigiada. */
  directories: string[]
  /** Caminhos ignorados (não-áudio, inexistentes, protegidos). */
  skipped: string[]
}

/** Estatísticas da limpeza do cache de capas órfãs. */
export interface CoverCleanupResult {
  scanned: number
  removed: number
  freedBytes: number
}

// ─── Ponte com o processo main (tray, mini player, atalhos globais) ─────────

/** Comandos de transporte enviados pelo main (atalhos globais/tray). */
export type MediaCommand = 'toggle' | 'next' | 'previous' | 'stop'

/** Estado resumido publicado pelo renderer → tray/mini player. */
export interface PlayerBroadcastState {
  isPlaying: boolean
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error'
  title: string | null
  artist: string | null
  album: string | null
  coverPath: string | null
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  playMode: 'off' | 'all' | 'one'
}

/** Preferências que o main precisa conhecer (não dá para ler IndexedDB lá). */
export interface MainWindowSettings {
  closeToTray: boolean
}

export interface LibrarySyncResult {
  added: number
  updated: number
  removed: number
  unchanged: number
}
