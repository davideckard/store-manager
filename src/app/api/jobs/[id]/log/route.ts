import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { logPath } from '@/lib/jobRunner'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const lp = logPath(id)
  const content = fs.existsSync(lp) ? fs.readFileSync(lp, 'utf8') : ''
  const download = req.nextUrl.searchParams.get('download') === '1'

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...(download ? { 'Content-Disposition': `attachment; filename="job_${id.slice(0, 8)}.log"` } : {}),
    },
  })
}
