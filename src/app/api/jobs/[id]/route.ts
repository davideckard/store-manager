import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { killJob, reportPath, reportHasIssues } from '@/lib/jobRunner'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_: NextRequest, { params }: Ctx) {
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

export async function DELETE(_: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params
    killJob(id)
    await prisma.job.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
