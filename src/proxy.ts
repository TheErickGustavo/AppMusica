import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth'

const PUBLIC_PATHS = new Set([
  '/login',
  '/api/login',
  '/manifest.webmanifest',
  '/sw.js',
  '/robots.txt',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/onda.png'
])

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  return pathname.startsWith('/icons/') || pathname.startsWith('/_next/')
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const authenticated = await verifySessionToken(token)

  if (pathname === '/login') {
    if (authenticated) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return NextResponse.next()
  }

  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  if (authenticated) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  const next = `${pathname}${search}`
  if (next.startsWith('/') && !next.startsWith('//')) {
    loginUrl.searchParams.set('next', next)
  }
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)']
}
