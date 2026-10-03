import { useSyncExternalStore } from 'react'

/**
 * Diálogo de texto global (sem libs): mesma arquitetura do store de toasts.
 * Uso: `const name = await requestText({ title: 'Nova playlist', … })` — quem
 * chama recebe `string | null` (null = cancelado). O <PromptHost/> em App.tsx
 * desenha o modal.
 */

export interface PromptRequest {
  id: number
  title: string
  description?: string
  placeholder?: string
  initial?: string
  confirmLabel?: string
  /** Devolve mensagem de erro quando inválido (bloqueia o confirmar). */
  validate?: (value: string) => string | null
}

interface PromptState {
  request: PromptRequest | null
  resolve: ((value: string | null) => void) | null
}

let state: PromptState = { request: null, resolve: null }
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function requestText(request: Omit<PromptRequest, 'id'>): Promise<string | null> {
  // Um prompt por vez: o anterior é resolvido como cancelado.
  state.resolve?.(null)
  return new Promise<string | null>((resolve) => {
    state = { request: { ...request, id: nextId++ }, resolve }
    emit()
  })
}

export function settlePrompt(value: string | null): void {
  const resolve = state.resolve
  state = { request: null, resolve: null }
  emit()
  resolve?.(value)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePromptRequest(): PromptRequest | null {
  return useSyncExternalStore(subscribe, () => state.request)
}
