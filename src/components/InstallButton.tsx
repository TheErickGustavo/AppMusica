'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function InstallButton(): React.ReactElement | null {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    const standaloneTimer = window.setTimeout(() => {
      if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true)
    }, 0)

    return () => {
      window.clearTimeout(standaloneTimer)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed || !promptEvent) return null

  async function install() {
    if (!promptEvent || installing) return
    setInstalling(true)
    try {
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      if (choice.outcome === 'accepted') setInstalled(true)
      setPromptEvent(null)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <button
      type="button"
      onClick={install}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.08] px-2.5 text-[11.5px] font-medium text-emerald-200 transition hover:bg-emerald-400/[0.14]"
      title="Instalar o Onda como app"
    >
      {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">Instalar app</span>
    </button>
  )
}
