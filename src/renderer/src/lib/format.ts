/** Formatação de tempo e números — a camada de "microcopy" da UI. */

/** 4:20 · 1:02:33 · aceita frações e valores quebrados do <audio>. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return h > 0 ? `${h}:${mm}:${sec.toString().padStart(2, '0')}` : `${mm}:${sec.toString().padStart(2, '0')}`
}

/** Modo precisão do scrubber enquanto o usuário arrasta: 3:41.250 */
export function formatTimePrecise(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const whole = Math.floor(seconds)
  const ms = Math.floor((seconds - whole) * 1000)
  return `${formatTime(whole)}.${ms.toString().padStart(3, '0')}`
}

export function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  return new Intl.NumberFormat('pt-BR').format(n)
}

export function formatDurationTotal(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h <= 0) return `${m} min`
  return `${h} h ${m.toString().padStart(2, '0')} min`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1).replace('.', ',')} ${units[i]}`
}

export function formatBitrate(kbps: number | null, codec: string | null): string | null {
  if (kbps == null || kbps <= 0) return codec
  return codec ? `${codec.split(' ')[0] ?? codec} · ${Math.round(kbps)} kbps` : `${Math.round(kbps)} kbps`
}

/** "agora" · "há 2 h" · "ontem" · "12 mar 2026" — nada de ISO cru na cara do usuário. */
export function formatRelativeDate(epochMs: number | null): string {
  if (!epochMs) return '—'
  const now = Date.now()
  const diff = now - epochMs
  const min = Math.floor(diff / 60000)
  if (diff < 90_000) return 'agora'
  if (min < 60) return `há ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24 && new Date(epochMs).getDate() === new Date(now).getDate()) return `há ${hours} h`
  const days = Math.floor(diff / 86_400_000)
  if (days === 1) return 'ontem'
  if (days < 7) return `há ${days} dias`
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }).format(epochMs)
}
