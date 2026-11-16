export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTotalDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min'
  const totalMinutes = Math.round(seconds / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`
  return `${m} min`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`
  return String(n)
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const COVER_GRADIENTS = [
  ['#064e3b', '#10b981', '#022c22'],
  ['#1e1b4b', '#818cf8', '#0f172a'],
  ['#3b0764', '#e879f9', '#1e1b4b'],
  ['#431407', '#fb923c', '#1c1917'],
  ['#082f49', '#38bdf8', '#0c4a6e'],
  ['#3f1d38', '#fb7185', '#1f0a1a'],
  ['#1a2e05', '#a3e635', '#0f1a02'],
  ['#422006', '#facc15', '#1c1917']
]

export function coverGradient(seed: string): string {
  const palette = COVER_GRADIENTS[hashString(seed) % COVER_GRADIENTS.length]
  return `linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 55%, ${palette[2]} 100%)`
}
