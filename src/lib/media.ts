export const AUDIO_EXTENSIONS = [
  'mp3',
  'mpeg',
  'mpga',
  'm4a',
  'm4b',
  'flac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'aiff',
  'aif',
  'webm',
  'aac',
  'mp4'
] as const

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number]

export const AUDIO_ACCEPT = [...AUDIO_EXTENSIONS.map((ext) => `.${ext}`), 'audio/*'].join(',')

export const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  webm: 'audio/webm',
  aac: 'audio/aac',
  mp4: 'audio/mp4'
}

export const AUDIO_PATHNAME_RE =
  /^music\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|mpeg|mpga|m4a|m4b|flac|wav|ogg|oga|opus|aiff|aif|webm|aac|mp4)$/i

export function extensionOf(name: string): string {
  const clean = name.split(/[?#]/)[0]
  const dot = clean.lastIndexOf('.')
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : ''
}

export function isSupportedAudioName(name: string): boolean {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

export function isSupportedAudioFile(file: File): boolean {
  return isSupportedAudioName(file.name) || file.type.startsWith('audio/')
}

export function mimeForFile(file: File): string {
  const byExt = MIME_BY_EXT[extensionOf(file.name)]
  if (byExt) return byExt
  if (file.type.startsWith('audio/')) return file.type
  return 'application/octet-stream'
}

export function extensionForFile(file: File): string {
  const ext = extensionOf(file.name)
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return ext

  const byMime: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/webm': 'webm',
    'audio/aac': 'aac',
    'audio/aiff': 'aiff',
    'audio/x-aiff': 'aiff'
  }
  return byMime[file.type] ?? 'mp3'
}

export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim()
  return base || 'Faixa sem título'
}
