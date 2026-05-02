import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/apiAuth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function GET(req: NextRequest) {
  const deny = await requireAuth(req)
  if (deny) return deny
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true },
    orderBy: { email: 'asc' },
  })
  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const deny = await requireAuth(req)
  if (deny) return deny
  const { email, password, name } = await req.json()
  if (!email || !password) return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  const hash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({ data: { email, password: hash, name: name ?? null } })
  return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 })
}
