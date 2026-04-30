import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runJob } from '@/lib/jobRunner'

export async function GET() {
  try {
    const { reportPath, reportHasIssues } = await import('@/lib/jobRunner')
    const jobs = await prisma.job.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json(
      jobs.map(j => ({
        ...j,
        hasReport: reportPath(j.id) !== null,
        hasIssues: reportHasIssues(j.id),
      })),
    )
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { siteId, mode, storeId, orderboardUrl, force, fromAuditJob, filterSkus, email, password } = body

    if (!['upload', 'audit', 'fix'].includes(mode))
      return NextResponse.json({ error: 'mode must be upload, audit, or fix' }, { status: 400 })
    if (!siteId?.trim())
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const conflict = await prisma.job.findFirst({
      where: { siteId, status: { in: ['running', 'pending'] } },
    })
    if (conflict)
      return NextResponse.json(
        { error: `A job for site '${siteId}' is already running.` },
        { status: 409 },
      )

    const safeParams = { siteId, mode, storeId, orderboardUrl, force, fromAuditJob, filterSkus }
    const job = await prisma.job.create({
      data: { siteId, mode, params: JSON.stringify(safeParams), status: 'pending' },
    })

    // Run in background — don't await
    runJob(job.id, { ...safeParams, email, password }).catch(() => {})

    return NextResponse.json({ id: job.id }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
