import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth-server'
import { AUDIO_PATHNAME_RE, MIME_BY_EXT } from '@/lib/media'

export const runtime = 'nodejs'

const ALLOWED_CONTENT_TYPES = Array.from(new Set(Object.values(MIME_BY_EXT))).concat(
  'application/octet-stream'
)

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    return NextResponse.json(
      { error: 'O armazenamento (Vercel Blob) ainda não está configurado.' },
      { status: 503 }
    )
  }

  let body: HandleUploadBody
  try {
    body = (await request.json()) as HandleUploadBody
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!AUDIO_PATHNAME_RE.test(pathname)) {
          throw new Error('Nome de arquivo inválido.')
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60 * 60
        }
      }
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    console.error('[upload]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao autorizar o upload.' },
      { status: 400 }
    )
  }
}
