import { NextResponse } from 'next/server'
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifyPassword
} from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.APP_PASSWORD || !process.env.AUTH_SECRET) {
    return NextResponse.json(
      { error: 'O acesso ainda não foi configurado no servidor (APP_PASSWORD / AUTH_SECRET).' },
      { status: 500 }
    )
  }

  let password = ''
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object' && 'password' in body && typeof body.password === 'string') {
      password = body.password
    }
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
  }

  if (!verifyPassword(password)) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    return NextResponse.json({ error: 'Senha incorreta. Tente novamente.' }, { status: 401 })
  }

  const token = await createSessionToken()
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
  return response
}
