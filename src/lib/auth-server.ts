import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySessionToken } from './auth'

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies()
  return verifySessionToken(store.get(SESSION_COOKIE)?.value)
}
