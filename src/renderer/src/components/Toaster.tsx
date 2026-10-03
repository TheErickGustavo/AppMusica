import { AnimatePresence, motion } from 'framer-motion'
import { CircleCheck, CircleAlert, Info, X } from 'lucide-react'
import { dismissToast, useToasts, type Toast } from '@/lib/toast'

/** Pilha de notificações — same visual language dos toasts do Linear. */

const ICONS: Record<Toast['kind'], { node: JSX.Element; ring: string }> = {
  success: { node: <CircleCheck className="h-4 w-4 text-emerald-400" />, ring: 'border-emerald-400/15' },
  error: { node: <CircleAlert className="h-4 w-4 text-rose-400" />, ring: 'border-rose-400/20' },
  info: { node: <Info className="h-4 w-4 text-zinc-300" />, ring: 'border-white/[0.08]' }
}

export function Toaster(): JSX.Element {
  const toasts = useToasts()
  return (
    <div className="pointer-events-none fixed bottom-[104px] right-4 z-[95] flex w-[320px] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border ${ICONS[t.kind].ring} bg-zinc-900/90 px-3.5 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl`}
          >
            <span className="mt-px shrink-0">{ICONS[t.kind].node}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-zinc-100">{t.title}</p>
              {t.detail && <p className="mt-0.5 break-words text-[11.5px] leading-relaxed text-zinc-500">{t.detail}</p>}
            </div>
            <button type="button" onClick={() => dismissToast(t.id)} className="icon-btn -mr-1 -mt-1 !h-6 w-6" title="Fechar">
              <X className="h-3 w-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
