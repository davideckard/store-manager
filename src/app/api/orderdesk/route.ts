import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const entries = await prisma.orderDesk.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json(entries)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const entry = await prisma.orderDesk.create({ data: body })
  return NextResponse.json(entry, { status: 201 })
}
