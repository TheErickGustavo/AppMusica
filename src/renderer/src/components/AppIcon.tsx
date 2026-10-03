import type { ReactElement } from 'react'

/**
 * Marca do app em SVG puro (versão compacta do resources/icon.svg),
 * com IDs de gradiente por-instância para evitar colisão no DOM.
 */
let instanceCount = 0

export function AppIcon({ size = 22, className = '' }: { size?: number; className?: string }): ReactElement {
  const id = `onda-mark-${(instanceCount += 1)}`
  return (
    <svg
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Onda"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="180" y1="140" x2="880" y2="900" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2a2a2f" />
          <stop offset="0.5" stopColor="#141416" />
          <stop offset="1" stopColor="#09090b" />
        </linearGradient>
        <linearGradient id={`${id}-bars`} x1="512" y1="200" x2="512" y2="824" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fafafa" />
          <stop offset="0.62" stopColor="#d4d4d8" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="512" cy="470" r="360" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#10b981" stopOpacity="0.24" />
          <stop offset="1" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-ring`} x1="200" y1="200" x2="824" y2="824" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.10" />
          <stop offset="1" stopColor="#10b981" stopOpacity="0.70" />
        </linearGradient>
      </defs>
      <rect x="32" y="32" width="960" height="960" rx="216" fill={`url(#${id}-bg)`} />
      <rect x="32" y="32" width="960" height="960" rx="216" fill="none" stroke="#ffffff" strokeOpacity="0.09" strokeWidth="2" />
      <circle cx="512" cy="512" r="352" fill={`url(#${id}-glow)`} />
      <circle cx="512" cy="512" r="300" fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="26" />
      <circle cx="512" cy="512" r="252" fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="10" />
      <circle cx="512" cy="512" r="212" fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="10" />
      <circle cx="512" cy="512" r="252" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="6" />
      <g fill={`url(#${id}-bars)`}>
        <rect x="284" y="462" width="44" height="100" rx="22" opacity="0.55" />
        <rect x="368" y="396" width="44" height="232" rx="22" opacity="0.75" />
        <rect x="452" y="318" width="44" height="388" rx="22" opacity="0.92" />
        <rect x="536" y="248" width="44" height="528" rx="22" />
        <rect x="620" y="352" width="44" height="320" rx="22" opacity="0.82" />
        <rect x="704" y="436" width="44" height="152" rx="22" opacity="0.62" />
      </g>
      <circle cx="512" cy="512" r="34" fill="#09090b" />
      <circle cx="512" cy="512" r="22" fill="#10b981" />
    </svg>
  )
}
