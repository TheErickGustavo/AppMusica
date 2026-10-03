import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  separatorBefore?: boolean
  disabled?: boolean
  /** Marca de estado (ex.: "Fechar para a bandeja" ligado). */
  checked?: boolean
  onSelect?: () => void
  /** Submenu aberto no hover — ex.: "Adicionar à playlist…". */
  submenu?: MenuItem[]
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
const SUB_GAP = 2
const SUB_MAX_H = 320
const ITEM_H = 32

/** Marca qualquer painel de menu — o host usa isto para não fechar em cliques internos. */
const MENU_ATTR = 'data-onda-menu'

const PANEL_CLASS =
  'rounded-xl border border-white/[0.08] bg-zinc-900/95 p-1 shadow-[0_16px_48px_rgba(0,0,0,0.6)] backdrop-blur-xl'

function ItemButton({
  item,
  onActivate,
  onHover
}: {
  item: MenuItem
  onActivate: () => void
  onHover?: () => void
}): ReactElement {
  const hasSubmenu = (item.submenu?.length ?? 0) > 0
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onPointerEnter={onHover}
      onClick={() => {
        if (hasSubmenu) return
        onActivate()
      }}
      className={`flex h-8 w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors duration-100 ${
        item.danger
          ? 'text-rose-400 hover:bg-rose-500/10 focus-visible:bg-rose-500/10'
          : 'text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50 focus-visible:bg-white/[0.07] focus-visible:text-zinc-50'
      } disabled:pointer-events-none disabled:opacity-40`}
    >
      {item.icon && <span className="flex h-4 w-4 items-center justify-center text-zinc-500 [&_svg]:h-[15px] [&_svg]:w-[15px]">{item.icon}</span>}
      <span className="flex-1 truncate">{item.label}</span>
      {item.checked && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
      {item.shortcut && !hasSubmenu && <span className="font-mono text-[10px] text-zinc-600">{item.shortcut}</span>}
      {hasSubmenu && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
    </button>
  )
}

/** Lista de itens — usada pelo menu raiz e pelos submenus. */
function MenuItems({ items, onActivate }: { items: MenuItem[]; onActivate: (item: MenuItem) => void }): ReactElement {
  return (
    <>
      {items.map((item, i) => (
        <div key={item.id}>
          {item.separatorBefore && i > 0 && <div className="mx-2 my-1 h-px bg-white/[0.06]" />}
          <SubmenuRow item={item} onActivate={onActivate} />
        </div>
      ))}
    </>
  )
}

/**
 * Item + submenu. O submenu é portalado em `document.body` com posição fixa:
 * dentro de um container com overflow ele seria cortado, e o menu raiz tem
 * scroll para playlists longas.
 */
function SubmenuRow({ item, onActivate }: { item: MenuItem; onActivate: (item: MenuItem) => void }): ReactElement {
  const submenu = item.submenu ?? []
  const hasSubmenu = submenu.length > 0
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)

  const openSubmenu = (): void => {
    if (!hasSubmenu) {
      setAnchor(null)
      return
    }
    const rect = rowRef.current?.getBoundingClientRect()
    if (!rect) return
    const height = Math.min(SUB_MAX_H, submenu.length * ITEM_H + 8)
    const opensRight = rect.right + SUB_GAP + W <= window.innerWidth - 8
    const x = opensRight ? rect.right + SUB_GAP : Math.max(8, rect.left - W - SUB_GAP)
    const y = Math.max(8, Math.min(rect.top - 5, window.innerHeight - height - 8))
    setAnchor({ x, y })
  }

  return (
    <>
      <div ref={rowRef} className="relative">
        <ItemButton item={item} onActivate={() => onActivate(item)} onHover={openSubmenu} />
      </div>
      {hasSubmenu &&
        anchor &&
        createPortal(
          <div
            {...{ [MENU_ATTR]: 'submenu' }}
            role="menu"
            className={`fixed z-[91] w-[232px] ${PANEL_CLASS}`}
            style={{ left: anchor.x, top: anchor.y, maxHeight: SUB_MAX_H }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerLeave={() => setAnchor(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="max-h-[312px] overflow-y-auto">
              <MenuItems items={submenu} onActivate={onActivate} />
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

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
      const target = e.target
      if (!(target instanceof Node)) {
        close()
        return
      }
      // Cliques dentro de qualquer painel de menu (raiz ou submenu portalado)
      // não fecham o menu — e o alvo pode não ser um Element.
      if (target instanceof Element && target.closest(`[${MENU_ATTR}]`)) return
      if (ref.current && !ref.current.contains(target)) close()
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

  const activate = (item: MenuItem): void => {
    if (item.disabled || (item.submenu?.length ?? 0) > 0) return
    setMenu(null)
    item.onSelect?.()
  }

  const style: CSSProperties = { left: pos.x, top: pos.y, width: W, visibility: pos.ready ? 'visible' : 'hidden' }

  return createPortal(
    <AnimatePresence>
      {menu && (
        <motion.div
          key={menu.key}
          ref={ref}
          {...{ [MENU_ATTR]: 'root' }}
          initial={{ opacity: 0, scale: 0.97, y: -4 }}
          animate={{ opacity: pos.ready ? 1 : 0, scale: pos.ready ? 1 : 0.97, y: pos.ready ? 0 : -4 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          className={`fixed z-[90] ${PANEL_CLASS}`}
          style={style}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="max-h-[min(70vh,520px)] overflow-y-auto">
            <MenuItems items={menu.items} onActivate={activate} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
