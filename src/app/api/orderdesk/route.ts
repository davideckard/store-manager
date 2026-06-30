import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/apiAuth'

export async function GET(req: NextRequest) {
  const deny = await requireAuth(req)
  if (deny) return deny
  const entries = await prisma.orderDesk.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json(entries)
}

export async function POST(req: NextRequest) {
  const deny = await requireAuth(req)
  if (deny) return deny
  const body = await req.json()
  const entry = await prisma.orderDesk.create({ data: body })
  return NextResponse.json(entry, { status: 201 })
}
