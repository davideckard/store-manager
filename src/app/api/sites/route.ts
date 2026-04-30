import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/apiAuth'

export async function GET(req: NextRequest) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const sites = await prisma.mLS_Webstore.findMany({ orderBy: { name: 'asc' } })
    return NextResponse.json(sites)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const body = await req.json()
    const site = await prisma.mLS_Webstore.create({ data: body })
    return NextResponse.json(site, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
