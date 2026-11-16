export const SESSION_COOKIE = 'onda_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30

function sessionSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET não configurado no servidor.')
  return secret
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toHex(signature)
}

export async function createSessionToken(): Promise<string> {
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000
  const payload = String(expiresAt)
  return `${payload}.${await sign(payload)}`
}

export async function verifySessionToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false

  const expiresAt = Number(payload)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false

  const expected = await sign(payload)
  return safeEqual(signature, expected)
}

export function verifyPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD
  if (!expected) return false
  return safeEqual(input, expected)
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE
  }
}
