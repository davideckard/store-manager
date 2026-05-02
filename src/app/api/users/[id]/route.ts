import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/apiAuth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deny = await requireAuth(req)
  if (deny) return deny
  const { id } = await params
  const { password } = await req.json()
  if (!password) return NextResponse.json({ error: 'Password required' }, { status: 400 })
  const hash = await bcrypt.hash(password, 12)
  await prisma.user.update({ where: { id }, data: { password: hash } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deny = await requireAuth(req)
  if (deny) return deny
  const { id } = await params
  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
