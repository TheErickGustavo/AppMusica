'use client'

import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Loader2, Lock } from 'lucide-react'

export function LoginForm({ nextPath }: { nextPath: string }): React.ReactElement {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password || loading) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password })
      })
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Não foi possível entrar.')
      }
      window.location.assign(nextPath || '/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.')
      setLoading(false)
    }
  }

  return (
    <div className="fade-up relative w-full max-w-[400px]">
      <div className="mb-6 flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-192.png"
          alt="Onda"
          width={64}
          height={64}
          className="h-16 w-16 rounded-[18px] shadow-2xl shadow-emerald-500/20 ring-1 ring-white/10"
        />
        <h1 className="mt-4 text-[26px] font-semibold tracking-tight text-zinc-50">Onda</h1>
        <p className="mt-1 text-[13px] text-zinc-500">Sua biblioteca musical compartilhada.</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-white/[0.08] bg-zinc-900/55 p-5 shadow-2xl shadow-black/50 backdrop-blur-xl"
      >
        <label htmlFor="password" className="mb-2 block text-[12px] font-medium text-zinc-400">
          Senha de acesso
        </label>

        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Digite a senha"
            className="h-11 w-full rounded-xl border border-white/[0.08] bg-black/25 pl-9 pr-11 text-[13.5px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/40 focus:ring-2 focus:ring-emerald-400/15"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
            aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-[12px] text-rose-200"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!password || loading}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 text-[13px] font-semibold text-emerald-950 shadow-lg shadow-emerald-500/15 outline-none transition hover:bg-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/50 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Entrando…
            </>
          ) : (
            <>
              Entrar na biblioteca
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <p className="mt-3 text-center text-[11px] leading-relaxed text-zinc-600">
          Acesso privado. Use a senha combinada com seu amigo.
        </p>
      </form>

      <p className="mx-auto mt-4 max-w-[330px] text-center text-[11px] leading-relaxed text-zinc-600">
        Dica: depois de entrar, use o botão <span className="text-zinc-400">Instalar app</span> no
        topo para ter o Onda com ícone próprio no computador ou celular.
      </p>
    </div>
  )
}
