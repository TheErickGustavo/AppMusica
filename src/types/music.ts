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

export interface LibrarySyncResult {
  added: number
  updated: number
  removed: number
  unchanged: number
}
