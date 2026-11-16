'use client'

import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  message: string
  tone: ToastTone
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-emerald-400/20 bg-emerald-950/80 text-emerald-100',
  error: 'border-rose-400/20 bg-rose-950/80 text-rose-100',
  info: 'border-sky-400/20 bg-sky-950/80 text-sky-100'
}

const TONE_ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info
} as const

export function Toasts({
  toasts,
  onDismiss
}: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}): React.ReactElement {
  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-28 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-[340px]"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const Icon = TONE_ICONS[toast.tone]
        return (
          <div
            key={toast.id}
            role="status"
            className={`toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3 py-2.5 shadow-xl shadow-black/30 backdrop-blur-xl ${TONE_STYLES[toast.tone]}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
            <p className="min-w-0 flex-1 text-[12px] leading-relaxed">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-current opacity-50 transition hover:bg-white/10 hover:opacity-100"
              aria-label="Fechar aviso"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
