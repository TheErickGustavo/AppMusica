import type { Metadata, Viewport } from 'next'
import { PwaRegister } from '@/components/PwaRegister'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Onda — Biblioteca musical',
    template: '%s · Onda'
  },
  description: 'Sua biblioteca musical compartilhada: ouça, baixe e envie músicas de qualquer lugar.',
  applicationName: 'Onda',
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Onda'
  }
}

export const viewport: Viewport = {
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  )
}
