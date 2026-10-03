import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { settlePrompt, usePromptRequest } from '@/lib/prompt'

/**
 * Modal de texto global (criar/renomear playlist). Enter confirma, Esc cancela,
 * clique no backdrop cancela — comportamento de diálogo nativo do Windows.
 */
export function PromptHost(): ReactElement | null {
  const request = usePromptRequest()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!request) return
    setValue(request.initial ?? '')
    setError(null)
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [request])

  if (typeof document === 'undefined') return null

  const confirm = (): void => {
    if (!request) return
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      setError('Dê um nome para continuar.')
      return
    }
    const validation = request.validate?.(trimmed) ?? null
    if (validation) {
      setError(validation)
      return
    }
    settlePrompt(trimmed)
  }

  return createPortal(
    <AnimatePresence>
      {request && (
        <motion.div
          key={request.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="fixed inset-0 z-[98] flex items-start justify-center bg-black/45 pt-[18vh] backdrop-blur-[2px]"
          onPointerDown={() => settlePrompt(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-[380px] rounded-2xl border border-white/[0.08] bg-zinc-900/95 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.6)] backdrop-blur-xl"
            role="dialog"
            aria-modal="true"
            aria-label={request.title}
          >
            <h2 className="text-[14px] font-semibold text-zinc-50">{request.title}</h2>
            {request.description && <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500">{request.description}</p>}

            <input
              ref={inputRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirm()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  settlePrompt(null)
                }
              }}
              placeholder={request.placeholder ?? 'Nome'}
              className="mt-3 h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[13px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500/40 focus:bg-white/[0.05] focus:ring-2 focus:ring-emerald-500/10"
            />
            {error && <p className="mt-1.5 text-[11px] text-rose-400">{error}</p>}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => settlePrompt(null)}
                className="inline-flex h-8 cursor-default items-center rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.06]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                className="inline-flex h-8 cursor-default items-center rounded-lg bg-zinc-100 px-3.5 text-[12px] font-semibold text-zinc-950 transition-transform hover:scale-[1.02] active:scale-[0.97]"
              >
                {request.confirmLabel ?? 'Confirmar'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
