import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  separatorBefore?: boolean
  disabled?: boolean
  onSelect?: () => void
}

interface ContextMenuState {
  x: number
  y: number
  items: MenuItem[]
  key: number
}

let openMenu: ((state: ContextMenuState | null) => void) | null = null
let seq = 0

/** Abre o menu de contexto a partir de qualquer lugar (rows, botões ‥). */
export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  openMenu?.({ x, y, items, key: ++seq })
}

export function hideContextMenu(): void {
  openMenu?.(null)
}

const W = 232

/** Montado uma vez no App; portal global para escapar de overflow/transform. */
export function ContextMenuHost(): ReactElement {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number; ready: boolean }>({ x: 0, y: 0, ready: false })
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    openMenu = setMenu
    return () => {
      openMenu = null
    }
  }, [])

  useLayoutEffect(() => {
    if (!menu) {
      setPos((p) => ({ ...p, ready: false }))
      return
    }
    const el = ref.current
    const h = el?.offsetHeight ?? 320
    const vw = window.innerWidth
    const vh = window.innerHeight
    const x = Math.max(8, Math.min(menu.x, vw - W - 8))
    const y = Math.max(8, Math.min(menu.y, vh - h - 8))
    setPos({ x, y, ready: true })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    const onPointerDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', close, { passive: true })
    // reancoragem ao redimensionar a janela: fecha (comportamento padrão de menus nativos)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  return createPortal(
    <AnimatePresence>
      {menu && (
        <motion.div
          key={menu.key}
          ref={ref}
          initial={{ opacity: 0, scale: 0.97, y: -4 }}
          animate={{ opacity: pos.ready ? 1 : 0, scale: pos.ready ? 1 : 0.97, y: pos.ready ? 0 : -4 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-[90] overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-900/95 p-1 shadow-[0_16px_48px_rgba(0,0,0,0.6)] backdrop-blur-xl"
          style={{ left: pos.x, top: pos.y, width: W, visibility: pos.ready ? 'visible' : 'hidden' }}
          role="menu"
        >
          {menu.items.map((item, i) => (
            <div key={item.id}>
              {item.separatorBefore && i > 0 && <div className="mx-2 my-1 h-px bg-white/[0.06]" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setMenu(null)
                  item.onSelect?.()
                }}
                className={`flex h-8 w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors duration-100 ${
                  item.danger
                    ? 'text-rose-400 hover:bg-rose-500/10 focus-visible:bg-rose-500/10'
                    : 'text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50 focus-visible:bg-white/[0.07] focus-visible:text-zinc-50'
                } disabled:pointer-events-none disabled:opacity-40`}
              >
                {item.icon && <span className="flex h-4 w-4 items-center justify-center text-zinc-500 [&_svg]:h-[15px] [&_svg]:w-[15px]">{item.icon}</span>}
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && <span className="font-mono text-[10px] text-zinc-600">{item.shortcut}</span>}
              </button>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
