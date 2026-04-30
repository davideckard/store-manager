import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  const authHeader = req.headers.get('authorization') ?? ''
  const apiToken = process.env.API_TOKEN
  if (apiToken && authHeader === `Bearer ${apiToken}`) return null

  const session = await auth()
  if (session) return null

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
