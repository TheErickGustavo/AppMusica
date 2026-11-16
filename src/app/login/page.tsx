import type { Metadata } from 'next'
import { LoginForm } from '@/components/LoginForm'

export const metadata: Metadata = {
  title: 'Entrar'
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const params = await searchParams
  const requested = typeof params.next === 'string' ? params.next : '/'
  const nextPath = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/'

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
          maskImage: 'radial-gradient(ellipse at center, black 10%, transparent 70%)'
        }}
      />
      <LoginForm nextPath={nextPath} />
    </main>
  )
}
