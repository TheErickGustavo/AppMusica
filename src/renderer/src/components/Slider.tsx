import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'

/**
 * Slider custom (pointer-capture) para scrubber e volume.
 *  - hover: track expande + thumb aparece (padrão Linear/Apple);
 *  - arraste: valor ao vivo via onInput (seek contínuo), commit no ponteiro-up;
 *  - tooltip opcional (tempo com precisão de ms) segue o cursor;
 *  - teclado: ← → Home End PageUp/Down — role="slider" completo.
 */

interface SliderProps {
  value: number
  max: number
  disabled?: boolean
  /** Rótulo acessível. */
  label: string
  onInput?: (v: number) => void
  onCommit?: (v: number) => void
  /** Tooltip de texto (ex.: "1:23.456") enquanto interage. */
  tooltip?: (v: number) => string | null
  trackClassName?: string
  fillClassName?: string
  heightClass?: string
}

export function Slider({
  value,
  max,
  disabled = false,
  label,
  onInput,
  onCommit,
  tooltip,
  trackClassName = 'bg-white/[0.12]',
  fillClassName = 'bg-white group-hover/slider:bg-emerald-400',
  heightClass = 'h-1'
}: SliderProps): ReactElement {
  const railRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [hoverPct, setHoverPct] = useState<number | null>(null)
  const [pendingTip, setPendingTip] = useState<string | null>(null)
  const ratioRef = useRef(0)

  const safeMax = max > 0 ? max : 1
  const ratio = disabled ? 0 : Math.max(0, Math.min(1, value / safeMax))
  ratioRef.current = ratio

  const valueAt = useCallback((clientX: number): number => {
    const el = railRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return pct * safeMax
  }, [safeMax])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    const v = valueAt(e.clientX)
    setPendingTip(tooltip ? tooltip(v) : null)
    onInput?.(v)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    const rect = railRef.current?.getBoundingClientRect()
    if (rect && rect.width > 0) setHoverPct(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
    if (!dragging) return
    const v = valueAt(e.clientX)
    setPendingTip(tooltip ? tooltip(v) : null)
    onInput?.(v)
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer já liberado */
    }
    setDragging(false)
    setPendingTip(null)
    onCommit?.(valueAt(e.clientX))
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (disabled) return
    const step = (e.shiftKey ? 5 : 1) * (safeMax > 100 ? safeMax / 100 : 0.05)
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = safeMax
    else if (e.key === 'PageUp') next = value + step * 10
    else if (e.key === 'PageDown') next = value - step * 10
    if (next !== null) {
      e.preventDefault()
      const clamped = Math.max(0, Math.min(safeMax, next))
      onInput?.(clamped)
      onCommit?.(clamped)
    }
  }

  const pct = dragging ? Math.max(0, Math.min(1, ratio)) : ratio
  const tipPct = hoverPct ?? pct
  const tipVisible = (dragging || (hovering && tooltip)) && !disabled

  // Ao arrastar, mantém o valor visível suavizado mesmo se o pai re-renderizar devagar.
  useEffect(() => {
    if (!dragging) return
    const el = railRef.current
    if (!el) return
    el.classList.add('cursor-grabbing')
    return () => el?.classList.remove('cursor-grabbing')
  }, [dragging])

  return (
    <div
      ref={railRef}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeMax * 1000) / 1000}
      aria-valuenow={Math.round(value * 1000) / 1000}
      aria-valuetext={tooltip ? tooltip(value) ?? undefined : undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => {
        setHovering(false)
        setHoverPct(null)
      }}
      onKeyDown={onKeyDown}
      className={`group/slider relative flex h-5 w-full cursor-pointer touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 disabled:pointer-events-none disabled:opacity-40 ${disabled ? '' : ''}`}
    >
      <div className={`relative w-full ${heightClass} rounded-full transition-[height] duration-150 ${dragging ? 'h-1.5' : ''}`}>
        <div className={`absolute inset-0 rounded-full ${trackClassName}`} />
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${fillClassName} transition-colors duration-150`}
          style={{ width: `${tipPct * 100}%` }}
          data-rail-value={pct}
        />
        {/* preenchimento sob o dedo = feedback de hover no ponto */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-white/[0.06] opacity-0 transition-opacity group-hover/slider:opacity-100"
          style={{ width: `${tipPct * 100}%` }}
        />
        {/* thumb */}
        <div
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.6)] transition-opacity duration-150 ${
            dragging ? 'opacity-100' : hovering ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ left: `${tipPct * 100}%` }}
        />
      </div>

      {tipVisible && tooltip && (
        <div
          className="pointer-events-none absolute -top-7 z-40 -translate-x-1/2 rounded-md border border-white/[0.08] bg-zinc-900/95 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-200 shadow-xl backdrop-blur-md"
          style={{ left: `${tipPct * 100}%` }}
        >
          {dragging ? (pendingTip ?? tooltip(value)) : tooltip(hoverPct != null ? hoverPct * safeMax : value)}
        </div>
      )}
    </div>
  )
}
