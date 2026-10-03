/**
 * Construção de URLs do protocolo privilegiado `media://`.
 * O caminho absoluto vai como token base64url — imune a qualquer
 * normalização de URL do Chromium (backslashes, %, espaços, unicode).
 */

function utf8ToBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function audioUrl(absolutePath: string): string {
  return `media://audio/${utf8ToBase64Url(absolutePath)}`
}

export function coverUrl(coverPath: string): string {
  return `media://cover/${utf8ToBase64Url(coverPath)}`
}
