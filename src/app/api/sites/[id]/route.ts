import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/apiAuth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const { id } = await params
    const site = await prisma.mLS_Webstore.findUnique({ where: { id: Number(id) } })
    if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(site)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const { id } = await params
    const body = await req.json()
    const site = await prisma.mLS_Webstore.update({ where: { id: Number(id) }, data: body })
    return NextResponse.json(site)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const { id } = await params
    await prisma.mLS_Webstore.delete({ where: { id: Number(id) } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
