import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { killJob, cancelJob, reportPath, reportHasIssues } from '@/lib/jobRunner'
import { requireAuth } from '@/lib/apiAuth'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const { id } = await params
    const job = await prisma.job.findUnique({ where: { id } })
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      ...job,
      hasReport: reportPath(id) !== null,
      hasIssues: reportHasIssues(id),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const { id } = await params
    const stopped = cancelJob(id)
    if (!stopped) return NextResponse.json({ error: 'Job not running' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const deny = await requireAuth(req)
  if (deny) return deny
  try {
    const { id } = await params
    killJob(id)
    await prisma.job.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
