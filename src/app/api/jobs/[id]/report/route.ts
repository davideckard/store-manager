import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { reportPath } from '@/lib/jobRunner'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const rp = reportPath(id)
  if (!rp) return NextResponse.json({ error: 'No report found' }, { status: 404 })

  const content = fs.readFileSync(rp, 'utf8')
  const download = req.nextUrl.searchParams.get('download') === '1'

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...(download ? { 'Content-Disposition': `attachment; filename="${path.basename(rp)}"` } : {}),
    },
  })
}
