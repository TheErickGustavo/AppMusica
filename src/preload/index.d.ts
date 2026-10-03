import type { OndaApi } from './index'

declare global {
  interface Window {
    /** API do desktop exposta pelo preload. `undefined` quando rodando em browser puro (vite dev). */
    onda?: OndaApi
  }
}

export {}
