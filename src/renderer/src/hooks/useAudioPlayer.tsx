import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode
} from 'react'
import type { PlayerBroadcastState, Track } from '@shared/music'
import { audioUrl } from '@/lib/media'
import { registerPlayCount, touchLastPlayed } from '@/lib/db'
import { pushToast } from '@/lib/toast'

/* ═══════════════════════════════════════════════════════════════════════════
 * ONDA · MOTOR DE ÁUDIO — a máquina de estados do app inteiro.
 *
 *  - Um único <audio> element, controlado por um engine singleton.
 *  - Fila com ordem explícita ("bag"): shuffle Fisher-Yates que NUNCA inclui
 *    faixas `disliked`. Rejeitadas só tocam por ação direta do usuário.
 *  - Telemetria anti-spam: playCount += 1 quando o tempo OUVINDO acumulado
 *    cruza 50% da duração OU 30s — o que vier primeiro — e +1 a cada
 *    duração inteira acumulada depois disso (replay conta de novo).
 *    Seek, pause, buffer-stall e fim de arquivo não inflacionam o número.
 *  - Snapshot imutável + useSyncExternalStore com seletores: linhas da tabela
 *    só re-renderizam quando o QUE ELAS LEEM muda (não a cada frame).
 * ═════════════════════════════════════════════════════════════════════════ */

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error'
export type PlayMode = 'off' | 'all' | 'one'

export interface UpcomingItem {
  key: string
  track: Track
  source: 'pending' | 'order'
  /** posição no array-fonte (pending ou order) para remoção segura */
  handle: number
}

export interface PlayerSnapshot {
  status: PlayerStatus
  track: Track | null
  /** Lista-contexto: a view ativa de onde a fila foi montada. */
  queue: Track[]
  /** Ordem de reprodução: índices sobre `queue`. */
  order: number[]
  /** Posição atual dentro de `order`. */
  orderPos: number
  /** Fila manual — "Tocar a seguir" / "Adicionar à fila". */
  pending: Track[]
  /** Derivado: próximas faixas (pending primeiro, depois resto do bag). */
  upcoming: UpcomingItem[]
  shuffle: boolean
  playMode: PlayMode
  volume: number
  muted: boolean
  effectiveVolume: number
  currentTime: number
  duration: number
  error: string | null
}

interface EngineCallbacks {
  onTrackCounted?: (filePath: string) => void
  onPlaybackError?: (track: Track, message: string) => void
}

/** Regra anti-spam de contagem de plays. */
const MIN_CONTINUOUS_SECONDS = 30
const MIN_LISTEN_RATIO = 0.5
/** Máximo de gap entre ticks para o intervalo contar como "ouvindo" (ms). */
const MAX_CONTINUOUS_GAP_MS = 750

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i] as T
    arr[i] = arr[j] as T
    arr[j] = tmp
  }
  return arr
}

const LS_KEY = 'onda.p***********'

interface PersistedPrefs {
  volume: number
  muted: boolean
  shuffle: boolean
  playMode: PlayMode
}

function loadPrefs(): PersistedPrefs {
  const fallback: PersistedPrefs = { volume: 0.8, muted: false, shuffle: false, playMode: 'off' }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return fallback
    const p = JSON.parse(raw) as Partial<PersistedPrefs>
    return {
      volume: typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : fallback.volume,
      muted: typeof p.muted === 'boolean' ? p.muted : fallback.muted,
      shuffle: typeof p.shuffle === 'boolean' ? p.shuffle : fallback.shuffle,
      playMode: p.playMode === 'all' || p.playMode === 'one' || p.playMode === 'off' ? p.playMode : fallback.playMode
    }
  } catch {
    return fallback
  }
}

export class AudioEngine {
  readonly audio: HTMLAudioElement
  private listeners = new Set<() => void>()
  private snapshot: PlayerSnapshot
  private callbacks: EngineCallbacks = {}
  private destroyed = false

  /** Telemetria da sessão de audição da faixa corrente. */
  private session = {
    played: 0,
    count: 0,
    lastRealMs: performance.now(),
    lastPos: 0,
    seeking: false
  }
  private rafId = 0
  /** true enquanto a UI arrasta o scrubber — o motor não briga com o usuário. */
  scrubBlocked = false
  /** cadeado de auto-avanço: permite pular no máximo 3 arquivos corrompidos seguidos. */
  private autoChain = false
  private consecutiveErrors = 0
  private errorSkipTimer: ReturnType<typeof setTimeout> | null = null
  /** Crossfade simples (fade-out de 2s no fim) — opt-in nas configurações. */
  private crossfadeEnabled = false
  private fadeTimer: ReturnType<typeof setInterval> | null = null
  private fadeStartVolume = 1

  constructor() {
    const audio = new Audio()
    audio.preload = 'metadata'
    this.audio = audio

    const prefs = loadPrefs()
    audio.volume = prefs.muted ? 0 : prefs.volume

    this.snapshot = {
      status: 'idle',
      track: null,
      queue: [],
      order: [],
      orderPos: 0,
      pending: [],
      upcoming: [],
      shuffle: prefs.shuffle,
      playMode: prefs.playMode,
      volume: prefs.volume,
      muted: prefs.muted,
      effectiveVolume: prefs.muted ? 0 : prefs.volume,
      currentTime: 0,
      duration: 0,
      error: null
    }
    this.computeUpcoming(this.snapshot)

    const on = (ev: string, fn: () => void): void => audio.addEventListener(ev, fn)

    on('loadedmetadata', () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : 0
      if (this.snapshot.status === 'loading' && audio.paused) {
        this.patch({ duration: d, status: 'paused' })
      } else if (d > 0) {
        this.patch({ duration: d })
      }
    })
    on('timeupdate', () => {
      this.telemetryTick()
      this.crossfadeTick()
      if (!this.scrubBlocked) this.patch({ currentTime: audio.currentTime })
    })
    on('play', () => {
      this.autoChain = false
      this.consecutiveErrors = 0
      if (this.snapshot.status !== 'playing') this.patch({ status: 'playing', error: null })
      this.startRaf()
    })
    on('pause', () => {
      if (this.snapshot.track && (this.snapshot.status === 'playing' || this.snapshot.status === 'buffering')) {
        this.patch({ status: 'paused' })
      }
      // Nada de faixa seguinte iminente quando o usuário pausa: volume volta.
      this.cancelFade(true)
      this.stopRaf()
    })
    on('waiting', () => {
      if (this.snapshot.track && this.snapshot.status !== 'error') this.patch({ status: 'buffering' })
    })
    on('canplay', () => {
      if (this.snapshot.status === 'buffering' || this.snapshot.status === 'loading') {
        this.patch({ status: audio.paused ? 'paused' : 'playing' })
      }
    })
    on('seeking', () => {
      this.session.seeking = true
    })
    on('seeked', () => {
      this.session.seeking = false
      this.session.lastPos = audio.currentTime
      if (!this.scrubBlocked) this.patch({ currentTime: audio.currentTime })
    })
    on('ended', () => this.handleEnded())

    audio.addEventListener('error', () => {
      const track = this.snapshot.track
      if (!track || !audio.src) return
      const looksEncrypted = (track.duration ?? 0) === 0 && /\.m4a$/i.test(track.filePath)
      const msg =
        audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? looksEncrypted
            ? 'Arquivo Suno criptografado — use a pasta SunoFixo descriptografada.'
            : 'Formato não suportado pelo motor de áudio.'
          : 'Arquivo ausente ou ilegível no disco.'
      this.consecutiveErrors++
      this.patch({ status: 'error', error: msg })
      this.callbacks.onPlaybackError?.(track, msg)
      // Se foi avanço automático, tenta a próxima (com teto) para não travar numa música quebrada.
      if (this.autoChain && this.consecutiveErrors <= 3) {
        if (this.errorSkipTimer) clearTimeout(this.errorSkipTimer)
        this.errorSkipTimer = setTimeout(() => this.stepForward(true), 500)
      }
    })
  }

  // ─── Store ───────────────────────────────────────────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): PlayerSnapshot => this.snapshot

  private patch(p: Partial<PlayerSnapshot>): void {
    if (this.destroyed) return
    const prev = this.snapshot
    let changed = false
    for (const k of Object.keys(p) as (keyof PlayerSnapshot)[]) {
      if (prev[k] !== p[k]) {
        changed = true
        break
      }
    }
    if (!changed) return
    const merged: PlayerSnapshot = { ...prev, ...p }
    if (p.status !== undefined && p.status !== 'error') merged.error = null
    if (p.order !== undefined || p.orderPos !== undefined || p.queue !== undefined || p.pending !== undefined) {
      merged.upcoming = this.computeUpcoming(merged)
    }
    this.snapshot = merged
    for (const fn of this.listeners) fn()
  }

  private computeUpcoming(s: PlayerSnapshot): UpcomingItem[] {
    const items: UpcomingItem[] = []
    s.pending.forEach((track, i) => items.push({ key: `p:${track.filePath}:${i}`, track, source: 'pending', handle: i }))
    for (let i = s.orderPos + 1; i < s.order.length; i++) {
      const t = s.queue[s.order[i] as number]
      if (t) items.push({ key: `o:${i}:${t.filePath}`, track: t, source: 'order', handle: i })
      if (items.length >= 500) break
    }
    // patch() é chamado no construtor antes de `this.snapshot` existir em alguns fluxos —
    // manter retorno defensivo é desnecessário; ordem já é validada acima.
    return items
  }

  setCallbacks(cb: EngineCallbacks): void {
    this.callbacks = { ...this.callbacks, ...cb }
  }

  dispose(): void {
    this.destroyed = true
    this.stopRaf()
    if (this.errorSkipTimer) clearTimeout(this.errorSkipTimer)
    this.cancelFade(false)
    this.audio.pause()
  }

  // ─── Telemetria anti-spam ────────────────────────────────────────────────
  // Acumula SOMENTE tempo de áudio realmente fluindo: entre dois ticks,
  // o relógio de parede e a posição do player precisam concordar (±janela).
  // Buffer-stall → gap grande → não conta. Seek → descontinuidade → não conta.

  private telemetryTick(): void {
    const s = this.session
    const now = performance.now()
    const realDtMs = now - s.lastRealMs
    s.lastRealMs = now
    if (this.audio.paused || s.seeking || this.snapshot.status === 'error' || !this.snapshot.track) return

    const pos = this.audio.currentTime
    const posDt = Math.abs(pos - s.lastPos)
    s.lastPos = pos

    if (realDtMs <= 0 || realDtMs > MAX_CONTINUOUS_GAP_MS) return // stall / aba congelada
    if (posDt > MAX_CONTINUOUS_GAP_MS / 1000 + 0.35) return // salto de seek

    s.played += realDtMs / 1000

    // +1 ao cruzar o limiar inicial (50% ou 30s) e +1 a cada duração
    // inteira acumulada depois disso — repetir a faixa (seek p/ o zero,
    // repeat-one, replay) conta de novo. Sem duração conhecida, vale o +1 único.
    const duration = this.snapshot.duration || this.snapshot.track.duration || 0
    const threshold = duration > 0 ? Math.min(duration * MIN_LISTEN_RATIO, MIN_CONTINUOUS_SECONDS) : MIN_CONTINUOUS_SECONDS
    const step = duration > 0 ? duration : Number.POSITIVE_INFINITY
    const earned = s.played >= threshold ? 1 + Math.floor((s.played - threshold) / step) : 0
    while (s.count < earned) {
      s.count++
      void registerPlayCount(this.snapshot.track.filePath)
      this.callbacks.onTrackCounted?.(this.snapshot.track.filePath)
    }
  }

  private startRaf(): void {
    if (this.rafId) return
    const loop = (): void => {
      if (this.destroyed || this.audio.paused) {
        this.rafId = 0
        return
      }
      this.telemetryTick()
      if (!this.scrubBlocked) {
        const t = this.audio.currentTime
        if (Math.abs(t - this.snapshot.currentTime) >= 0.02) this.patch({ currentTime: t })
      }
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  private stopRaf(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  // ─── Crossfade simples ───────────────────────────────────────────────────
  // Nada de ping-pong de dois <audio>: quando faltam ≤2s para o fim, o volume
  // cai linearmente até 0 em ~1.8s. A faixa seguinte entra com o volume cheio
  // (restaurado em loadTrack). Se o usuário pausa/seek/pula, o fade é abortado.

  setCrossfadeEnabled(enabled: boolean): void {
    this.crossfadeEnabled = enabled
    if (!enabled) this.cancelFade(true)
  }

  private cancelFade(restoreVolume: boolean): void {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer)
      this.fadeTimer = null
    }
    if (restoreVolume && !this.destroyed) {
      try {
        this.audio.volume = this.snapshot.muted ? 0 : this.snapshot.volume
      } catch {
        /* elemento indisponível */
      }
    }
  }

  private hasSomethingNext(): boolean {
    const s = this.snapshot
    // Repeat-one repete a MESMA faixa: não há transição para crossfadar.
    if (s.playMode === 'one') return false
    if (s.pending.length > 0) return true
    if (s.playMode === 'all') return s.order.length > 0
    return s.orderPos + 1 < s.order.length
  }

  private crossfadeTick(): void {
    if (!this.crossfadeEnabled || this.fadeTimer) return
    const s = this.snapshot
    const duration = s.duration || 0
    if (!s.track || this.audio.paused || duration <= 4) return
    const remaining = duration - this.audio.currentTime
    if (remaining <= 0 || remaining > 2) return
    if (!this.hasSomethingNext()) return
    const base = s.muted ? 0 : s.volume
    if (base <= 0) return

    this.fadeStartVolume = base
    const startedAt = performance.now()
    const FADE_MS = 1800
    this.fadeTimer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / FADE_MS)
      try {
        this.audio.volume = Math.max(0, this.fadeStartVolume * (1 - progress))
      } catch {
        /* elemento indisponível */
      }
      if (progress >= 1 && this.fadeTimer) {
        clearInterval(this.fadeTimer)
        this.fadeTimer = null
      }
    }, 40)
  }

  // ─── Fila / ordem / transporte ───────────────────────────────────────────

  private nonDislikedIndices(): number[] {
    const out: number[] = []
    this.snapshot.queue.forEach((t, i) => {
      if (t.feedback !== 'disliked') out.push(i)
    })
    return out
  }

  private buildOrderForQueue(queue: Track[], startIndex: number, shuffle: boolean): { order: number[]; orderPos: number } {
    if (shuffle) {
      // BLACKLIST DO SHUFFLE: disliked fora do bag. A escolhida entra sempre na frente.
      const candidates = queue.map((_, i) => i).filter((i) => i === startIndex || queue[i]?.feedback !== 'disliked')
      const rest = candidates.filter((i) => i !== startIndex)
      shuffleInPlace(rest)
      return { order: [startIndex, ...rest], orderPos: 0 }
    }
    return { order: queue.map((_, i) => i), orderPos: startIndex }
  }

  /** Monta a lista-contexto e toca a faixa `startIndex`. */
  playFromQueue(queue: Track[], startIndex: number): void {
    let start = startIndex
    if (start < 0 || start >= queue.length) {
      start = this.snapshot.shuffle ? Math.floor(Math.random() * queue.length) : 0
    }
    if (queue.length === 0) return
    const { order, orderPos } = this.buildOrderForQueue(queue, start, this.snapshot.shuffle)
    this.patch({ queue, order, orderPos, pending: [] })
    const track = queue[start]
    if (track) void this.loadTrack(track, true)
  }

  restartCurrent(): void {
    if (this.snapshot.track) void this.loadTrack(this.snapshot.track, true)
  }

  private async loadTrack(track: Track, autoplay: boolean): Promise<void> {
    this.session = { played: 0, count: 0, lastRealMs: performance.now(), lastPos: 0, seeking: false }
    if (this.snapshot.status !== 'error') this.consecutiveErrors = 0
    const provisionalDuration = track.duration > 0 ? track.duration : 0
    this.patch({ track, currentTime: 0, duration: provisionalDuration, status: 'loading' })

    try {
      if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album
        })
      }
    } catch {
      /* não-crítico */
    }

    void touchLastPlayed(track.filePath)

    // Se veio de um crossfade, a faixa nova começa no volume normal.
    this.cancelFade(false)
    this.audio.src = audioUrl(track.filePath)
    try {
      this.audio.volume = this.snapshot.muted ? 0 : this.snapshot.volume
    } catch {
      /* elemento indisponível */
    }
    this.audio.load()
    if (autoplay) {
      try {
        await this.audio.play()
      } catch (err) {
        // AbortError = play substituído por novo load — silencioso.
        if ((err as DOMException)?.name !== 'AbortError') {
          if (!this.audio.src) return
          this.patch({ status: 'paused' })
        }
      }
    }
  }

  togglePlay(): void {
    const s = this.snapshot
    if (!s.track) {
      if (s.queue.length > 0) this.playFromQueue(s.queue, s.shuffle ? Math.floor(Math.random() * s.queue.length) : 0)
      return
    }
    if (s.status === 'playing') this.audio.pause()
    else void this.audio.play().catch(() => undefined)
  }

  pause(): void {
    this.audio.pause()
  }

  /** Seek contínuo usado pelo scrubber durante o arraste. */
  seekLive(seconds: number): void {
    this.cancelFade(true)
    const dur = this.snapshot.duration || 0
    const t = Math.max(0, dur > 0 ? Math.min(dur, seconds) : seconds)
    this.session.lastPos = t
    this.patch({ currentTime: t })
    try {
      if (Number.isFinite(t) && this.audio.readyState >= 1) this.audio.currentTime = t
    } catch {
      /* metadata ainda não carregou; o pointerup resolve */
    }
  }

  seekTo(seconds: number): void {
    this.seekLive(seconds)
  }

  skipSeconds(delta: number): void {
    if (!this.snapshot.track) return
    this.seekTo(this.audio.currentTime + delta)
  }

  private stepForward(auto: boolean): void {
    // 1) fila manual tem prioridade absoluta
    if (this.snapshot.pending.length > 0) {
      const [head, ...tail] = this.snapshot.pending
      this.patch({ pending: tail })
      this.autoChain = auto
      if (head) void this.loadTrack(head, true)
      return
    }
    const { order, orderPos, queue, playMode } = this.snapshot
    const nextPos = orderPos + 1

    if (nextPos >= order.length) {
      if (playMode === 'all') {
        this.autoChain = auto
        this.rewrapOrder()
        return
      }
      if (auto) {
        // Fim natural sem repeat: para no último frame da faixa.
        this.patch({ status: 'paused', currentTime: this.snapshot.duration || this.snapshot.currentTime })
        this.audio.pause()
        return
      }
      // "next" manual no fim do bag: com shuffle, regenera o bag; senão para.
      if (this.snapshot.shuffle && queue.length > 0) {
        this.rewrapOrder()
      } else if (this.snapshot.track) {
        this.patch({ status: 'paused', currentTime: this.snapshot.duration || this.snapshot.currentTime })
        this.audio.pause()
      }
      return
    }

    this.patch({ orderPos: nextPos })
    const track = queue[order[nextPos] as number]
    if (!track) {
      this.stepForward(auto)
      return
    }
    this.autoChain = auto
    void this.loadTrack(track, true)
  }

  /** Reinicia o bag: repeat-all (sequencial ou shuffle) / next manual no fim com shuffle. */
  private rewrapOrder(): void {
    const { queue, shuffle } = this.snapshot
    const candidates = shuffle ? this.nonDislikedIndices() : queue.map((_, i) => i)
    if (candidates.length === 0) {
      this.audio.pause()
      this.patch({ status: 'idle', track: null, currentTime: 0, duration: 0 })
      return
    }
    const order = shuffle ? shuffleInPlace([...candidates]) : [...candidates]
    this.patch({ order, orderPos: 0 })
    const track = queue[order[0] as number]
    if (track) void this.loadTrack(track, true)
  }

  next(): void {
    this.stepForward(false)
  }

  previous(): void {
    if (this.audio.currentTime > 3 || this.snapshot.orderPos <= 0) {
      this.seekTo(0)
      return
    }
    const prevPos = this.snapshot.orderPos - 1
    const track = this.snapshot.queue[this.snapshot.order[prevPos] as number]
    this.patch({ orderPos: prevPos })
    if (track) void this.loadTrack(track, true)
  }

  /** Duplo-clique / play numa faixa específica da lista — mesmo que seja rejeitada. */
  playQueueIndex(index: number): void {
    const s = this.snapshot
    const track = s.queue[index]
    if (!track) return
    if (s.track?.filePath === track.filePath) {
      this.restartCurrent()
      return
    }
    const order = [...s.order]
    const at = order.indexOf(index)
    if (at !== -1 && at > s.orderPos) {
      order.splice(at, 1)
      order.splice(s.orderPos + 1, 0, index)
    } else if (at === -1) {
      order.splice(s.orderPos + 1, 0, index)
    }
    this.patch({ order })
    void this.loadTrack(track, true)
  }

  removeUpcoming(item: UpcomingItem): void {
    if (item.source === 'pending') {
      const pending = [...this.snapshot.pending]
      pending.splice(item.handle, 1)
      this.patch({ pending })
      return
    }
    const order = [...this.snapshot.order]
    order.splice(item.handle, 1)
    let orderPos = this.snapshot.orderPos
    if (item.handle <= orderPos) orderPos--
    this.patch({ order, orderPos: Math.max(orderPos, 0) })
  }

  enqueue(tracks: Track[], position: 'next' | 'last'): void {
    if (tracks.length === 0) return
    const pending = position === 'next' ? [...tracks, ...this.snapshot.pending] : [...this.snapshot.pending, ...tracks]
    if (!this.snapshot.track) {
      const [head, ...tail] = pending
      this.patch({ pending: tail })
      if (head) void this.loadTrack(head, true)
      return
    }
    this.patch({ pending })
  }

  toggleShuffle(): boolean {
    const nextValue = !this.snapshot.shuffle
    const s = this.snapshot
    if (s.track && s.queue.length > 0) {
      const curIdx = s.queue.findIndex((t) => t.filePath === s.track?.filePath)
      if (curIdx >= 0) {
        const rebuilt = this.buildOrderForQueue(s.queue, curIdx, nextValue)
        this.patch({ shuffle: nextValue, ...rebuilt })
      } else {
        this.patch({ shuffle: nextValue })
      }
    } else {
      this.patch({ shuffle: nextValue })
    }
    this.persistPrefs()
    return nextValue
  }

  cyclePlayMode(): PlayMode {
    const modes: PlayMode[] = ['off', 'all', 'one']
    const next = modes[(modes.indexOf(this.snapshot.playMode) + 1) % modes.length] as PlayMode
    this.patch({ playMode: next })
    this.persistPrefs()
    return next
  }

  setVolume(v: number): void {
    const volume = Math.max(0, Math.min(1, v))
    const muted = volume === 0 ? this.snapshot.muted : false
    this.audio.volume = muted ? 0 : volume
    this.patch({ volume, muted, effectiveVolume: muted ? 0 : volume })
    this.persistPrefs()
  }

  toggleMute(): void {
    const muted = !this.snapshot.muted
    this.audio.volume = muted ? 0 : this.snapshot.volume
    this.patch({ muted, effectiveVolume: muted ? 0 : this.snapshot.volume })
    this.persistPrefs()
  }

  private persistPrefs(): void {
    try {
      const { volume, muted, shuffle, playMode } = this.snapshot
      localStorage.setItem(LS_KEY, JSON.stringify({ volume, muted, shuffle, playMode } satisfies PersistedPrefs))
    } catch {
      /* storage indisponível → prefs só em memória */
    }
  }

  private handleEnded(): void {
    this.telemetryTick() // flush final — timeupdate pode ter atrasado no trecho final
    this.cancelFade(false)
    if (this.snapshot.playMode === 'one' && this.snapshot.track) {
      this.seekTo(0)
      this.session.played = 0
      this.session.count = 0
      this.session.lastRealMs = performance.now()
      void this.audio.play().catch(() => undefined)
      return
    }
    this.stepForward(true)
  }

  /** Chamado quando uma faixa some do disco/biblioteca: purga fila e bag. */
  notifyTrackGone(filePath: string): void {
    this.purgeTracks([filePath])
  }

  /**
   * Purga várias faixas de uma vez (watcher detectou arquivos apagados,
   * Ctrl+A + remover da biblioteca…). Mantém a ordem/bag consistente.
   */
  purgeTracks(filePaths: string[]): void {
    if (filePaths.length === 0) return
    const remove = new Set(filePaths)

    if (this.snapshot.track && remove.has(this.snapshot.track.filePath)) {
      this.cancelFade(false)
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
      this.patch({ status: 'idle', track: null, currentTime: 0, duration: 0 })
    }

    const oldQueue = this.snapshot.queue
    const removedFromQueue = oldQueue.some((t) => remove.has(t.filePath))
    const pending = this.snapshot.pending.filter((t) => !remove.has(t.filePath))

    let order = this.snapshot.order
    let orderPos = this.snapshot.orderPos
    const queue = removedFromQueue ? oldQueue.filter((t) => !remove.has(t.filePath)) : oldQueue

    if (removedFromQueue) {
      const orderPaths = order
        .map((i) => oldQueue[i]?.filePath)
        .filter((p): p is string => p != null && !remove.has(p))
      order = orderPaths.map((p) => queue.findIndex((t) => t.filePath === p)).filter((i) => i >= 0)
      const curPath = this.snapshot.track?.filePath
      const curIdx = curPath ? queue.findIndex((t) => t.filePath === curPath) : -1
      const curPosInOrder = curIdx >= 0 ? order.indexOf(curIdx) : -1
      orderPos = curPosInOrder >= 0 ? curPosInOrder : Math.min(orderPos, Math.max(order.length - 1, 0))
    }

    if (pending.length !== this.snapshot.pending.length || removedFromQueue) {
      this.patch({ queue, pending, order, orderPos })
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * HOOKS (contexto + seletores)
 * ═════════════════════════════════════════════════════════════════════════ */

let sharedEngine: AudioEngine | null = null
export function getEngine(): AudioEngine {
  if (!sharedEngine) sharedEngine = new AudioEngine()
  return sharedEngine
}

const EngineContext = createContext<AudioEngine | null>(null)

export function AudioEngineProvider({ children }: { children: ReactNode }): ReactElement {
  const engine = getEngine()

  useEffect(() => {
    engine.setCallbacks({
      onTrackCounted: (filePath) => {
        window.dispatchEvent(new CustomEvent('onda:track-counted', { detail: { filePath } }))
      },
      onPlaybackError: (track, message) => {
        window.dispatchEvent(new CustomEvent('onda:playback-error', { detail: { filePath: track.filePath, message } }))
      }
    })

    // Media Session → controles de hardware/OS quando suportados.
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => engine.audio.play().catch(() => undefined))
        navigator.mediaSession.setActionHandler('pause', () => engine.audio.pause())
        navigator.mediaSession.setActionHandler('previoustrack', () => engine.previous())
        navigator.mediaSession.setActionHandler('nexttrack', () => engine.next())
        navigator.mediaSession.setActionHandler('seekto', (d) => {
          if (d && typeof d.seekTime === 'number') engine.seekTo(d.seekTime)
        })
      }
    } catch {
      /* não-crítico */
    }

    // ── Ponte com o main: bandeja, mini player e atalhos globais de mídia ──
    // Um único assinante com throttle de 400ms: o tray/mini não precisa do
    // relógio de 60fps, mas precisa reagir na hora a play/pause/troca de faixa.
    const api = window.onda
    let disposed = false
    let lastSent = 0
    let scheduled: ReturnType<typeof setTimeout> | null = null
    const INTERVAL_MS = 400

    const toBroadcast = (snap: PlayerSnapshot): PlayerBroadcastState => ({
      isPlaying: snap.status === 'playing' && snap.track !== null,
      status: snap.status,
      title: snap.track?.title ?? null,
      artist: snap.track?.artist ?? null,
      album: snap.track?.album ?? null,
      coverPath: snap.track?.coverPath ?? null,
      currentTime: snap.currentTime,
      duration: snap.duration,
      volume: snap.volume,
      muted: snap.muted,
      shuffle: snap.shuffle,
      playMode: snap.playMode
    })

    const flush = (): void => {
      if (disposed) return
      lastSent = performance.now()
      api?.broadcastPlayerState(toBroadcast(engine.getSnapshot()))
    }

    const unsubscribe =
      api === undefined
        ? (): void => undefined
        : engine.subscribe(() => {
            const now = performance.now()
            if (now - lastSent >= INTERVAL_MS) {
              flush()
              return
            }
            if (scheduled) return
            scheduled = setTimeout(() => {
              scheduled = null
              flush()
            }, INTERVAL_MS - (now - lastSent))
          })

    const offCommand = api?.onPlayerCommand((command) => {
      switch (command) {
        case 'toggle':
          engine.togglePlay()
          break
        case 'next':
          engine.next()
          break
        case 'previous':
          engine.previous()
          break
        case 'stop':
          engine.pause()
          break
      }
    })

    // Faixas que sumiram do disco (watcher) ou foram removidas em lote.
    const onTracksRemoved = (e: Event): void => {
      const detail = (e as CustomEvent<{ filePaths: string[] }>).detail
      if (detail?.filePaths?.length) engine.purgeTracks(detail.filePaths)
    }
    window.addEventListener('onda:tracks-removed', onTracksRemoved)

    flush()

    const onErrorToast = (e: Event): void => {
      const detail = (e as CustomEvent<{ filePath: string; message: string }>).detail
      pushToast('error', 'Falha na reprodução', detail?.message)
    }
    window.addEventListener('onda:playback-error', onErrorToast)

    return () => {
      disposed = true
      unsubscribe()
      offCommand?.()
      if (scheduled) clearTimeout(scheduled)
      window.removeEventListener('onda:tracks-removed', onTracksRemoved)
      window.removeEventListener('onda:playback-error', onErrorToast)
    }
  }, [engine])

  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>
}

export function usePlayerEngine(): AudioEngine {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error('usePlayerEngine deve ser usado dentro de <AudioEngineProvider>')
  return ctx
}

/** Snapshot completo — use apenas em componentes de alta frequência (PlayerBar). */
export function usePlayerState(): PlayerSnapshot {
  const engine = usePlayerEngine()
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot)
}

/** Seletores: só re-renderizam quando o valor derivado muda de fato. */
export function useEngineSelector<T>(selector: (s: PlayerSnapshot) => T): T {
  const engine = usePlayerEngine()
  const sel = useCallback(selector, [engine]) // eslint-disable-line react-hooks/exhaustive-deps
  return useSyncExternalStore(engine.subscribe, () => sel(engine.getSnapshot()))
}

export const useCurrentTrack = (): Track | null => useEngineSelector((s) => s.track)
export const useIsPlaying = (): boolean => useEngineSelector((s) => s.status === 'playing' && s.track !== null)
export const usePlayerStatus = (): PlayerStatus => useEngineSelector((s) => s.status)
export const useShuffleOn = (): boolean => useEngineSelector((s) => s.shuffle)
export const usePlayMode = (): PlayMode => useEngineSelector((s) => s.playMode)
export const useUpcomingCount = (): number => useEngineSelector((s) => s.upcoming.length)
export const useUpcomingItems = (): UpcomingItem[] => useEngineSelector((s) => s.upcoming)

export interface PlayerActions {
  playFromQueue(queue: Track[], startIndex: number): void
  playQueueIndex(index: number): void
  togglePlay(): void
  pause(): void
  next(): void
  previous(): void
  seekTo(seconds: number): void
  seekLive(seconds: number): void
  skipSeconds(delta: number): void
  restartCurrent(): void
  toggleShuffle(): boolean
  cyclePlayMode(): PlayMode
  setVolume(v: number): void
  toggleMute(): void
  enqueue(tracks: Track[], position: 'next' | 'last'): void
  removeUpcoming(item: UpcomingItem): void
  notifyTrackGone(filePath: string): void
  purgeTracks(filePaths: string[]): void
  setCrossfade(enabled: boolean): void
  setScrubBlocked(blocked: boolean): void
  getAudioElement(): HTMLAudioElement
}

export function usePlayerActions(): PlayerActions {
  const engine = usePlayerEngine()
  return useRef<PlayerActions>({
    playFromQueue: (q, i) => engine.playFromQueue(q, i),
    playQueueIndex: (i) => engine.playQueueIndex(i),
    togglePlay: () => engine.togglePlay(),
    pause: () => engine.pause(),
    next: () => engine.next(),
    previous: () => engine.previous(),
    seekTo: (s) => engine.seekTo(s),
    seekLive: (s) => engine.seekLive(s),
    skipSeconds: (d) => engine.skipSeconds(d),
    restartCurrent: () => engine.restartCurrent(),
    toggleShuffle: () => engine.toggleShuffle(),
    cyclePlayMode: () => engine.cyclePlayMode(),
    setVolume: (v) => engine.setVolume(v),
    toggleMute: () => engine.toggleMute(),
    enqueue: (t, p) => engine.enqueue(t, p),
    removeUpcoming: (item) => engine.removeUpcoming(item),
    notifyTrackGone: (filePath) => engine.notifyTrackGone(filePath),
    purgeTracks: (filePaths) => engine.purgeTracks(filePaths),
    setCrossfade: (enabled) => engine.setCrossfadeEnabled(enabled),
    setScrubBlocked: (blocked) => {
      engine.scrubBlocked = blocked
    },
    getAudioElement: () => engine.audio
  }).current
}
