import { useSyncExternalStore } from 'react'

/** Store de toasts sem dependência externa — pub/sub + React 18. */

export type ToastKind = 'success' | 'info' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  detail?: string
  createdAt: number
}

let nextId = 1
let toasts: Toast[] = []
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit(): void {
  for (const l of listeners) l()
}

export function pushToast(kind: ToastKind, title: string, detail?: string, ttlMs = 4200): number {
  const id = nextId++
  toasts = [...toasts, { id, kind, title, detail, createdAt: Date.now() }].slice(-5)
  timers.set(
    id,
    setTimeout(() => dismissToast(id), ttlMs)
  )
  emit()
  return id
}

export function dismissToast(id: number): void {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
  const before = toasts.length
  toasts = toasts.filter((toast) => toast.id !== id)
  if (toasts.length !== before) emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts)
}
