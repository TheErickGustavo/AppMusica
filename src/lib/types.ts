export interface Track {
  id: string
  title: string
  artist: string
  album: string
  genre: string | null
  year: number | null
  duration: number
  bitrate: number | null
  sampleRate: number | null
  codec: string | null
  container: string | null
  size: number
  pathname: string
  url: string
  downloadUrl: string
  coverUrl: string | null
  uploadedAt: string
}

export interface LibraryFile {
  version: 1
  tracks: Track[]
}

export interface LibraryResponse {
  tracks: Track[]
  configured: boolean
}

export interface TrackPayload {
  id: string
  title: string
  artist: string
  album: string
  genre?: string | null
  year?: number | null
  duration: number
  bitrate?: number | null
  sampleRate?: number | null
  codec?: string | null
  container?: string | null
  size: number
  pathname: string
  coverBase64?: string | null
  coverMime?: string | null
}

export type SortKey = 'recent' | 'title' | 'artist' | 'album' | 'duration'
